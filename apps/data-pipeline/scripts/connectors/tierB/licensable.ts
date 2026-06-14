/**
 * Tier B — licensable-commercial sources.
 *
 * These need a paid data licence / signed partner contract (or, where a free
 * developer tier exists, an API key) before real ingestion is sanctioned. The
 * realistic PROTOTYPE PROBE for this tier is therefore NOT a full pull but a
 * lightweight reachability + gate classification:
 *
 *   1. HEAD (or sitemapProbe) the developer/docs/portal URL to (a) confirm the
 *      source is alive and (b) capture a cheap source fingerprint we can diff on
 *      future runs (ETag / Last-Modified / sitemap max-lastmod / portal hash).
 *   2. Classify the gate: `needs_license` (paid contract) or `needs_key` (a free
 *      dev tier exists and a credential env var is set) — defaulting to the
 *      stricter one when no credential is present.
 *   3. Document the LICENSED delta mechanism + fingerprint that production would
 *      use once the contract is signed (per-source `plan`).
 *   4. Where a credential IS present (e.g. REDDIT_*, WIKIMEDIA_ENTERPRISE_TOKEN),
 *      authenticate and pull a few real records so the experiment proves the path.
 *
 * Every run() is defensive: all network calls are wrapped, a sourceFingerprint is
 * always returned (sourceFp), and records are capped at min(limit ?? 10, 25).
 */
import { defineConnector } from '../core/connector.js';
import {
  fetchT,
  headFingerprint,
  sitemapProbe,
  looksLikeChallenge,
  sourceFp,
  mkRecord,
  UA,
} from '../core/fingerprint.js';
import type { SourceConnector, SourceFingerprint, PulledRecord } from '../core/types.js';

/** Records cap for prototype runs — keeps every experiment cheap. */
function recCap(limit?: number): number {
  return Math.min(limit ?? 10, 25);
}

/**
 * Shared helper: HEAD a docs/portal URL, returning a fingerprint + a note. Falls
 * back to a stable 'portal' fingerprint (so future diffs still work) if the HEAD
 * exposes no validators. Never throws.
 */
