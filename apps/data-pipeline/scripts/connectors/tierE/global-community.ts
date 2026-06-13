/**
 * Tier E — global niche / community sources with NO sanctioned ingestion path.
 *
 * These are the "wall" cases: copyright-reserved UGC, closed/NDA APIs, ToS that
 * ban bots and AI scraping, or consumer products with no bulk license. For each
 * we run the CHEAPEST real probe that classifies the wall and (where the site
 * still exposes a public sitemap) yields a sitemap-lastmod change-detection
 * fingerprint — so we can answer "did anything change?" without ToS-risky
 * page scraping. Browser scraping stays gated behind PROBE_BROWSER=1.
 *
 * Verified at authoring time (2026-06):
 *  - happycow            sitemap index: https://www.happycow.net/sitemaps/sitemap-index.xml (200, lastmod present)
 *  - foursquare-consumer sitemap index: https://4sq-sitemap.s3.amazonaws.com/sitemap_index.xml (200)
 *  - tripadvisor-forums  robots declares show_user_reviews sitemap; root /sitemap.xml → 403 WAF
 *  - culture-trip        robots.txt explicitly Disallows ClaudeBot/GPTBot/CCBot/Google-Extended (AI scraping banned)
 *  - jnto-content        /sitemap.xml 301 → /en/sitemap.xml, fronted by a WAF (bot UA times out)
 *  - airbnb              /sitemap.xml 301 → /404 (no public sitemap); API closed/NDA, anti-scrape
 */
import { defineConnector } from '../core/connector.js';
import {
  mkRecord,
  sourceFp,
  sitemapProbe,
  headFingerprint,
  looksLikeChallenge,
  fetchT,
  UA,
} from '../core/fingerprint.js';
import { browserEnabled, withPage } from '../core/browser.js';
import type { SourceConnector } from '../core/types.js';

/* ------------------------------------------------------------------ *
 * happycow — global vegan/veg directory. No outbound API; UGC copyright
 * reserved. Public sitemap index exists → sitemap-lastmod is the delta.
 * ------------------------------------------------------------------ */
export const happycow = defineConnector({
  id: 'happycow',
  displayName: 'HappyCow',
  tier: 'E',
  coverage: 'Global; ~180k+ vegan/vegetarian listings; UGC, all rights reserved',
  plan: {
    access: 'No public API. Site scrape only (browser) — ToS reserves UGC copyright. Listing data needs a licence/partnership.',
    incremental: 'Sitemap <lastmod> per listing URL → changed-URL set (sitemap-lastmod). No API since-param.',
    fingerprint: 'max(sitemap lastmod) + URL count over the sitemap index (no-timestamp heuristic).',
  },
  async run(input, deps) {
    const notes: string[] = [];
    const sitemapUrl = 'https://www.happycow.net/sitemaps/sitemap-index.xml';
    let sm: Awaited<ReturnType<typeof sitemapProbe>> = null;
    try {
      sm = await sitemapProbe(deps.fetch, sitemapUrl, Math.max(5000, deps.timeoutMs - 4000));
    } catch (e) {
      notes.push(`Sitemap probe error: ${e instanceof Error ? e.message : String(e)}`);
    }
    const fp =
      sm && !sm.challenge
        ? sourceFp('sitemap-lastmod-max', {
            maxLastmod: sm.maxLastmod ?? 'none',
            urlCount: sm.urlCount,
            sample: sm.sampleLoc ?? '',
          })
        : sourceFp('none', { reason: sm?.challenge ?? 'sitemap unreachable' });
    if (sm?.challenge) notes.push(`Sitemap blocked: ${sm.challenge}.`);
    else if (sm) notes.push(`Sitemap probe: ${sm.urlCount} entries, maxLastmod=${sm.maxLastmod ?? 'n/a'} (delta heuristic).`);

    const incremental = {
      method: 'sitemap-lastmod' as const,
      supported: !!sm && !sm.challenge,
      description:
        'Sitemap <lastmod> per listing URL gives the changed set since T without scraping pages. Page bodies require a browser (no API).',
    };

    if (!browserEnabled(deps.env)) {
      return {
        status: 'blocked',
        sourceFingerprint: fp,
        incremental,
        notes: [
          ...notes,
          'No sanctioned API; UGC copyright reserved. Real listing ingestion needs a HappyCow partnership/licence. Set PROBE_BROWSER=1 to attempt a small Chrome scrape of listing links.',
        ],
      };
    }
    try {
      const limit = Math.min(input.limit ?? 10, 25);
      const items = await withPage(
        async (page) => {
          await page.goto('https://www.happycow.net/north_america/usa/', { waitUntil: 'domcontentloaded' });
          return page.$$eval(
            'a[href*="/reviews/"]',
            (els, max) =>
              (els as Array<{ href: string; textContent: string | null }>)
                .map((e) => ({ href: e.href, title: (e.textContent ?? '').trim() }))
                .filter((x) => x.title && /\/reviews\/[a-z0-9-]+/.test(x.href))
                .slice(0, max as number),
            limit,
          );
        },
        { timeoutMs: Math.max(8000, deps.timeoutMs - 5000) },
      );
      const recs = items.map((it) => {
        const slug = it.href.split('/reviews/')[1]?.replace(/\/$/, '') ?? it.href;
        return mkRecord('happycow', slug, it, { name: it.title, raw: it });
      });
      return {
        status: recs.length ? 'partial' : 'blocked',
        sourceFingerprint: fp,
        incremental,
        records: recs,
        notes: [...notes, `Chrome scrape extracted ${recs.length} listing links (ToS-risky; partnership required for real use).`],
      };
    } catch (e) {
      return {
        status: 'blocked',
        sourceFingerprint: fp,
        incremental,
        notes: [...notes, `Browser scrape failed: ${e instanceof Error ? e.message : String(e)} (likely anti-bot or selector drift).`],
      };
    }
  },
});

