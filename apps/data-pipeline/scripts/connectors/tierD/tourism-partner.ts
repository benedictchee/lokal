/**
 * Tier D — partner-gated tourism distribution exchanges + curated guides.
 *
 * These are the "you need a deal" sources: national DMO distribution APIs behind
 * a distributor/syndication agreement, plus curated guides (Michelin, AllTrails)
 * that publish NO public API and defend their pages with anti-bot WAFs.
 *
 * Each connector runs a REAL lightweight probe to CLASSIFY the wall:
 *   - ATDW / Visit Finland: keyless probe confirms the auth gate; if the env key
 *     is present we pull a few real records, else status 'needs_key'.
 *   - TXGB / Tourism NZ Business DB: distributor/syndication contract required →
 *     'needs_license', fingerprinted via the reachable docs/portal HEAD.
 *   - Tourism NZ also has an OPEN stats side on data.govt.nz (CKAN) — we probe
 *     that for free and note it as the unblocked alternative.
 *   - Michelin / AllTrails: no API → sitemapProbe for the fingerprint + delta;
 *     'blocked' (AllTrails additionally fronted by DataDome).
 *   - Factual: defunct (merged into Foursquare, 2020) → no independent product.
 */
import { defineConnector } from '../core/connector.js';
import { fetchT, headFingerprint, sitemapProbe, looksLikeChallenge, sourceFp, mkRecord, UA } from '../core/fingerprint.js';
import type { SourceConnector } from '../core/types.js';