async function portalFingerprint(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<{ fp: SourceFingerprint; reachable: boolean; note: string }> {
  try {
    const probe = await headFingerprint(fetchFn, url, timeoutMs);
    if (probe.fp) {
      return {
        fp: probe.fp,
        reachable: probe.status > 0 && probe.status < 500,
        note: `Portal HEAD ${url} → HTTP ${probe.status}; fingerprint via ${probe.fp.method}.`,
      };
    }
    // No validators on the HEAD; fingerprint the host+status so we still diff.
    return {
      fp: sourceFp('portal-status', { url, status: probe.status }),
      reachable: probe.status > 0 && probe.status < 500,
      note: `Portal HEAD ${url} → HTTP ${probe.status}; no ETag/Last-Modified, fingerprinting URL+status.`,
    };
  } catch (e) {
    return {
      fp: sourceFp('none', { reason: 'portal HEAD failed', url }),
      reachable: false,
      note: `Portal HEAD ${url} failed: ${e instanceof Error ? e.message : String(e)}.`,
    };
  }
}

/* ------------------------------------------------------------------------- *
 * 1. Wikimedia Enterprise (WME)                                             *
 *    Free dev tier (30 req/mo) → needs_key. With a token, hit the On-demand *
 *    article endpoint for a few records; document the Realtime/Snapshot     *
 *    delta. Auth: https://auth.enterprise.wikimedia.com/v1/login; API base  *
 *    https://api.enterprise.wikimedia.com/v2.                               *
 * ------------------------------------------------------------------------- */
export const wikimediaEnterprise = defineConnector({
  id: 'wikimedia-enterprise',
  displayName: 'Wikimedia Enterprise (WME)',
  tier: 'B',
  coverage: 'Global, all Wikimedia projects/langs; commercial T&Cs (free tier 30 req/mo)',
  plan: {
    access:
      'Wikimedia Enterprise API. Free trial tier (30 req/mo) needs a token (WIKIMEDIA_ENTERPRISE_TOKEN via auth.enterprise.wikimedia.com/v1/login); higher volume is a paid contract.',
    incremental:
      'Realtime API stream (server-sent edit events) + On-demand article fetch — true changes-feed. Snapshot API gives dated full dumps for backfill.',
    fingerprint:
      'Snapshot date_modified / namespace (Snapshot API); per-article version.identifier + date_modified (On-demand).',
  },
  async run(input, deps) {
    const notes: string[] = [];
    const token = deps.env.WIKIMEDIA_ENTERPRISE_TOKEN;
    const apiBase = 'https://api.enterprise.wikimedia.com/v2';

    // Always fingerprint the docs portal so we have a cheap change signal even
    // without a token.
    const portal = await portalFingerprint(deps.fetch, 'https://enterprise.wikimedia.com/docs/', deps.timeoutMs - 4000);
    notes.push(portal.note);

    const incremental = {
      method: 'changes-feed' as const,
      supported: true,
      description:
        'Realtime API streams edit events (changes-feed); On-demand fetches the current article by name. Snapshot API provides dated full dumps for periodic backfill. Production tails Realtime and re-pulls only changed article names.',
      sinceApplied: input.sinceTimestamp,
    };

    if (!token) {
      // Keyless probe: confirm the auth gate is live (expect 401/403/400).
      let gate = 0;
      try {
        const res = await fetchT(deps.fetch, `${apiBase}/articles/Berlin`, {
          method: 'GET',
          headers: { 'User-Agent': UA, Accept: 'application/json' },
          timeoutMs: Math.min(12_000, deps.timeoutMs - 3000),
          allowNotOk: true,
        });
        gate = res.status;
      } catch (e) {
        notes.push(`Keyless On-demand probe failed: ${e instanceof Error ? e.message : String(e)}.`);
      }
      notes.push(
        `No WIKIMEDIA_ENTERPRISE_TOKEN set; keyless On-demand probe returned HTTP ${gate} (auth gate confirmed). Set the token (Bearer) to pull On-demand/Realtime.`,
      );
      return {
        status: 'needs_key',
        sourceFingerprint: portal.fp,
        incremental,
        notes,
      };
    }

    // Token present → pull a few On-demand articles (cheap, well under free-tier cap).
    const names = ['Berlin', 'Kyoto', 'George_Town,_Penang', 'Lisbon', 'Cape_Town'];
    const want = recCap(input.limit);
    const records: PulledRecord[] = [];
    let newest = '';
    try {
      for (const name of names.slice(0, want)) {
        const res = await fetchT(deps.fetch, `${apiBase}/articles/${encodeURIComponent(name)}`, {
          method: 'GET',
          headers: { 'User-Agent': UA, Authorization: `Bearer ${token}`, Accept: 'application/json' },
          timeoutMs: Math.min(12_000, deps.timeoutMs - 3000),
          allowNotOk: true,
        });
        if (!res.ok) {
          notes.push(`On-demand /articles/${name} → HTTP ${res.status}.`);
          continue;
        }
        // On-demand returns an array of project variants for the name.
        const arr = (await res.json()) as Array<{
          name?: string;
          identifier?: number;
          date_modified?: string;
          version?: { identifier?: number };
          is_part_of?: { identifier?: string };
        }>;
        const art = Array.isArray(arr) ? arr[0] : undefined;
        if (!art) continue;
        const sid = `${art.is_part_of?.identifier ?? 'wiki'}:${art.identifier ?? name}`;
        if (art.date_modified && art.date_modified > newest) newest = art.date_modified;
        records.push(mkRecord('wikimedia-enterprise', sid, art, { name: art.name ?? name, updated_at: art.date_modified, raw: art }));
      }
    } catch (e) {
      notes.push(`On-demand pull error: ${e instanceof Error ? e.message : String(e)}.`);
    }

    if (!records.length) {
      notes.push('Token present but no articles returned; treating as needs_key (token may be expired/invalid).');
      return { status: 'needs_key', sourceFingerprint: portal.fp, incremental, notes };
    }
    return {
      status: 'ok',
      sourceFingerprint: sourceFp('article-date_modified+count', { newest: newest || 'unknown', count: records.length }),
      incremental,
      records,
      notes: [...notes, `Pulled ${records.length} On-demand article(s) via WIKIMEDIA_ENTERPRISE_TOKEN; newest date_modified=${newest || 'n/a'}.`],
    };
  },
});

/* ------------------------------------------------------------------------- *
 * 2. SafeGraph — paid global POI; monthly Parquet drops. needs_license.     *
 * ------------------------------------------------------------------------- */
export const safegraph = defineConnector({
  id: 'safegraph',
  displayName: 'SafeGraph (Places / Dewey)',
  tier: 'B',
  coverage: 'Global POI + geometry + patterns; paid licence (now via Dewey marketplace)',
  plan: {
    access:
      'Paid data licence. Monthly Parquet drops delivered to a customer S3 bucket / marketplace (AWS Data Exchange, Snowflake, Dewey). No keyless API.',
    incremental:
      'Monthly delivery: each release is a dated partition; production diffs the new monthly Parquet against the prior month by SafeGraph PLACEKEY (dump-diff).',
    fingerprint: 'Monthly release date (delivery partition, e.g. release_month=YYYY-MM) + file manifest checksum.',
  },
  async run(_input, deps) {
    const portal = await portalFingerprint(deps.fetch, 'https://www.safegraph.com/', deps.timeoutMs - 4000);
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental: {
        method: 'dump-diff',
        supported: true,
        description:
          'Monthly Parquet delivery to a licensed bucket/marketplace; each release is a dated partition. Delta = diff the new month vs prior month on PLACEKEY + content_hash. No public/keyless endpoint exists.',
      },
      notes: [
        portal.note,
        'Paid data licence required (SafeGraph Places now distributed via Dewey / AWS Data Exchange / Snowflake). Prototype confirms reachability + documents the monthly dump-diff delta; real ingestion needs a signed contract and a delivery bucket.',
      ],
    };
  },
});