/* ------------------------------------------------------------------ *
 * culture-trip — global editorial. No outbound API. robots.txt explicitly
 * Disallows AI crawlers (ClaudeBot/GPTBot/CCBot/Google-Extended), so AI
 * scraping is contractually banned. Sitemap-lastmod is the best delta IF a
 * sitemap is reachable; otherwise fall back to a HEAD fingerprint.
 * ------------------------------------------------------------------ */
export const cultureTrip = defineConnector({
  id: 'culture-trip',
  displayName: 'Culture Trip',
  tier: 'E',
  coverage: 'Global, EN; editorial travel guides/articles; copyright reserved, AI crawlers blocked',
  plan: {
    access: 'No outbound API. Editorial content copyrighted; robots.txt bans AI bots (ClaudeBot/GPTBot/CCBot). Licence required.',
    incremental: 'Sitemap <lastmod> per article URL → changed-URL set (sitemap-lastmod). No API since-param.',
    fingerprint: 'max(sitemap lastmod) + URL count; fall back to homepage ETag/Last-Modified (HEAD) if no sitemap.',
  },
  async run(input, deps) {
    const notes: string[] = [];
    notes.push('robots.txt explicitly Disallows ClaudeBot/GPTBot/CCBot/Google-Extended — AI scraping is contractually banned.');
    const budget = Math.max(5000, deps.timeoutMs - 4000);
    // Try common sitemap locations; this site is intermittently WAF-gated.
    let sm: Awaited<ReturnType<typeof sitemapProbe>> = null;
    for (const u of ['https://theculturetrip.com/sitemap.xml', 'https://theculturetrip.com/sitemap_index.xml']) {
      try {
        sm = await sitemapProbe(deps.fetch, u, budget);
      } catch {
        sm = null;
      }
      if (sm && !sm.challenge && sm.urlCount > 0) break;
    }
    if (sm && !sm.challenge && sm.urlCount > 0) {
      const fp = sourceFp('sitemap-lastmod-max', {
        maxLastmod: sm.maxLastmod ?? 'none',
        urlCount: sm.urlCount,
        sample: sm.sampleLoc ?? '',
      });
      notes.push(`Sitemap probe: ${sm.urlCount} entries, maxLastmod=${sm.maxLastmod ?? 'n/a'}.`);
      return {
        status: 'blocked',
        sourceFingerprint: fp,
        incremental: {
          method: 'sitemap-lastmod',
          supported: true,
          description: 'Sitemap <lastmod> per article gives the changed set since T. Bodies are copyrighted and AI scraping is banned.',
        },
        notes,
      };
    }
    if (sm?.challenge) notes.push(`Sitemap blocked: ${sm.challenge}.`);
    // Fallback: HEAD fingerprint of the homepage to at least detect state change.
    const head = await headFingerprint(deps.fetch, 'https://theculturetrip.com/', budget);
    const fp = head.fp ?? sourceFp('none', { reason: 'sitemap+HEAD unreachable (WAF / AI-bot block)' });
    notes.push(
      head.fp
        ? `Sitemap unavailable; homepage HEAD fingerprint via ${head.fp.method} (status ${head.status}).`
        : 'Sitemap and homepage HEAD both unreachable (WAF or AI-bot block).',
    );
    return {
      status: 'blocked',
      sourceFingerprint: fp,
      incremental: {
        method: 'sitemap-lastmod',
        supported: false,
        description: 'Intended delta is sitemap <lastmod>; not reachable this run. No API. Editorial licence required for any ingestion.',
      },
      notes,
    };
  },
});