/** Narrow an unknown error to a short message (avoids `any`). */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ───────────────────────────────────────────────────────────────────────────
// ATDW — Australian Tourism Data Warehouse (ATLAS REST API)
// Real API: https://atlas.atdw-online.com.au/api/atlas/products?key=KEY
// Distributor licence + API key required. Delta product endpoints support an
// updated-since filter; fingerprint = product count + max updated.
// ───────────────────────────────────────────────────────────────────────────
export const atdw = defineConnector({
  id: 'atdw',
  displayName: 'ATDW — Australian Tourism Data Warehouse (ATLAS)',
  tier: 'D',
  coverage: 'Australia; EN; national tourism product DB (accommodation, attractions, tours, events)',
  plan: {
    access: 'ATLAS REST API (atlas.atdw-online.com.au) — distributor agreement + ATDW_API_KEY',
    incremental: "products endpoint takes updatedSince/updatedFrom → server-side timestamp delta (api-since-param)",
    fingerprint: 'numberOfResults (product count) + max(updated) across the page',
  },
  async run(input, deps) {
    const notes: string[] = [];
    const key = deps.env.ATDW_API_KEY;
    const base = 'https://atlas.atdw-online.com.au/api/atlas/products';
    const limit = Math.min(input.limit ?? 10, 25);

    if (!key) {
      // Keyless probe — confirm the gate without a credential. ATLAS rejects a
      // missing/invalid key (expected 401/403), which is the experiment.
      let probeStatus = 0;
      let challenge: string | null = null;
      try {
        const res = await fetchT(deps.fetch, `${base}?out=json&size=1`, {
          headers: { 'User-Agent': UA },
          timeoutMs: Math.max(8000, deps.timeoutMs - 4000),
          allowNotOk: true,
        });
        probeStatus = res.status;
        challenge = looksLikeChallenge(res.status, await res.text());
      } catch (e) {
        notes.push(`Keyless probe failed: ${errMsg(e)}.`);
      }
      if (challenge) notes.push(`Edge protection on probe: ${challenge}.`);
      notes.push(
        `No ATDW_API_KEY set; keyless probe returned HTTP ${probeStatus} (auth gate confirmed).`,
        'Requires an ATDW distributor agreement; the key both authenticates and resolves your distributorId. Set ATDW_API_KEY to pull /products.',
      );
      return {
        status: 'needs_key',
        // No content yet — fingerprint records the gate so a later keyed run flips it.
        sourceFingerprint: sourceFp('product-count+max-updated', { gated: 'no-key', probeStatus }),
        incremental: {
          method: 'api-since-param',
          supported: false,
          description:
            "ATLAS /products accepts an updatedSince/updatedFrom date → returns only products changed since T. Resumable by page (pge). Requires the distributor key first.",
        },
        notes,
      };
    }

    // Keyed pull: products page, newest-updated first, optional since filter.
    try {
      const params = new URLSearchParams({ key, out: 'json', size: String(limit), pge: '1' });
      if (input.sinceTimestamp) params.set('updatedSince', input.sinceTimestamp.slice(0, 10));
      const res = await fetchT(deps.fetch, `${base}?${params}`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        timeoutMs: deps.timeoutMs - 3000,
        allowNotOk: true,
      });
      const text = await res.text();
      const challenge = looksLikeChallenge(res.status, text);
      if (challenge) {
        return {
          status: 'blocked',
          sourceFingerprint: sourceFp('none', { reason: challenge }),
          incremental: { method: 'api-since-param', supported: true, description: 'updatedSince delta supported; blocked by edge protection this run.' },
          notes: [...notes, `Edge protection: ${challenge}.`],
        };
      }
      if (res.status === 401 || res.status === 403) {
        return {
          status: 'needs_key',
          sourceFingerprint: sourceFp('product-count+max-updated', { gated: 'key-rejected', probeStatus: res.status }),
          incremental: { method: 'api-since-param', supported: false, description: 'updatedSince delta; supplied key was rejected.' },
          notes: [...notes, `ATDW_API_KEY present but rejected (HTTP ${res.status}); check distributor entitlement.`],
        };
      }
      const json = JSON.parse(text) as {
        numberOfResults?: number;
        products?: Array<{ productId?: string; productName?: string; status?: string; updated?: string; addresses?: Array<{ geocodeGdaLatitude?: string; geocodeGdaLongitude?: string }> }>;
      };
      const products = json.products ?? [];
      const records = products.map((p) => {
        const addr = p.addresses?.[0];
        const lat = addr?.geocodeGdaLatitude ? Number(addr.geocodeGdaLatitude) : undefined;
        const lng = addr?.geocodeGdaLongitude ? Number(addr.geocodeGdaLongitude) : undefined;
        return mkRecord('atdw', String(p.productId ?? p.productName ?? 'unknown'), p, {
          name: p.productName,
          updated_at: p.updated,
          lat: Number.isFinite(lat) ? lat : undefined,
          lng: Number.isFinite(lng) ? lng : undefined,
          raw: p,
        });
      });
      const maxUpdated = records.map((r) => r.updated_at).filter((x): x is string => !!x).sort().at(-1) ?? 'unknown';
      return {
        status: records.length ? 'ok' : 'partial',
        sourceFingerprint: sourceFp('product-count+max-updated', { numberOfResults: json.numberOfResults ?? records.length, maxUpdated }),
        incremental: {
          method: 'api-since-param',
          supported: true,
          description: "ATLAS /products?updatedSince=YYYY-MM-DD returns only products changed since T; page via pge. Server-side timestamp delta.",
          sinceApplied: input.sinceTimestamp,
        },
        records,
        notes: [...notes, `Pulled ${records.length} ATDW products via ATDW_API_KEY (numberOfResults=${json.numberOfResults ?? '?'}).`],
      };
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('none', { reason: 'keyed pull threw' }),
        incremental: { method: 'api-since-param', supported: true, description: 'updatedSince delta supported; request failed this run.' },
        notes: [...notes, `Keyed pull failed: ${errMsg(e)}.`],
        error: errMsg(e),
      };
    }
  },
});