/* ------------------------------------------------------------------------- *
 * 3. HERE bulk — enterprise Data API / Marketplace. needs_license.          *
 *    (HERE's free dev API is a separate Tier C connector.)                  *
 * ------------------------------------------------------------------------- */
export const hereBulk = defineConnector({
  id: 'here-bulk',
  displayName: 'HERE (enterprise bulk / Marketplace)',
  tier: 'B',
  coverage: 'Global maps/POI/places; HERE Marketplace + enterprise Data API; paid licence',
  plan: {
    access:
      'HERE enterprise Data API / Marketplace bulk catalogs (HERE platform). Paid licence + platform credentials. NOT the free freemium dev API (that is a separate Tier C connector).',
    incremental:
      'Enterprise delta: HERE platform catalogs are versioned; subscribe to a catalog and pull the changelog between catalog versions (versioned dump-diff).',
    fingerprint: 'Catalog dataset version (HERE platform catalog version id) + layer partition checksums.',
  },
  async run(_input, deps) {
    const portal = await portalFingerprint(deps.fetch, 'https://www.here.com/platform/data-marketplace', deps.timeoutMs - 4000);
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental: {
        method: 'dump-diff',
        supported: true,
        description:
          'HERE platform catalogs are versioned; production subscribes to a licensed catalog and reads the changelog between catalog versions (versioned dump-diff). Requires platform credentials + a commercial agreement.',
      },
      notes: [
        portal.note,
        'Enterprise/Marketplace bulk needs a paid HERE licence + platform credentials. The free HERE dev/freemium API (REST geocode/discover) is modelled separately as a Tier C connector.',
      ],
    };
  },
});

/* ------------------------------------------------------------------------- *
 * 4. Yelp Data Licensing — paid Places/AI API; US reviews. needs_license.   *
 *    (Free Fusion = Tier C.) Probe the data-licensing portal.               *
 * ------------------------------------------------------------------------- */
export const yelpDataLicensing = defineConnector({
  id: 'yelp-data-licensing',
  displayName: 'Yelp Data Licensing (Places / AI API)',
  tier: 'B',
  coverage: 'Primarily US (also CA/intl); businesses + reviews; paid Places/Insights licence',
  plan: {
    access:
      'Yelp Data Licensing — paid Places API (public display) / Insights API (B2B) priced per call (data-licensing@yelp.com). The free Fusion key tier is a separate Tier C connector.',
    incremental:
      'api-since: poll business detail/review endpoints and keep the max review timestamp per business; re-pull businesses whose detail changed (Fusion business updates).',
    fingerprint: 'Licensed business count + max review date (per region) — flips when any covered business gains a new review/edit.',
  },
  async run(_input, deps) {
    const portal = await portalFingerprint(deps.fetch, 'https://business.yelp.com/data/products/fusion/', deps.timeoutMs - 4000);
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental: {
        method: 'api-since-param',
        supported: false,
        description:
          'Licensed Places/AI API. Delta = per-business detail+reviews polling, tracking max review timestamp + business detail content_hash (no global since-param; effectively api-since per business). Needs a paid licence; free Fusion key is Tier C.',
      },
      notes: [
        portal.note,
        'Paid Yelp Data Licensing (Places API for public display, Insights API for B2B) required for ingestion at scale. Prototype confirms the portal + documents the per-business review-date delta. Contact data-licensing@yelp.com.',
      ],
    };
  },
});

