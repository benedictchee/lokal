/**
 * Tier E — russia-mena cluster (Russia/CIS, MENA, other). LOWER-CONFIDENCE,
 * UNVERIFIED catalogue: each connector performs a real lightweight probe to
 * classify the source rather than trusting a guessed endpoint.
 *
 * Verified during authoring (June 2026):
 *  - 2GIS Places API:   GET https://catalog.api.2gis.com/3.0/items?q=...&key=KEY  (key-gated)
 *  - Yandex Places API: GET https://search-maps.yandex.ru/v1/?text=...&apikey=KEY (key-gated, display-only ToS)
 *  - Sygic Travel API:  GET https://api.sygictravelapi.com/1.0/en/places/list  (x-api-key header)
 *  - Yandex Eda:        no public content API (food delivery) — blocked/scrape-only, region-locked RU
 *  - Talabat:           no public content API; sitemap index at /sitemap/sitemap.xml.gz (Delivery Hero, MENA)
 *
 * Region/sanctions note: 2GIS, Yandex Maps and Yandex Eda are Russia/CIS sources;
 * keyed access and even keyless probes may be region-locked or sanctions-affected
 * and can fail from outside RU/CIS networks. Connectors treat such failures as
 * probe signals (noted), never as crashes.
 */
import { defineConnector } from '../core/connector.js';
import { fetchT, headFingerprint, sitemapProbe, looksLikeChallenge, sourceFp, mkRecord, UA } from '../core/fingerprint.js';
import type { SourceConnector } from '../core/types.js';

const LOW_CONF = 'Lower-confidence cluster (russia-mena): catalogue entry unverified; classification is from a live probe at runtime.';