/* ------------------------------------------------------------------ *
 * airbnb — global lodging. API is closed/NDA (partner-only), reviews are not
 * licensed for redistribution, and the site is aggressively anti-scrape.
 * /sitemap.xml 301s to /404 (no public sitemap). No delta mechanism → the
 * only fingerprint is a content_hash of whatever surface is reachable.
 * ------------------------------------------------------------------ */
export const airbnb = defineConnector({
  id: 'airbnb',
  displayName: 'Airbnb',
  tier: 'E',
  coverage: 'Global lodging/experiences; closed NDA API, reviews unlicensed, anti-scrape',
  plan: {
    access: 'Closed/NDA partner API only; reviews not licensed for redistribution; site is anti-scrape (no sanctioned access).',
    incremental: 'none — no public listing feed, no since-param, no usable sitemap.',
    fingerprint: 'content_hash of a reachable public surface (homepage HTML); no version/timestamp exposed.',
  },
  async run(_input, deps) {
    const notes: string[] = [];
    const budget = Math.max(5000, deps.timeoutMs - 4000);
    notes.push('API is closed/NDA (partner-only); reviews are not licensed for redistribution; listing access is partnership-gated.');
    // Confirm the wall: there is no public sitemap (redirects to /404), and the
    // homepage is the only cheap surface — hash it for a content fingerprint.
    let body = '';
    let status = 0;
    let challenge: string | null = null;
    try {
      const res = await fetchT(deps.fetch, 'https://www.airbnb.com/', {
        headers: { 'User-Agent': UA },
        timeoutMs: budget,
        allowNotOk: true,
      });
      status = res.status;
      body = (await res.text()).slice(0, 4000);
      challenge = looksLikeChallenge(status, body);
    } catch (e) {
      notes.push(`Homepage probe error: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (challenge) notes.push(`Anti-bot detected: ${challenge}.`);
    notes.push('No public sitemap (/sitemap.xml → /404); no since-param or changes feed exists.');
    const fp =
      body && !challenge
        ? sourceFp('content-hash', { surface: 'www.airbnb.com/', status, len: body.length, head: body.slice(0, 80) })
        : sourceFp('none', { reason: challenge ?? `homepage unreachable (status ${status})` });
    return {
      status: 'blocked',
      sourceFingerprint: fp,
      incremental: {
        method: 'none',
        supported: false,
        description: 'No public feed/API/sitemap and no since-param. Any ingestion would require a signed Airbnb partner agreement.',
      },
      notes,
    };
  },
});

/* ------------------------------------------------------------------ *
 * tripadvisor-forums — global travel forums. NOT exposed by the TripAdvisor
 * Content API (which is location/review only), and ToS bans bots + AI
 * scraping. A public show_user_reviews sitemap is declared in robots.txt →
 * sitemap-lastmod is the cheapest sanctioned-ish change signal, though the
 * root sitemap is WAF-gated.
 * ------------------------------------------------------------------ */
export const tripadvisorForums = defineConnector({
  id: 'tripadvisor-forums',
  displayName: 'TripAdvisor Forums',
  tier: 'E',
  coverage: 'Global travel Q&A forums; not in Content API; ToS bans bots/AI scraping',
  plan: {
    access: 'Forums are NOT in the TripAdvisor Content API (location/review only). ToS bans automated/AI scraping. No sanctioned access.',
    incremental: 'Sitemap <lastmod> per thread/review URL → changed set (sitemap-lastmod). No forum since-param.',
    fingerprint: 'max(sitemap lastmod) + URL count from the show_user_reviews sitemap index; fall back to HEAD/none if WAF-blocked.',
  },
  async run(_input, deps) {
    const notes: string[] = [];
    notes.push('Forums are not part of the TripAdvisor Content API; ToS bans bots/AI scraping.');
    const budget = Math.max(5000, deps.timeoutMs - 4000);
    // The forum-bearing sitemap declared in robots.txt; root /sitemap.xml is 403/WAF.
    const candidates = [
      'https://www.tripadvisor.com/sitemap/2/en_US/sitemap_en_US_show_user_reviews_index.xml',
      'https://www.tripadvisor.com/sitemap.xml',
    ];
    let sm: Awaited<ReturnType<typeof sitemapProbe>> = null;
    for (const u of candidates) {
      try {
        sm = await sitemapProbe(deps.fetch, u, budget);
      } catch {
        sm = null;
      }
      if (sm && !sm.challenge && sm.urlCount > 0) break;
    }
    if (sm && !sm.challenge && sm.urlCount > 0) {
      const fp = sourceFp('sitemap-lastmod-max', {
        maxLastmod: sm.maxLastmod ?? 'none',
        urlCount: sm.urlCount,
        sample: sm.sampleLoc ?? '',
      });
      notes.push(`Sitemap probe: ${sm.urlCount} entries, maxLastmod=${sm.maxLastmod ?? 'n/a'} (delta heuristic).`);
      return {
        status: 'blocked',
        sourceFingerprint: fp,
        incremental: {
          method: 'sitemap-lastmod',
          supported: true,
          description: 'Sitemap <lastmod> gives the changed thread/review-URL set since T. Bodies barred by ToS (bots/AI banned); licence/partnership needed.',
        },
        notes,
      };
    }
    if (sm?.challenge) notes.push(`Sitemap blocked: ${sm.challenge} (root sitemap is WAF/403-gated).`);
    else notes.push('Declared sitemap not reachable this run (WAF/403).');
    const fp = sm?.challenge
      ? sourceFp('none', { reason: sm.challenge })
      : sourceFp('none', { reason: 'sitemap unreachable (WAF/403)' });
    return {
      status: 'blocked',
      sourceFingerprint: fp,
      incremental: {
        method: 'sitemap-lastmod',
        supported: false,
        description: 'Intended delta is sitemap <lastmod>; the sitemap is WAF-gated this run. No API for forums; ToS bans scraping.',
      },
      notes,
    };
  },
});

/* ------------------------------------------------------------------ *
 * foursquare-consumer — Swarm / City Guide (the CONSUMER product, distinct
 * from the open FSQ OS Places dump). No bulk license for consumer
 * tips/check-ins; City Guide was sunset in 2024-25. A public sitemap index
 * lives on S3 → sitemap-lastmod fingerprint, but there is no usable delta for
 * the proprietary consumer content (none).
 * ------------------------------------------------------------------ */
export const foursquareConsumer = defineConnector({
  id: 'foursquare-consumer',
  displayName: 'Foursquare (Swarm / City Guide)',
  tier: 'E',
  coverage: 'Global consumer venues/tips/check-ins; no bulk licence; City Guide sunset 2024-25',
  plan: {
    access: 'Consumer Swarm/City Guide content has no bulk licence; City Guide app sunset 2024-25. (Open FSQ OS Places is a separate Tier A dump.)',
    incremental: 'none for proprietary consumer content (no since-param; tips/check-ins not licensed). Sitemap lastmod only covers public venue pages.',
    fingerprint: 'content_hash of the S3 sitemap index state (URL count + max lastmod) as a state signal; no consumer-content version.',
  },
  async run(_input, deps) {
    const notes: string[] = [];
    notes.push('Consumer Swarm/City Guide content is not bulk-licensed; City Guide was sunset 2024-25. Open FSQ OS Places (Tier A) is the licensed path for venue base data.');
    const budget = Math.max(5000, deps.timeoutMs - 4000);
    const sitemapUrl = 'https://4sq-sitemap.s3.amazonaws.com/sitemap_index.xml';
    let sm: Awaited<ReturnType<typeof sitemapProbe>> = null;
    try {
      sm = await sitemapProbe(deps.fetch, sitemapUrl, budget);
    } catch (e) {
      notes.push(`Sitemap probe error: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (sm?.challenge) notes.push(`Sitemap blocked: ${sm.challenge}.`);
    else if (sm) notes.push(`S3 sitemap index: ${sm.urlCount} entries, maxLastmod=${sm.maxLastmod ?? 'n/a'} (public venue pages only).`);
    // Fingerprint is a content_hash of the sitemap state — the consumer tips/
    // check-ins themselves have no version surface we can legally read.
    const fp =
      sm && !sm.challenge
        ? sourceFp('content-hash', { surface: 's3-sitemap-index', urlCount: sm.urlCount, maxLastmod: sm.maxLastmod ?? 'none' })
        : sourceFp('none', { reason: sm?.challenge ?? 'sitemap unreachable' });
    return {
      status: 'blocked',
      sourceFingerprint: fp,
      incremental: {
        method: 'none',
        supported: false,
        description:
          'No since-param/feed for consumer tips/check-ins and no bulk licence. Public sitemap lastmod covers only venue pages, not the proprietary consumer layer.',
      },
      notes,
    };
  },
});

/* ------------------------------------------------------------------ *
 * jnto-content — Japan National Tourism Org editorial (japan.travel).
 * Editorial copy is copyrighted and the statistics portal is
 * application-gated; there is no POI feed/API. Public sitemap-lastmod is the
 * intended delta, but the site is WAF-fronted (bot UA times out), so we fall
 * back to a HEAD fingerprint / 'none' and report the wall honestly.
 * ------------------------------------------------------------------ */
export const jntoContent = defineConnector({
  id: 'jnto-content',
  displayName: 'JNTO (japan.travel)',
  tier: 'E',
  coverage: 'Japan; JNTO editorial guides + application-gated stats; no POI feed',
  plan: {
    access: 'Editorial content copyrighted; JNTO statistics are application-gated. No POI feed/API. WAF-fronted site.',
    incremental: 'Sitemap <lastmod> per editorial URL → changed set (sitemap-lastmod). No API since-param.',
    fingerprint: 'max(sitemap lastmod) + URL count; fall back to homepage ETag/Last-Modified (HEAD) when the sitemap is WAF-gated.',
  },
  async run(_input, deps) {
    const notes: string[] = [];
    notes.push('Editorial content is copyrighted; JNTO statistics are application-gated. No POI feed/API.');
    const budget = Math.max(5000, deps.timeoutMs - 4000);
    const candidates = ['https://www.japan.travel/en/sitemap.xml', 'https://www.japan.travel/sitemap.xml'];
    let sm: Awaited<ReturnType<typeof sitemapProbe>> = null;
    for (const u of candidates) {
      try {
        sm = await sitemapProbe(deps.fetch, u, budget);
      } catch {
        sm = null;
      }
      if (sm && !sm.challenge && sm.urlCount > 0) break;
    }
    if (sm && !sm.challenge && sm.urlCount > 0) {
      const fp = sourceFp('sitemap-lastmod-max', {
        maxLastmod: sm.maxLastmod ?? 'none',
        urlCount: sm.urlCount,
        sample: sm.sampleLoc ?? '',
      });
      notes.push(`Sitemap probe: ${sm.urlCount} entries, maxLastmod=${sm.maxLastmod ?? 'n/a'} (delta heuristic).`);
      return {
        status: 'blocked',
        sourceFingerprint: fp,
        incremental: {
          method: 'sitemap-lastmod',
          supported: true,
          description: 'Sitemap <lastmod> per editorial URL gives the changed set since T. Bodies copyrighted; licence/permission needed to ingest.',
        },
        notes,
      };
    }
    if (sm?.challenge) notes.push(`Sitemap blocked: ${sm.challenge}.`);
    else notes.push('Sitemap not reachable this run (WAF-fronted; bot UA appears blocked).');
    const head = await headFingerprint(deps.fetch, 'https://www.japan.travel/en/', budget);
    const fp = head.fp ?? sourceFp('none', { reason: sm?.challenge ?? 'sitemap+HEAD unreachable (WAF)' });
    if (head.fp) notes.push(`Homepage HEAD fingerprint via ${head.fp.method} (status ${head.status}).`);
    return {
      status: 'blocked',
      sourceFingerprint: fp,
      incremental: {
        method: 'sitemap-lastmod',
        supported: false,
        description: 'Intended delta is sitemap <lastmod>; not reachable this run (WAF). No API; editorial licence required for ingestion.',
      },
      notes,
    };
  },
});

export const tierEGlobalConnectors: SourceConnector[] = [
  happycow,
  cultureTrip,
  airbnb,
  tripadvisorForums,
  foursquareConsumer,
  jntoContent,
];