/* ------------------------------------------------------------------------- *
 * 5. Lonely Planet — paid Content Licensing API via ArrivalGuides.          *
 *    needs_license. Probe the ArrivalGuides biz/API portal.                 *
 * ------------------------------------------------------------------------- */
export const lonelyPlanet = defineConnector({
  id: 'lonely-planet',
  displayName: 'Lonely Planet (Content Licensing via ArrivalGuides)',
  tier: 'B',
  coverage: 'Global guides; 600+ destinations, 56k+ POIs, 16+ languages; paid content licence',
  plan: {
    access:
      'Lonely Planet Content Licensing API, delivered via ArrivalGuides (biz.arrivalguides.com/api). Paid contract + API token. Raw destination/POI content for licensed integration.',
    incremental:
      'Content update feed: ArrivalGuides exposes per-destination content versions; pull the list of updated destination/POI ids and re-fetch only those (changes-feed over content versions).',
    fingerprint: 'Content version per destination (ArrivalGuides content/version id) + destination count.',
  },
  async run(_input, deps) {
    // Probe the public licensing portal (the API itself is gated behind a contract).
    let portal = await portalFingerprint(deps.fetch, 'https://lonelyplanetcontentlicensing.com/', deps.timeoutMs - 4000);
    if (!portal.reachable) {
      portal = await portalFingerprint(deps.fetch, 'https://biz.arrivalguides.com/api/', deps.timeoutMs - 4000);
    }
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental: {
        method: 'changes-feed',
        supported: true,
        description:
          'ArrivalGuides exposes per-destination content versions; production pulls the changed-destination list and re-fetches only those XML/JSON content blobs (changes-feed over content versions). Requires a paid Content Licensing contract + token.',
      },
      notes: [
        portal.note,
        'Lonely Planet content is licensed via ArrivalGuides (biz.arrivalguides.com/api). Paid contract + API token required; prototype confirms the portal and documents the content-version delta.',
      ],
    };
  },
});

/* ------------------------------------------------------------------------- *
 * 6. Reddit — Data API (OAuth). needs_key (free dev tier). Probe the public *
 *    /r/travel/new.json; with REDDIT_CLIENT_ID/SECRET, get an app-only      *
 *    token and pull a few listings; cursor via fullnames.                   *
 * ------------------------------------------------------------------------- */
interface RedditChild {
  kind: string;
  data: {
    name: string; // fullname e.g. t3_abc
    id: string;
    title?: string;
    subreddit?: string;
    permalink?: string;
    created_utc?: number;
    url?: string;
  };
}
interface RedditListing {
  data?: { children?: RedditChild[]; after?: string | null; before?: string | null };
}