// ───────────────────────────────────────────────────────────────────────────
// TXGB — Tourism Exchange Great Britain (VisitBritain B2B booking exchange)
// No open self-serve data API: distributor onboarding/contract with TXGB.
// Live availability is the "delta". We fingerprint via the reachable portal HEAD.
// ───────────────────────────────────────────────────────────────────────────
export const txgbVisitbritain = defineConnector({
  id: 'txgb-visitbritain',
  displayName: 'TXGB — Tourism Exchange Great Britain (VisitBritain)',
  tier: 'D',
  coverage: 'Great Britain (England/Wales/Scotland/NI); EN; B2B tourism product + live availability exchange',
  plan: {
    access: 'B2B booking exchange; distributor onboarding/contract with TXGB (open API issued after agreement)',
    incremental: 'live availability + price feed per product (push); no public updated-since list',
    fingerprint: 'product/version marker from the public portal (HEAD ETag/Last-Modified)',
  },
  async run(_input, deps) {
    const notes: string[] = [];
    // Portal + docs are public; the data API itself is contract-gated. HEAD the
    // marketing/portal pages for an ETag/Last-Modified version fingerprint.
    let fp = sourceFp('none', { reason: 'portal HEAD unreachable' });
    let status = 0;
    try {
      const probe = await headFingerprint(deps.fetch, 'https://www.txgb.co.uk/', Math.max(8000, deps.timeoutMs - 4000));
      status = probe.status;
      if (probe.fp) {
        fp = probe.fp;
        notes.push(`Portal HEAD ok (HTTP ${status}); fingerprint via ${probe.fp.method}.`);
      } else {
        notes.push(`Portal HEAD returned HTTP ${status} with no validators; no cheap version marker exposed publicly.`);
      }
    } catch (e) {
      notes.push(`Portal HEAD failed: ${errMsg(e)}.`);
    }
    notes.push(
      'TXGB is a B2B exchange built with VisitBritain; the booking/content API is issued only after distributor onboarding (a partner agreement). No keyless data endpoint exists to probe.',
      'Real ingestion = onboard as a distributor, then consume the live availability/price + content feed per connected supplier.',
    );
    return {
      status: 'needs_license',
      sourceFingerprint: fp,
      incremental: {
        method: 'full-only',
        supported: false,
        description:
          'TXGB pushes LIVE availability/price per product to onboarded distributors; there is no public updated-since catalog list. Delta is effectively the live feed once contracted — until then, no incremental access.',
      },
      notes,
    };
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Visit Finland — DataHub GraphQL (free, but accepted/contracted publishers only)
// Endpoint base: https://datahub.visitfinland.com/  (GraphQL).
// env VISITFINLAND_TOKEN. Delta = product updates; fingerprint = product count + updated.
// ───────────────────────────────────────────────────────────────────────────
export const visitFinland = defineConnector({
  id: 'visit-finland',
  displayName: 'Visit Finland DataHub (GraphQL)',
  tier: 'D',
  coverage: 'Finland; FI/EN/SV; ~8k travel products from ~2k companies; internal/business-use only',
  plan: {
    access: 'DataHub GraphQL API (datahub.visitfinland.com) — free but accepted publishers only; VISITFINLAND_TOKEN',
    incremental: "query products by updatedAt/modified → product-updates delta (api-since-param)",
    fingerprint: 'totalCount of products + max(updatedAt)',
  },
  async run(input, deps) {
    const notes: string[] = [];
    const token = deps.env.VISITFINLAND_TOKEN;
    // The GraphQL endpoint conventionally lives under the DataHub host.
    const gql = 'https://datahub.visitfinland.com/graphql';
    const limit = Math.min(input.limit ?? 10, 25);

    if (!token) {
      // Unauthenticated POST probe — confirm the endpoint exists + is gated
      // (expected 401/403/400) without a token. This is the keyless experiment.
      let probeStatus = 0;
      let challenge: string | null = null;
      try {
        const res = await fetchT(deps.fetch, gql, {
          method: 'POST',
          headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ __typename }' }),
          timeoutMs: Math.max(8000, deps.timeoutMs - 4000),
          allowNotOk: true,
        });
        probeStatus = res.status;
        challenge = looksLikeChallenge(res.status, await res.text());
      } catch (e) {
        notes.push(`Keyless GraphQL probe failed: ${errMsg(e)}.`);
      }
      if (challenge) notes.push(`Edge protection on probe: ${challenge}.`);
      notes.push(
        `No VISITFINLAND_TOKEN set; unauthenticated GraphQL probe returned HTTP ${probeStatus} (gate confirmed).`,
        'DataHub is free but restricted to accepted publishers (internal business use). Request access, then set VISITFINLAND_TOKEN.',
      );
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('product-count+max-updated', { gated: 'no-token', probeStatus }),
        incremental: {
          method: 'api-since-param',
          supported: false,
          description: 'GraphQL products query supports an updatedAt/modified filter → product-updates delta. Requires an accepted-publisher token first.',
        },
        notes,
      };
    }

    // Tokened pull. Field names vary by schema version; we keep the query minimal
    // and degrade gracefully (fingerprint-only) if the shape differs.
    try {
      const query = `query($n:Int){ products(first:$n){ totalCount edges{ node{ id name updatedAt } } } }`;
      const res = await fetchT(deps.fetch, gql, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query, variables: { n: limit } }),
        timeoutMs: deps.timeoutMs - 3000,
        allowNotOk: true,
      });
      const text = await res.text();
      const challenge = looksLikeChallenge(res.status, text);
      if (challenge || res.status === 401 || res.status === 403) {
        return {
          status: challenge ? 'blocked' : 'needs_key',
          sourceFingerprint: sourceFp('product-count+max-updated', { gated: challenge ?? `http-${res.status}` }),
          incremental: { method: 'api-since-param', supported: false, description: 'updatedAt delta; token rejected or blocked this run.' },
          notes: [...notes, challenge ? `Edge protection: ${challenge}.` : `Token rejected (HTTP ${res.status}).`],
        };
      }
      const json = JSON.parse(text) as {
        data?: { products?: { totalCount?: number; edges?: Array<{ node?: { id?: string; name?: string; updatedAt?: string } }> } };
        errors?: Array<{ message?: string }>;
      };
      if (json.errors?.length) {
        notes.push(`GraphQL returned errors (schema drift): ${json.errors.map((e) => e.message).join('; ')}. Reporting fingerprint-only.`);
      }
      const conn = json.data?.products;
      const edges = conn?.edges ?? [];
      const records = edges
        .map((e) => e.node)
        .filter((n): n is { id?: string; name?: string; updatedAt?: string } => !!n)
        .map((n) => mkRecord('visit-finland', String(n.id ?? n.name ?? 'unknown'), n, { name: n.name, updated_at: n.updatedAt, raw: n }));
      const maxUpdated = records.map((r) => r.updated_at).filter((x): x is string => !!x).sort().at(-1) ?? 'unknown';
      return {
        status: records.length ? 'ok' : 'partial',
        sourceFingerprint: sourceFp('product-count+max-updated', { totalCount: conn?.totalCount ?? records.length, maxUpdated }),
        incremental: {
          method: 'api-since-param',
          supported: true,
          description: 'GraphQL products(filter:{updatedAt_gt:T}) returns only products changed since T; cursor edges make it resumable.',
          sinceApplied: input.sinceTimestamp,
        },
        records,
        notes: [...notes, `Pulled ${records.length} DataHub products via VISITFINLAND_TOKEN (totalCount=${conn?.totalCount ?? '?'}).`],
      };
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('none', { reason: 'tokened GraphQL pull threw' }),
        incremental: { method: 'api-since-param', supported: true, description: 'updatedAt delta supported; request failed this run.' },
        notes: [...notes, `Tokened pull failed: ${errMsg(e)}.`],
        error: errMsg(e),
      };
    }
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Tourism New Zealand — Business Database API (syndication agreement)
// Gated: access by emailing register@tnz.govt.nz (syndication agreement).
// OPEN side: tourism stats on catalogue.data.govt.nz (CKAN) — free; we probe it.
// ───────────────────────────────────────────────────────────────────────────
export const tourismNz = defineConnector({
  id: 'tourism-nz',
  displayName: 'Tourism New Zealand Business Database',
  tier: 'D',
  coverage: 'New Zealand; EN; tourism operator/business database (newzealand.com)',
  plan: {
    access: 'Business DB API by syndication agreement (register@tnz.govt.nz); separate OPEN tourism stats on data.govt.nz (CKAN)',
    incremental: 'operator/business changes feed once syndicated; open stats via CKAN metadata_modified',
    fingerprint: 'operator/business count (gated API); CKAN dataset metadata_modified (open side)',
  },
  async run(input, deps) {
    const notes: string[] = [];

    // 1) Probe the OPEN side first — the data.govt.nz CKAN catalogue is free and
    //    gives us a real, working fingerprint + delta even without the contract.
    let openFp = sourceFp('none', { reason: 'CKAN probe unreachable' });
    let openSupported = false;
    try {
      const ck = await fetchT(
        deps.fetch,
        'https://catalogue.data.govt.nz/api/3/action/package_search?q=tourism&rows=3&sort=metadata_modified+desc',
        { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeoutMs: Math.max(8000, deps.timeoutMs - 5000), allowNotOk: true },
      );
      const text = await ck.text();
      const challenge = looksLikeChallenge(ck.status, text);
      if (challenge) {
        notes.push(`data.govt.nz CKAN probe hit edge protection: ${challenge}.`);
      } else if (ck.ok) {
        const json = JSON.parse(text) as { result?: { count?: number; results?: Array<{ title?: string; metadata_modified?: string }> } };
        const top = json.result?.results?.[0];
        const maxMod = (json.result?.results ?? []).map((r) => r.metadata_modified).filter((x): x is string => !!x).sort().at(-1) ?? 'unknown';
        openFp = sourceFp('ckan-metadata_modified+count', { count: json.result?.count ?? 0, maxMod });
        openSupported = true;
        notes.push(`OPEN stats: data.govt.nz CKAN has ${json.result?.count ?? 0} "tourism" datasets; newest "${top?.title ?? '?'}" metadata_modified=${maxMod}. This side is free (CKAN package_search + DataStore), delta via metadata_modified.`);
      } else {
        notes.push(`data.govt.nz CKAN probe returned HTTP ${ck.status}.`);
      }
    } catch (e) {
      notes.push(`data.govt.nz CKAN probe failed: ${errMsg(e)}.`);
    }

    // 2) The Business Database API itself is contract-gated (syndication
    //    agreement). HEAD the public web-services docs page for a version marker.
    let docsStatus = 0;
    try {
      const docs = await headFingerprint(deps.fetch, 'https://www.newzealand.com/nz/utilities/web-services/', Math.max(6000, deps.timeoutMs - 6000));
      docsStatus = docs.status;
      notes.push(`Business DB docs HEAD HTTP ${docsStatus}${docs.fp ? ` (version via ${docs.fp.method})` : ''}.`);
    } catch (e) {
      notes.push(`Business DB docs HEAD failed: ${errMsg(e)}.`);
    }
    notes.push(
      'Tourism NZ Business Database API requires a SYNDICATION AGREEMENT — request via register@tnz.govt.nz; no keyless data endpoint to probe.',
      'Recommendation: ingest the OPEN data.govt.nz tourism stats now (free CKAN delta), and pursue the syndication agreement for the operator-level Business DB.',
    );

    return {
      status: 'needs_license',
      // Prefer the open-side fingerprint when we got one (it's a real signal);
      // otherwise fall back to the gated-docs marker.
      sourceFingerprint: openSupported ? openFp : sourceFp('operator-count', { gated: 'syndication-agreement', docsStatus }),
      incremental: {
        method: openSupported ? 'api-since-param' : 'full-only',
        supported: openSupported,
        description: openSupported
          ? "OPEN side: CKAN package_search?sort=metadata_modified desc → datasets changed since T (api-since-param). GATED Business DB: operator-changes feed only after syndication."
          : 'GATED Business DB: operator-changes feed after syndication. Open CKAN side unreachable this run.',
        sinceApplied: openSupported ? input.sinceTimestamp : undefined,
      },
      notes,
    };
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Michelin Guide — no public API; licensed via TripAdvisor/TheFork partnerships.
// Delta = annual selection; fingerprint = selection year + sitemap (lastmod/count).
// ───────────────────────────────────────────────────────────────────────────
export const michelinGuide = defineConnector({
  id: 'michelin-guide',
  displayName: 'Michelin Guide',
  tier: 'D',
  coverage: 'Global; multi-lang; starred/Bib Gourmand restaurants + hotels (curated selection)',
  plan: {
    access: 'No public API. Content licensed via partners (TripAdvisor/TheFork). Web pages are WAF-protected.',
    incremental: 'Annual (per-country) selection release; between releases use sitemap <lastmod> changed set (sitemap-lastmod)',
    fingerprint: 'selection year (release marker) + max(sitemap lastmod) + URL count',
  },
  async run(_input, deps) {
    const notes: string[] = [];
    const sm = await sitemapProbe(deps.fetch, 'https://guide.michelin.com/sitemap.xml', Math.max(8000, deps.timeoutMs - 4000));
    const year = new Date().getUTCFullYear(); // selection-year release marker
    let fp = sourceFp('selection-year+sitemap', { selectionYear: year, sitemap: 'unreachable' });
    if (sm?.challenge) {
      fp = sourceFp('selection-year', { selectionYear: year, sitemapBlocked: sm.challenge });
      notes.push(`Sitemap blocked: ${sm.challenge} — guide.michelin.com is WAF-protected, so even cheap sitemap fingerprinting needs the challenge solved.`);
    } else if (sm) {
      fp = sourceFp('selection-year+sitemap', { selectionYear: year, maxLastmod: sm.maxLastmod ?? 'none', urlCount: sm.urlCount });
      notes.push(`Sitemap probe: ${sm.urlCount} entries, maxLastmod=${sm.maxLastmod ?? 'n/a'} (between-release change heuristic).`);
    } else {
      notes.push('Sitemap unreachable (no response); falling back to selection-year fingerprint only.');
    }
    notes.push(
      'No public API. Michelin content is distributed via licensed partners (TripAdvisor/TheFork); ToS-restricted scraping is not a sanctioned path.',
      'Real ingestion = a content licence (partner deal). The annual per-country selection is the natural full-refresh boundary.',
    );
    return {
      status: 'blocked',
      sourceFingerprint: fp,
      incremental: {
        method: 'sitemap-lastmod',
        supported: !!(sm && !sm.challenge),
        description:
          'Coarse delta = annual selection release (full refresh). Finer between-release delta = sitemap <lastmod> changed-URL set — but the sitemap is WAF-gated, so this needs partner access.',
      },
      notes,
    };
  },
});

// ───────────────────────────────────────────────────────────────────────────
// AllTrails — no public API; DataDome anti-scrape; licensing deal-by-deal.
// Delta = sitemap <lastmod>; fingerprint = sitemap (lastmod max + URL count).
// ───────────────────────────────────────────────────────────────────────────
export const alltrails = defineConnector({
  id: 'alltrails',
  displayName: 'AllTrails',
  tier: 'D',
  coverage: 'Global; multi-lang; ~400k hiking/biking/running trails with geometry + reviews',
  plan: {
    access: 'No public API. DataDome anti-scrape on web + API routes. Licensing handled deal-by-deal.',
    incremental: 'sitemap <lastmod> per trail URL → changed-trail set (sitemap-lastmod)',
    fingerprint: 'max(sitemap lastmod) + trail-URL count',
  },
  async run(_input, deps) {
    const notes: string[] = [];
    // AllTrails publishes a Rails-generated sitemap index (per robots.txt).
    const sm = await sitemapProbe(deps.fetch, 'https://www.alltrails.com/sitemap/rails/index.xml', Math.max(8000, deps.timeoutMs - 4000));
    let fp = sourceFp('sitemap-lastmod-max', { sitemap: 'unreachable' });
    if (sm?.challenge) {
      fp = sourceFp('none', { reason: sm.challenge });
      notes.push(`Sitemap blocked: ${sm.challenge} — DataDome fronts AllTrails, so even the sitemap is challenged; cheap fingerprinting needs the challenge solved or a deal.`);
    } else if (sm) {
      fp = sourceFp('sitemap-lastmod-max', { maxLastmod: sm.maxLastmod ?? 'none', urlCount: sm.urlCount, sample: sm.sampleLoc ?? '' });
      notes.push(`Sitemap probe: ${sm.urlCount} entries, maxLastmod=${sm.maxLastmod ?? 'n/a'} (the delta heuristic if reachable).`);
    } else {
      notes.push('Sitemap unreachable (likely DataDome block on the request).');
    }
    notes.push(
      'No public API; site + API routes are protected by DataDome anti-scrape. AllTrails licenses data deal-by-deal — that is the sanctioned path.',
      'Page bodies (trail geometry/reviews) require a browser + challenge-solving even where the sitemap is readable; out of scope without a licence.',
    );
    return {
      status: 'blocked',
      sourceFingerprint: fp,
      incremental: {
        method: 'sitemap-lastmod',
        supported: !!(sm && !sm.challenge),
        description:
          'Sitemap <lastmod> would give the changed-trail set since T without re-crawling — but DataDome typically blocks the sitemap too. Real access = a licensing deal.',
      },
      notes,
    };
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Factual — DEFUNCT as an independent product. Merged into Foursquare (2020).
// No endpoint to probe; the successor is Foursquare OS Places (tier A bulk).
// ───────────────────────────────────────────────────────────────────────────
export const factual = defineConnector({
  id: 'factual',
  displayName: 'Factual (defunct → Foursquare)',
  tier: 'D',
  coverage: 'Formerly global POI/places data; product discontinued',
  plan: {
    access: 'Defunct. Factual merged into Foursquare (2020); no independent API remains.',
    incremental: 'n/a (no product)',
    fingerprint: 'none',
  },
  async run(_input, _deps) {
    // Nothing to probe — Factual.com no longer serves a data product. We assert
    // the redirect to the successor rather than fabricate a dead-endpoint request.
    return {
      status: 'blocked',
      sourceFingerprint: sourceFp('none', { reason: 'product discontinued — merged into Foursquare 2020' }),
      incremental: {
        method: 'none',
        supported: false,
        description: 'No product exists. Successor is Foursquare; use the Foursquare OS Places open bulk dataset (already covered in tier A).',
      },
      notes: [
        'Factual was acquired by / merged into Foursquare in 2020; the standalone Factual Places/Geopulse APIs were sunset.',
        'No endpoint to probe. Use the Foursquare Open Source Places dataset (anonymous S3 bulk) as the modern equivalent — see tierA/open-bulk-s3.',
      ],
    };
  },
});

export const tierDTourismConnectors: SourceConnector[] = [
  atdw,
  txgbVisitbritain,
  visitFinland,
  tourismNz,
  michelinGuide,
  alltrails,
  factual,
];