// ---------------------------------------------------------------------------
// 2GIS — Catalog/Places API. Key-gated, display-oriented (map/POI cards).
// ---------------------------------------------------------------------------
const twogis = defineConnector({
  id: '2gis',
  displayName: '2GIS Places (Catalog API)',
  tier: 'E',
  coverage: 'Russia/CIS + select MENA cities; business directory POIs; display-oriented ToS',
  plan: {
    access: 'Public Places/Catalog API at catalog.api.2gis.com/3.0/items, requires key (TWOGIS_KEY)',
    incremental: 'none — search API has no since/updated_after param; re-query + diff by content_hash',
    fingerprint: 'per-branch (org/branch) id + content_hash of returned fields',
  },
  async run(input, deps) {
    const notes: string[] = [LOW_CONF];
    const limit = Math.min(input.limit ?? 10, 25);
    const base = 'https://catalog.api.2gis.com/3.0/items';
    const key = deps.env.TWOGIS_KEY;
    const inc = {
      method: 'none' as const,
      supported: false,
      description: '2GIS Places search exposes no since/updated_after parameter; deltas only via re-query + per-record content_hash diff.',
    };

    // 1) Keyless probe to confirm the gate exists (expect 401/403 without a key).
    try {
      const probeUrl = `${base}?q=cafe&fields=items.point&page_size=1`;
      const res = await fetchT(deps.fetch, probeUrl, { headers: { 'User-Agent': UA }, timeoutMs: Math.max(5000, deps.timeoutMs - 4000), allowNotOk: true });
      const body = await res.text();
      const chal = looksLikeChallenge(res.status, body);
      if (chal) notes.push(`Keyless probe hit anti-bot/limit: ${chal}.`);
      else notes.push(`Keyless probe -> HTTP ${res.status} (confirms key-gated endpoint).`);
    } catch (e) {
      notes.push(`Keyless probe failed (possible region-lock/sanctions block): ${e instanceof Error ? e.message : String(e)}.`);
    }

    if (!key) {
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('none', { reason: 'no TWOGIS_KEY; endpoint key-gated' }),
        incremental: inc,
        notes: [...notes, 'Set TWOGIS_KEY to pull a few records. Display-oriented ToS: caching/storage of POI content may need a commercial agreement.'],
      };
    }

    // 2) Keyed pull of a few records.
    try {
      const url = `${base}?q=${encodeURIComponent(input.region ?? 'cafe')}&fields=items.point,items.address,items.rubrics&page_size=${limit}&key=${encodeURIComponent(key)}`;
      const res = await fetchT(deps.fetch, url, { headers: { 'User-Agent': UA }, timeoutMs: Math.max(5000, deps.timeoutMs - 3000), allowNotOk: true });
      const txt = await res.text();
      const chal = looksLikeChallenge(res.status, txt);
      if (chal) {
        return {
          status: 'blocked',
          sourceFingerprint: sourceFp('none', { reason: chal }),
          incremental: inc,
          notes: [...notes, `Keyed request blocked: ${chal}.`],
        };
      }
      if (!res.ok) {
        return {
          status: 'needs_key',
          sourceFingerprint: sourceFp('none', { reason: `keyed request HTTP ${res.status}` }),
          incremental: inc,
          notes: [...notes, `Keyed request returned HTTP ${res.status} (key invalid, quota, or region-locked).`],
        };
      }
      const json = JSON.parse(txt) as { result?: { items?: Array<Record<string, unknown>> } };
      const items = json.result?.items ?? [];
      const records = items.slice(0, limit).map((it) => {
        const id = String(it['id'] ?? it['org_id'] ?? JSON.stringify(it).slice(0, 32));
        const point = it['point'] as { lat?: number; lon?: number } | undefined;
        return mkRecord('2gis', id, it, {
          name: typeof it['name'] === 'string' ? (it['name'] as string) : undefined,
          lat: point?.lat,
          lng: point?.lon,
          raw: it,
        });
      });
      return {
        status: records.length ? 'ok' : 'partial',
        sourceFingerprint: sourceFp('branch-id+content-hash', { count: records.length, top: records[0]?.content_hash ?? 'none' }),
        incremental: inc,
        records,
        notes: [...notes, `Keyed pull returned ${records.length} branches.`],
      };
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('none', { reason: 'keyed request exception' }),
        incremental: inc,
        notes,
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// Yandex Maps — Places/Geosearch API. Key-gated, display-only ToS.
// ---------------------------------------------------------------------------
const yandexMaps = defineConnector({
  id: 'yandex-maps',
  displayName: 'Yandex Maps Places (Geosearch API)',
  tier: 'E',
  coverage: 'Russia/CIS + global toponyms/businesses; display-only ToS (must render on a Yandex map)',
  plan: {
    access: 'Public Places HTTP API at search-maps.yandex.ru/v1/, requires key (YANDEX_API_KEY)',
    incremental: 'none — Geosearch has no since param; re-query + diff by content_hash',
    fingerprint: 'per-organization id + content_hash of returned GeoObject',
  },
  async run(input, deps) {
    const notes: string[] = [LOW_CONF];
    const limit = Math.min(input.limit ?? 10, 25);
    const base = 'https://search-maps.yandex.ru/v1/';
    const key = deps.env.YANDEX_API_KEY;
    const inc = {
      method: 'none' as const,
      supported: false,
      description: 'Yandex Geosearch exposes no since/updated_after; deltas only via re-query + per-record content_hash diff.',
    };

    // 1) Keyless probe — confirm the key gate (expect 403 "API key" error).
    try {
      const probeUrl = `${base}?text=${encodeURIComponent('cafe')}&type=biz&lang=en_US&results=1`;
      const res = await fetchT(deps.fetch, probeUrl, { headers: { 'User-Agent': UA }, timeoutMs: Math.max(5000, deps.timeoutMs - 4000), allowNotOk: true });
      const body = await res.text();
      const chal = looksLikeChallenge(res.status, body);
      if (chal) notes.push(`Keyless probe hit anti-bot/limit: ${chal}.`);
      else notes.push(`Keyless probe -> HTTP ${res.status} (confirms key-gated endpoint).`);
    } catch (e) {
      notes.push(`Keyless probe failed (possible region-lock/sanctions block): ${e instanceof Error ? e.message : String(e)}.`);
    }

    if (!key) {
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('none', { reason: 'no YANDEX_API_KEY; endpoint key-gated' }),
        incremental: inc,
        notes: [...notes, 'Set YANDEX_API_KEY to pull a few records. Display-only ToS: results must be shown on a Yandex map; storing POI content needs a separate agreement.'],
      };
    }

    // 2) Keyed pull.
    try {
      const url = `${base}?apikey=${encodeURIComponent(key)}&text=${encodeURIComponent(input.region ?? 'cafe')}&type=biz&lang=en_US&results=${limit}`;
      const res = await fetchT(deps.fetch, url, { headers: { 'User-Agent': UA }, timeoutMs: Math.max(5000, deps.timeoutMs - 3000), allowNotOk: true });
      const txt = await res.text();
      const chal = looksLikeChallenge(res.status, txt);
      if (chal) {
        return {
          status: 'blocked',
          sourceFingerprint: sourceFp('none', { reason: chal }),
          incremental: inc,
          notes: [...notes, `Keyed request blocked: ${chal}.`],
        };
      }
      if (!res.ok) {
        return {
          status: 'needs_key',
          sourceFingerprint: sourceFp('none', { reason: `keyed request HTTP ${res.status}` }),
          incremental: inc,
          notes: [...notes, `Keyed request returned HTTP ${res.status} (key invalid, quota, or region-locked).`],
        };
      }
      const json = JSON.parse(txt) as { features?: Array<{ properties?: Record<string, unknown>; geometry?: { coordinates?: number[] } }> };
      const feats = json.features ?? [];
      const records = feats.slice(0, limit).map((f, i) => {
        const props = f.properties ?? {};
        const meta = props['CompanyMetaData'] as { id?: string; name?: string } | undefined;
        const id = String(meta?.id ?? props['id'] ?? `feature-${i}`);
        const coords = f.geometry?.coordinates;
        return mkRecord('yandex-maps', id, props, {
          name: meta?.name ?? (typeof props['name'] === 'string' ? (props['name'] as string) : undefined),
          lng: Array.isArray(coords) ? coords[0] : undefined, // GeoJSON [lon, lat]
          lat: Array.isArray(coords) ? coords[1] : undefined,
          raw: props,
        });
      });
      return {
        status: records.length ? 'ok' : 'partial',
        sourceFingerprint: sourceFp('org-id+content-hash', { count: records.length, top: records[0]?.content_hash ?? 'none' }),
        incremental: inc,
        records,
        notes: [...notes, `Keyed pull returned ${records.length} organizations.`],
      };
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('none', { reason: 'keyed request exception' }),
        incremental: inc,
        notes,
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// Yandex Eda — food delivery, no public content API. Blocked / scrape-only.
// ---------------------------------------------------------------------------
const yandexEda = defineConnector({
  id: 'yandex-eda',
  displayName: 'Yandex Eda (food delivery)',
  tier: 'E',
  coverage: 'Russia (+ some CIS); restaurant/menu delivery; region-locked, no public content API',
  plan: {
    access: 'No public content API; consumer site eda.yandex.ru behind anti-bot, region-locked RU',
    incremental: 'none — no API and no usable public sitemap timestamp; would re-pull + diff by content_hash',
    fingerprint: 'content_hash of fetched listing (HEAD/landing fingerprint as fallback)',
  },
  async run(input, deps) {
    const notes: string[] = [LOW_CONF, 'Yandex Eda has no public content API (internal mobile/web endpoints only); region-locked to RU and sanctions-affected.'];
    const inc = {
      method: 'none' as const,
      supported: false,
      description: 'No public API and no usable public timestamp; any ingestion would be a full scrape + content_hash diff, not an incremental delta.',
    };

    // Cheapest classifying signal: HEAD the public landing for a fallback fingerprint
    // and detect region-lock / anti-bot.
    try {
      const hf = await headFingerprint(deps.fetch, 'https://eda.yandex.ru/', Math.max(5000, deps.timeoutMs - 4000));
      if (hf.status === 0) notes.push('Landing HEAD failed entirely (likely region-lock/sanctions network block).');
      else notes.push(`Landing HEAD -> HTTP ${hf.status}${hf.headers['content-type'] ? `, ${hf.headers['content-type']}` : ''}.`);
      const fp = hf.fp ?? sourceFp('none', { reason: hf.status ? `no cacheable headers (HTTP ${hf.status})` : 'landing unreachable' });
      return {
        status: 'blocked',
        sourceFingerprint: fp,
        incremental: inc,
        notes: [...notes, 'No sanctioned access path. Real ingestion would require a Yandex partner/API agreement; scraping is region-locked and ToS-prohibited.'],
      };
    } catch (e) {
      return {
        status: 'blocked',
        sourceFingerprint: sourceFp('none', { reason: 'landing probe exception' }),
        incremental: inc,
        notes: [...notes, `Landing probe error (region-lock likely): ${e instanceof Error ? e.message : String(e)}.`],
      };
    }
  },
});

// ---------------------------------------------------------------------------
// Talabat — Delivery Hero (MENA). No public content API; sitemap-lastmod delta.
// ---------------------------------------------------------------------------
const talabat = defineConnector({
  id: 'talabat',
  displayName: 'Talabat (Delivery Hero, MENA)',
  tier: 'E',
  coverage: 'MENA (UAE, KW, QA, BH, OM, EG, JO); restaurants/cuisines/areas; no public content API',
  plan: {
    access: 'No public content API; public sitemap index at talabat.com/sitemap/sitemap.xml.gz',
    incremental: 'sitemap-lastmod — per-URL <lastmod> in the sitemap gives the changed-restaurant set since T',
    fingerprint: 'max(sitemap <lastmod>) + URL count (no-timestamp / no-API heuristic)',
  },
  async run(input, deps) {
    const notes: string[] = [LOW_CONF, 'Talabat exposes no public content API; the sitemap is the cheapest sanctioned change signal.'];
    const tmo = Math.max(6000, deps.timeoutMs - 4000);

    // Probe the gzipped sitemap index; fetch transparently decompresses gzip so the
    // text regex in sitemapProbe still sees <sitemapindex>/<lastmod>.
    let sm = await sitemapProbe(deps.fetch, 'https://www.talabat.com/sitemap/sitemap.xml.gz', tmo);
    if (!sm) {
      // Fall back to the alternate declared path.
      sm = await sitemapProbe(deps.fetch, 'https://www.talabat.com/_sitemap/sitemap.xml.gz', tmo);
    }

    const inc = {
      method: 'sitemap-lastmod' as const,
      supported: !!sm && !sm.challenge,
      description: 'Sitemap index → per-URL <lastmod> yields the changed-restaurant set without scraping every page. Page bodies still require a browser (no API).',
    };

    if (sm?.challenge) {
      notes.push(`Sitemap blocked: ${sm.challenge} — even the sitemap is WAF/anti-bot protected; cheap fingerprinting blocked.`);
      return {
        status: 'blocked',
        sourceFingerprint: sourceFp('none', { reason: sm.challenge }),
        incremental: { ...inc, supported: false },
        notes,
      };
    }
    if (!sm) {
      notes.push('Sitemap unreachable (gzip handling, 404, or network block); HEAD fallback used for a coarse fingerprint.');
      const hf = await headFingerprint(deps.fetch, 'https://www.talabat.com/sitemap/sitemap.xml.gz', tmo).catch(() => null);
      const fp = hf?.fp ?? sourceFp('none', { reason: 'sitemap unreachable' });
      return {
        status: 'blocked',
        sourceFingerprint: fp,
        incremental: { ...inc, supported: false },
        notes,
      };
    }

    notes.push(`Sitemap probe: ${sm.urlCount} entries, maxLastmod=${sm.maxLastmod ?? 'n/a'} (this is the delta heuristic). Restaurant pages themselves need a browser; no API to read content.`);
    return {
      status: 'blocked',
      sourceFingerprint: sourceFp('sitemap-lastmod-max', {
        maxLastmod: sm.maxLastmod ?? 'none',
        urlCount: sm.urlCount,
        sample: sm.sampleLoc ?? '',
      }),
      incremental: inc,
      notes: [...notes, 'No sanctioned content API: ingestion needs a Delivery Hero partnership or a browser scrape (ToS-risky). Sitemap fingerprint is for change detection only.'],
    };
  },
});

// ---------------------------------------------------------------------------
// Sygic Travel — global trip-planning. Key-gated (x-api-key header).
// ---------------------------------------------------------------------------
const sygicTravel = defineConnector({
  id: 'sygic-travel',
  displayName: 'Sygic Travel (Places API)',
  tier: 'E',
  coverage: 'Global; curated trip-planning POIs/tours; rich place metadata',
  plan: {
    access: 'Public Places API at api.sygictravelapi.com/1.0/en/places/list, requires x-api-key (SYGIC_API_KEY)',
    incremental: 'none — places/list filters by area/category/bounds, no since param; re-query + content_hash diff',
    fingerprint: 'per-place id (poi:NNN) + content_hash of returned place object',
  },
  async run(input, deps) {
    const notes: string[] = [LOW_CONF];
    const limit = Math.min(input.limit ?? 10, 25);
    const base = 'https://api.sygictravelapi.com/1.0/en/places/list';
    const key = deps.env.SYGIC_API_KEY;
    const inc = {
      method: 'none' as const,
      supported: false,
      description: 'Sygic places/list has no since/updated_after; deltas only via re-query (by area/bounds) + per-record content_hash diff.',
    };

    // 1) Keyless probe — confirm the x-api-key gate (expect 401/403).
    try {
      const probeUrl = `${base}?query=${encodeURIComponent('eiffel')}&limit=1`;
      const res = await fetchT(deps.fetch, probeUrl, { headers: { 'User-Agent': UA }, timeoutMs: Math.max(5000, deps.timeoutMs - 4000), allowNotOk: true });
      const body = await res.text();
      const chal = looksLikeChallenge(res.status, body);
      if (chal) notes.push(`Keyless probe hit anti-bot/limit: ${chal}.`);
      else notes.push(`Keyless probe -> HTTP ${res.status} (confirms x-api-key gate).`);
    } catch (e) {
      notes.push(`Keyless probe failed: ${e instanceof Error ? e.message : String(e)}.`);
    }

    if (!key) {
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('none', { reason: 'no SYGIC_API_KEY; x-api-key gated' }),
        incremental: inc,
        notes: [...notes, 'Set SYGIC_API_KEY (x-api-key) to pull a few places. B2B key via travel.sygic.com/b2b/api-key.'],
      };
    }

    // 2) Keyed pull — places near a city query.
    try {
      const url = `${base}?query=${encodeURIComponent(input.region ?? 'city:1')}&limit=${limit}`;
      const res = await fetchT(deps.fetch, url, {
        headers: { 'User-Agent': UA, 'x-api-key': key, Accept: 'application/json' },
        timeoutMs: Math.max(5000, deps.timeoutMs - 3000),
        allowNotOk: true,
      });
      const txt = await res.text();
      const chal = looksLikeChallenge(res.status, txt);
      if (chal) {
        return {
          status: 'blocked',
          sourceFingerprint: sourceFp('none', { reason: chal }),
          incremental: inc,
          notes: [...notes, `Keyed request blocked: ${chal}.`],
        };
      }
      if (!res.ok) {
        return {
          status: 'needs_key',
          sourceFingerprint: sourceFp('none', { reason: `keyed request HTTP ${res.status}` }),
          incremental: inc,
          notes: [...notes, `Keyed request returned HTTP ${res.status} (key invalid, quota, or bad query param).`],
        };
      }
      const json = JSON.parse(txt) as { data?: { places?: Array<Record<string, unknown>> } };
      const places = json.data?.places ?? [];
      const records = places.slice(0, limit).map((p, i) => {
        const id = String(p['id'] ?? `place-${i}`);
        const loc = p['location'] as { lat?: number; lng?: number } | undefined;
        return mkRecord('sygic-travel', id, p, {
          name: typeof p['name'] === 'string' ? (p['name'] as string) : undefined,
          lat: loc?.lat,
          lng: loc?.lng,
          raw: p,
        });
      });
      return {
        status: records.length ? 'ok' : 'partial',
        sourceFingerprint: sourceFp('place-id+content-hash', { count: records.length, top: records[0]?.content_hash ?? 'none' }),
        incremental: inc,
        records,
        notes: [...notes, `Keyed pull returned ${records.length} places.`],
      };
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('none', { reason: 'keyed request exception' }),
        incremental: inc,
        notes,
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      };
    }
  },
});

export const russiaMenaConnectors: SourceConnector[] = [twogis, yandexMaps, yandexEda, talabat, sygicTravel];