export const reddit = defineConnector({
  id: 'reddit',
  displayName: 'Reddit (Data API — r/travel etc.)',
  tier: 'B',
  coverage: 'Global EN community travel discussion (r/travel, r/solotravel, …); Reddit Data API ToS',
  plan: {
    access:
      'Reddit Data API (OAuth app-only). Free dev tier needs REDDIT_CLIENT_ID + REDDIT_SECRET; commercial volume is a paid Data API contract. Public www.reddit.com/r/<sub>/new.json works keyless but is rate-limited/ToS-bound.',
    incremental:
      "Listing cursor: sort=new with 'before'=<newest fullname seen>, paging back with 'after' — opaque fullname cursor (cursor-pagination). New posts since last run = everything before the stored newest t3_ id.",
    fingerprint: "Newest fullname (t3_ id) of r/travel/new + subscriber/post count — flips on any new post.",
  },
  async run(input, deps) {
    const notes: string[] = [];
    const clientId = deps.env.REDDIT_CLIENT_ID;
    const secret = deps.env.REDDIT_SECRET;
    const sub = 'travel';
    const want = recCap(input.limit);

    const incremental = {
      method: 'cursor-pagination' as const,
      supported: true,
      description:
        "sort=new + 'before'=<stored newest fullname> returns only posts newer than last run; 'after' pages backward for backfill. Fullnames (t3_*) are the resumable opaque cursor. Production stores the newest t3_ id per subreddit.",
    };

    // Always do the public-JSON probe first — confirms reachability + gives a
    // fingerprint even without OAuth creds.
    let publicNewest = '';
    let publicCount = 0;
    let challenge: string | null = null;
    try {
      const res = await fetchT(deps.fetch, `https://www.reddit.com/r/${sub}/new.json?limit=${Math.min(want, 25)}`, {
        method: 'GET',
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        timeoutMs: Math.min(12_000, deps.timeoutMs - 3000),
        allowNotOk: true,
      });
      const text = await res.text();
      challenge = looksLikeChallenge(res.status, text);
      if (!challenge && res.ok) {
        const json = JSON.parse(text) as RedditListing;
        const kids = json.data?.children ?? [];
        publicCount = kids.length;
        publicNewest = kids[0]?.data.name ?? '';
        notes.push(`Public /r/${sub}/new.json → HTTP ${res.status}, ${publicCount} items, newest=${publicNewest || 'n/a'}.`);
      } else {
        notes.push(`Public /r/${sub}/new.json → HTTP ${res.status}${challenge ? ` (${challenge})` : ''}.`);
      }
    } catch (e) {
      notes.push(`Public JSON probe failed: ${e instanceof Error ? e.message : String(e)}.`);
    }

    const baseFp = sourceFp('newest-fullname+count', { subreddit: sub, newest: publicNewest || 'unknown', sampled: publicCount });

    // No OAuth creds → classify needs_key, but we already have a fingerprint.
    if (!clientId || !secret) {
      notes.push('No REDDIT_CLIENT_ID/REDDIT_SECRET set; set both for OAuth app-only access (higher limits, ToS-compliant). Public JSON is rate-limited and discouraged for production.');
      return { status: 'needs_key', sourceFingerprint: baseFp, incremental, notes };
    }

    // Creds present → app-only OAuth token, then pull /new via oauth.reddit.com.
    try {
      const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
      const tokRes = await fetchT(deps.fetch, 'https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        timeoutMs: Math.min(12_000, deps.timeoutMs - 4000),
        allowNotOk: true,
      });
      if (!tokRes.ok) {
        notes.push(`OAuth token request → HTTP ${tokRes.status}; falling back to needs_key.`);
        return { status: 'needs_key', sourceFingerprint: baseFp, incremental, notes };
      }
      const tok = (await tokRes.json()) as { access_token?: string };
      const accessToken = tok.access_token;
      if (!accessToken) {
        notes.push('OAuth token response had no access_token; needs_key.');
        return { status: 'needs_key', sourceFingerprint: baseFp, incremental, notes };
      }
      const before = input.cursor; // resume from a stored newest fullname if provided
      const qs = new URLSearchParams({ limit: String(Math.min(want, 25)), raw_json: '1' });
      if (before) qs.set('before', before);
      const listRes = await fetchT(deps.fetch, `https://oauth.reddit.com/r/${sub}/new?${qs}`, {
        method: 'GET',
        headers: { 'User-Agent': UA, Authorization: `Bearer ${accessToken}` },
        timeoutMs: Math.min(15_000, deps.timeoutMs - 3000),
        allowNotOk: true,
      });
      if (!listRes.ok) {
        notes.push(`OAuth listing → HTTP ${listRes.status}; partial (token OK, listing failed).`);
        return { status: 'partial', sourceFingerprint: baseFp, incremental, notes };
      }
      const json = (await listRes.json()) as RedditListing;
      const kids = json.data?.children ?? [];
      const records = kids.slice(0, want).map((c) =>
        mkRecord('reddit', c.data.name, c.data, {
          name: c.data.title,
          updated_at: c.data.created_utc ? new Date(c.data.created_utc * 1000).toISOString() : undefined,
          raw: c.data,
        }),
      );
      const newest = kids[0]?.data.name ?? publicNewest;
      return {
        status: records.length ? 'ok' : 'partial',
        sourceFingerprint: sourceFp('newest-fullname+count', { subreddit: sub, newest: newest || 'unknown', sampled: records.length }),
        incremental: { ...incremental, sinceApplied: before },
        records,
        cursor: newest || undefined,
        notes: [...notes, `OAuth app-only pull of r/${sub}/new returned ${records.length} record(s); cursor(newest)=${newest || 'n/a'}.`],
      };
    } catch (e) {
      notes.push(`OAuth flow error: ${e instanceof Error ? e.message : String(e)}.`);
      return { status: 'needs_key', sourceFingerprint: baseFp, incremental, notes };
    }
  },
});

/* ------------------------------------------------------------------------- *
 * 7. Retty (Japan) — B2B "Food Data Platform", no public API.               *
 *    needs_license; probe retty.me reachability + sitemap.                  *
 * ------------------------------------------------------------------------- */
export const retty = defineConnector({
  id: 'retty',
  displayName: 'Retty (Japan — Food Data Platform)',
  tier: 'B',
  coverage: 'Japan restaurants/gourmet (JA); B2B Food Data Platform licence, no public API',
  plan: {
    access:
      'No public API. Retty licenses a B2B "Food Data Platform" (restaurant master + reviews) under contract. Public site retty.me is scrape-restricted.',
    incremental:
      'Licensed feed: contracted delivery carries a delivery date / changed-record set (dump-diff). Site-side fallback = sitemap <lastmod> per restaurant URL.',
    fingerprint: 'Licensed feed delivery date (contract delivery); fallback = sitemap max-lastmod + URL count.',
  },
  async run(_input, deps) {
    const notes: string[] = [];
    const sm = await sitemapProbe(deps.fetch, 'https://retty.me/sitemap.xml', deps.timeoutMs - 4000);
    let fp: SourceFingerprint;
    let supported = true;
    if (sm?.challenge) {
      notes.push(`Sitemap blocked: ${sm.challenge} — site is anti-bot protected; cheap public fingerprinting not possible.`);
      fp = sourceFp('none', { reason: sm.challenge });
      supported = false;
    } else if (sm) {
      notes.push(`Sitemap probe retty.me: ${sm.urlCount} entries, maxLastmod=${sm.maxLastmod ?? 'n/a'} (public fallback delta heuristic).`);
      fp = sourceFp('sitemap-lastmod-max', { maxLastmod: sm.maxLastmod ?? 'none', urlCount: sm.urlCount, sample: sm.sampleLoc ?? '' });
    } else {
      const portal = await portalFingerprint(deps.fetch, 'https://retty.me/', deps.timeoutMs - 4000);
      notes.push(`Sitemap unreachable; ${portal.note}`);
      fp = portal.fp;
    }
    return {
      status: 'needs_license',
      sourceFingerprint: fp,
      incremental: {
        method: 'dump-diff',
        supported,
        description:
          'Production licenses the B2B Food Data Platform feed (delivery-dated, changed-record set → dump-diff). No public API; public sitemap <lastmod> is only a fallback change heuristic and scraping is ToS-restricted.',
      },
      notes: [
        ...notes,
        'Retty has no public API; the restaurant/review data is a B2B "Food Data Platform" licence. Real ingestion requires a contract; prototype confirms reachability + the (fallback) sitemap delta.',
      ],
    };
  },
});

/* ------------------------------------------------------------------------- *
 * 8. Siksin (Korea) — B2B big-data licence. needs_license; sitemap probe.   *
 * ------------------------------------------------------------------------- */
export const siksin = defineConnector({
  id: 'siksin',
  displayName: 'Siksin / SiksinHot (Korea — restaurant big data)',
  tier: 'B',
  coverage: 'Korea restaurants/맛집 (KO); B2B big-data licence, no public API',
  plan: {
    access:
      'No public API. Siksin (siksinhot.com) licenses restaurant big-data to partners under contract. Public site is scrape-restricted.',
    incremental:
      'Partner refresh: contracted dataset is re-delivered/versioned per refresh cycle (dump-diff). Site-side fallback = sitemap <lastmod>.',
    fingerprint: 'Dataset version (partner refresh id); fallback = sitemap max-lastmod + URL count.',
  },
  async run(_input, deps) {
    const notes: string[] = [];
    const sm = await sitemapProbe(deps.fetch, 'https://www.siksinhot.com/sitemap.xml', deps.timeoutMs - 4000);
    let fp: SourceFingerprint;
    let supported = true;
    if (sm?.challenge) {
      notes.push(`Sitemap blocked: ${sm.challenge} — anti-bot protected.`);
      fp = sourceFp('none', { reason: sm.challenge });
      supported = false;
    } else if (sm) {
      notes.push(`Sitemap probe siksinhot.com: ${sm.urlCount} entries, maxLastmod=${sm.maxLastmod ?? 'n/a'} (public fallback heuristic).`);
      fp = sourceFp('sitemap-lastmod-max', { maxLastmod: sm.maxLastmod ?? 'none', urlCount: sm.urlCount, sample: sm.sampleLoc ?? '' });
    } else {
      const portal = await portalFingerprint(deps.fetch, 'https://www.siksinhot.com/', deps.timeoutMs - 4000);
      notes.push(`Sitemap unreachable; ${portal.note}`);
      fp = portal.fp;
    }
    return {
      status: 'needs_license',
      sourceFingerprint: fp,
      incremental: {
        method: 'dump-diff',
        supported,
        description:
          'Production licenses the partner big-data dataset, re-delivered/versioned per refresh (dump-diff on dataset version). No public API; sitemap <lastmod> is only a fallback heuristic.',
      },
      notes: [
        ...notes,
        'Siksin restaurant data is a B2B big-data licence — no public API. Real ingestion requires a partner contract; prototype confirms reachability + the fallback sitemap delta.',
      ],
    };
  },
});

/* ------------------------------------------------------------------------- *
 * 9. NAVITIME (Japan) — commercial B2B transit/POI API. needs_license.      *
 * ------------------------------------------------------------------------- */
export const navitime = defineConnector({
  id: 'navitime',
  displayName: 'NAVITIME (Japan transit/POI — commercial API)',
  tier: 'B',
  coverage: 'Japan transit routing + POI (JA); commercial B2B API (also RapidAPI), paid licence',
  plan: {
    access:
      'NAVITIME commercial B2B API (route/transit/POI). Paid licence + API key per contract (some endpoints via RapidAPI marketplace). No free open tier.',
    incremental:
      'Per-contract: timetable/POI datasets are versioned per delivery; pull deltas between dataset versions (versioned dump-diff). Live routing is request-time, not bulk-incremental.',
    fingerprint: 'Dataset version (timetable/POI release id) per contracted catalog.',
  },
  async run(_input, deps) {
    const portal = await portalFingerprint(deps.fetch, 'https://products.navitime.co.jp/', deps.timeoutMs - 4000);
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental: {
        method: 'dump-diff',
        supported: true,
        description:
          'Contracted timetable/POI datasets are versioned per delivery; production diffs between dataset versions (versioned dump-diff). Requires a paid NAVITIME B2B licence + key.',
      },
      notes: [
        portal.note,
        'NAVITIME exposes only a commercial B2B API (paid licence/key, partly via RapidAPI). Prototype confirms the product portal + documents the version-delta; no free tier to key-probe.',
      ],
    };
  },
});

/* ------------------------------------------------------------------------- *
 * 10. Jorudan (Japan transit) — Norikae Open API (free embed) + Biz.        *
 *     needs_license/needs_key; probe the Open API portal base.              *
 * ------------------------------------------------------------------------- */
export const jorudan = defineConnector({
  id: 'jorudan',
  displayName: 'Jorudan (Japan transit — Norikae Open API / Biz)',
  tier: 'B',
  coverage: 'Japan rail/bus/air route search + timetables (JA); free embed Open API + commercial Biz',
  plan: {
    access:
      'Jorudan "Norikae Annai Open API" (norikae.jorudan.co.jp/openapi) — free for embeds after registration (needs a key); the commercial "Biz" API is a paid contract for data use beyond embeds.',
    incremental:
      'Timetable revision: Jorudan re-issues timetables on the JR/operator revision cycle; production keys off the timetable version and re-pulls changed routes (dump-diff on timetable revision).',
    fingerprint: 'Timetable version (Jorudan timetable revision id / data date).',
  },
  async run(_input, deps) {
    const notes: string[] = [];
    // The free Open API needs registration (a key) for embeds; bulk/data use is
    // a paid Biz contract. Probe the Open API portal for reachability + fp.
    let portal = await portalFingerprint(deps.fetch, 'https://norikae.jorudan.co.jp/openapi/', deps.timeoutMs - 4000);
    if (!portal.reachable) {
      portal = await portalFingerprint(deps.fetch, 'https://www.jorudan.co.jp/', deps.timeoutMs - 4000);
    }
    notes.push(portal.note);
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental: {
        method: 'dump-diff',
        supported: true,
        description:
          'Timetables are re-issued on the operator revision cycle; production keys off the timetable version and re-pulls changed routes (dump-diff on revision id). Live route search is request-time.',
      },
      notes: [
        ...notes,
        'Norikae Open API is free for EMBEDS only (registration → key); using the route/timetable DATA in our own product needs the commercial Biz licence. Hence needs_license for ingestion (needs_key only for the embed widget). Register at norikae.jorudan.co.jp/openapi.',
      ],
    };
  },
});

/* ------------------------------------------------------------------------- *
 * 11. Time Out — editorial, no self-serve API; licensing case-by-case.      *
 *     needs_license; sitemapProbe timeout.com.                              *
 * ------------------------------------------------------------------------- */
export const timeOut = defineConnector({
  id: 'time-out',
  displayName: 'Time Out (global city editorial)',
  tier: 'B',
  coverage: 'Global cities; editorial venue/things-to-do lists (EN+); no self-serve API, licensing case-by-case',
  plan: {
    access:
      'No self-serve API. Editorial content (timeout.com) is licensed case-by-case via a content/partnership deal. Public site is the only programmatic surface (sitemap).',
    incremental:
      'sitemap-lastmod: per-article/venue <lastmod> in the sitemap gives the changed-URL set since T without re-crawling everything.',
    fingerprint: 'Sitemap max-lastmod + URL count (no API timestamp).',
  },
  async run(_input, deps) {
    const notes: string[] = [];
    const sm = await sitemapProbe(deps.fetch, 'https://www.timeout.com/sitemap.xml', deps.timeoutMs - 4000);
    let fp: SourceFingerprint;
    let supported = true;
    if (sm?.challenge) {
      notes.push(`Sitemap blocked: ${sm.challenge} — even the sitemap is WAF-protected.`);
      fp = sourceFp('none', { reason: sm.challenge });
      supported = false;
    } else if (sm) {
      notes.push(`Sitemap probe timeout.com: ${sm.urlCount} entries, maxLastmod=${sm.maxLastmod ?? 'n/a'} (the delta heuristic).`);
      fp = sourceFp('sitemap-lastmod-max', { maxLastmod: sm.maxLastmod ?? 'none', urlCount: sm.urlCount, sample: sm.sampleLoc ?? '' });
    } else {
      const portal = await portalFingerprint(deps.fetch, 'https://www.timeout.com/', deps.timeoutMs - 4000);
      notes.push(`Sitemap unreachable; ${portal.note}`);
      fp = portal.fp;
      supported = false;
    }
    return {
      status: 'needs_license',
      sourceFingerprint: fp,
      incremental: {
        method: 'sitemap-lastmod',
        supported,
        description:
          'Sitemap <lastmod> per URL gives the changed editorial pages since T (sitemap-lastmod). Bodies still need a content licence — Time Out has no self-serve API and licenses editorially case-by-case.',
      },
      notes: [
        ...notes,
        'Time Out has no self-serve API; content use requires a case-by-case editorial/partnership licence. Prototype establishes the sitemap-lastmod delta + fingerprint; ingestion needs a deal.',
      ],
    };
  },
});

/* ------------------------------------------------------------------------- *
 * 12. Placer.ai — US foot-traffic; paid API. needs_license.                 *
 * ------------------------------------------------------------------------- */
export const placerAi = defineConnector({
  id: 'placer-ai',
  displayName: 'Placer.ai (US foot-traffic analytics)',
  tier: 'B',
  coverage: 'US (primary) location/foot-traffic analytics; paid API + platform licence',
  plan: {
    access:
      'Placer.ai paid API + platform. Modeled foot-traffic / visitation metrics per venue/area. No keyless/free tier; enterprise contract + API key.',
    incremental:
      'Weekly modeling refresh: metrics are recomputed and delivered on a weekly cadence; production pulls the latest delivery and diffs by venue + metric period (dump-diff on delivery date).',
    fingerprint: 'Delivery date (weekly modeling release) + covered-venue count.',
  },
  async run(_input, deps) {
    const portal = await portalFingerprint(deps.fetch, 'https://www.placer.ai/', deps.timeoutMs - 4000);
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental: {
        method: 'dump-diff',
        supported: true,
        description:
          'Foot-traffic metrics are recomputed on a weekly modeling cadence; production pulls the latest weekly delivery and diffs by venue + metric period (dump-diff on delivery date). Requires a paid Placer.ai contract + key.',
      },
      notes: [
        portal.note,
        'Placer.ai foot-traffic is a paid API/platform with no free tier. Prototype confirms reachability + documents the weekly delivery delta; ingestion needs an enterprise contract.',
      ],
    };
  },
});

export const licensableConnectors: SourceConnector[] = [
  wikimediaEnterprise,
  safegraph,
  hereBulk,
  yelpDataLicensing,
  lonelyPlanet,
  reddit,
  retty,
  siksin,
  navitime,
  jorudan,
  timeOut,
  placerAi,
];
