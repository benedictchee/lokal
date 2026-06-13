/**
 * Tier E — Asian community / food-review sites with NO sanctioned content API.
 *
 * These are the hardest sources in the catalog: the data is rich (millions of
 * eatery listings + reviews) but every one of them is either (a) covered by a
 * ToS that bans copying / automated access, (b) only offers a *merchant / POS*
 * integration API (no read-only content feed), or (c) had a public content API
 * that was DISCONTINUED. So the experiment here is NOT "pull records" — it is
 * "classify the wall cheaply and produce a change-detection fingerprint that
 * does NOT require scraping page bodies".
 *
 * Strategy per source:
 *   - Where a sitemap is reachable → `sitemapProbe` gives max(<lastmod>) + URL
 *     count. That is both the cheapest fingerprint AND the incremental delta
 *     (the changed-URL set) without touching protected page bodies → status
 *     'blocked' (no API) but with a usable sitemap-lastmod plan.
 *   - Where even the sitemap / homepage is WAF-protected → detect via
 *     `looksLikeChallenge` / `sitemapProbe().challenge`, fall back to a homepage
 *     HEAD fingerprint, and say so in notes.
 *   - Where the public API was discontinued (Zomato) or is POS-only (Swiggy
 *     Dineout, Wongnai) → note that explicitly; incremental = 'none' with a
 *     content-hash fingerprint, or sitemap-lastmod where the public site exposes
 *     one.
 *
 * NOTHING here scrapes protected bodies by default. The browser path is only a
 * future hook (browserEnabled) and is deliberately NOT exercised for ToS-banned
 * sources — we keep these at 'blocked'/'needs_license' and document the wall.
 */
import { defineConnector } from '../core/connector.js';
import type { PullBody } from '../core/connector.js';
import {
  fetchT,
  headFingerprint,
  looksLikeChallenge,
  sitemapProbe,
  sourceFp,
  UA,
} from '../core/fingerprint.js';
import type { ConnectorDeps, IncrementalCapability, SourceConnector, SourceFingerprint } from '../core/types.js';

/**
 * Shared sitemap-first probe for the "ToS-risky but a sitemap exists" sources.
 *
 * Tries the given sitemap URL(s) in order; the first that yields lastmod/URLs
 * wins. Returns a sitemap-lastmod fingerprint + 'blocked' status (no API) when
 * the sitemap is reachable, or a 'challenge' marker + homepage HEAD fallback
 * when a WAF blocks it. Never throws.
 */
async function sitemapBlockedProbe(
  deps: ConnectorDeps,
  opts: {
    sitemapUrls: string[];
    homepageUrl: string;
    tosNote: string;
  },
): Promise<PullBody> {
  const notes: string[] = [];
  const headroom = Math.max(5_000, deps.timeoutMs - 4_000);
  const inc: IncrementalCapability = {
    method: 'sitemap-lastmod',
    supported: false,
    description:
      'Sitemap <lastmod> per listing URL → changed-URL set since T, computed without fetching protected page bodies. No public API timestamp exists.',
  };

  for (const url of opts.sitemapUrls) {
    let sm: Awaited<ReturnType<typeof sitemapProbe>> = null;
    try {
      sm = await sitemapProbe(deps.fetch, url, headroom);
    } catch (e) {
      notes.push(`sitemapProbe(${url}) threw: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (!sm) {
      notes.push(`Sitemap ${url} unreachable (network error / not found).`);
      continue;
    }
    if (sm.challenge) {
      notes.push(`Sitemap ${url} blocked: ${sm.challenge} — even the sitemap sits behind anti-bot; cheap fingerprinting impossible without solving the challenge.`);
      continue; // try the next candidate URL, then fall through to HEAD
    }
    // Reachable, parseable sitemap → this is our fingerprint AND delta source.
    inc.supported = true;
    notes.push(`Sitemap probe ${url}: ${sm.urlCount} entries, maxLastmod=${sm.maxLastmod ?? 'n/a'} (this is the delta heuristic).`);
    notes.push(opts.tosNote);
    return {
      status: 'blocked',
      sourceFingerprint: sourceFp('sitemap-lastmod-max', {
        sitemap: url,
        maxLastmod: sm.maxLastmod ?? 'none',
        urlCount: sm.urlCount,
        sample: sm.sampleLoc ?? '',
      }),
      incremental: inc,
      notes,
    };
  }

  // No sitemap usable → homepage HEAD as a last-resort fingerprint (ETag/Last-Modified).
  let head: Awaited<ReturnType<typeof headFingerprint>> | null = null;
  try {
    head = await headFingerprint(deps.fetch, opts.homepageUrl, headroom);
  } catch (e) {
    notes.push(`Homepage HEAD threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  const challengeFromHead = head && head.status ? looksLikeChallenge(head.status, '') : null;
  if (challengeFromHead) notes.push(`Homepage returned ${head?.status} — ${challengeFromHead}.`);
  notes.push(opts.tosNote);

  const fp: SourceFingerprint =
    head?.fp ??
    sourceFp('none', {
      reason: 'no reachable sitemap and no usable HEAD validators (likely anti-bot or no caching headers)',
    });
  return {
    status: 'blocked',
    sourceFingerprint: fp,
    incremental: {
      ...inc,
      description:
        head?.fp != null
          ? 'No reachable sitemap; falling back to homepage ETag/Last-Modified (etag-conditional) as a coarse fingerprint. Sitemap-lastmod is the intended delta once the sitemap is reachable.'
          : inc.description,
    },
    notes,
  };
}

// ---------------------------------------------------------------------------
// 1. Tabelog (Japan) — 食べログ. ToS bans copying; structured HTML; sitemap exists.
// ---------------------------------------------------------------------------
const tabelog = defineConnector({
  id: 'tabelog',
  displayName: 'Tabelog (食べログ)',
  tier: 'E',
  coverage: 'Japan, JA; ~800k+ restaurants with structured review HTML; ToS prohibits copying/redistribution',
  plan: {
    access: 'No public content API. Structured HTML behind ToS that bans copying; scrape would be ToS-violating. Probe sitemap only.',
    incremental: 'sitemap-lastmod — restaurant URL <lastmod> gives the changed set since T without fetching protected pages.',
    fingerprint: 'sitemap maxLastmod + URL count (sitemap-lastmod-max). No API/version stamp exists.',
  },
  async run(_input, deps) {
    return sitemapBlockedProbe(deps, {
      sitemapUrls: ['https://tabelog.com/sitemap.xml', 'https://tabelog.com/sitemapindex.xml'],
      homepageUrl: 'https://tabelog.com/',
      tosNote:
        "Tabelog ToS bans copying/redistribution of listings and reviews; robots.txt also blocks GPTBot and adds crawl-delay. Status 'blocked' — sanctioned ingestion needs a Kakaku.com/Tabelog data licence, not scraping.",
    });
  },
});

// ---------------------------------------------------------------------------
// 2. Wongnai (Thailand) — LINE MAN Wongnai. Only merchant/POS API; ~900k eateries.
// ---------------------------------------------------------------------------
const wongnai = defineConnector({
  id: 'wongnai',
  displayName: 'Wongnai (LINE MAN Wongnai)',
  tier: 'E',
  coverage: 'Thailand, TH/EN; ~900k eateries; only a merchant/POS (LINE MAN Wongnai for Business) API exists — no read-only content feed',
  plan: {
    access: 'No public content API — only a merchant/POS integration API (no consumer listing read access). Probe sitemap.',
    incremental: 'sitemap-lastmod — listing URL <lastmod> gives the changed set since T without scraping protected bodies.',
    fingerprint: 'sitemap maxLastmod + URL count (sitemap-lastmod-max).',
  },
  async run(_input, deps) {
    const body = await sitemapBlockedProbe(deps, {
      sitemapUrls: [
        'https://www.wongnai.com/sitemap.xml',
        'https://www.wongnai.com/sitemap_index.xml',
        'https://www.wongnai.com/sitemaps/index.xml',
      ],
      homepageUrl: 'https://www.wongnai.com/',
      tosNote:
        "Wongnai exposes only a merchant/POS API (LINE MAN Wongnai for Business); there is NO sanctioned read-only content API. Status 'blocked' — content ingestion would require a partner data agreement.",
    });
    return body;
  },
});

// ---------------------------------------------------------------------------
// 3. Zomato (India) — public content API DISCONTINUED (~2022); POS-only now.
// ---------------------------------------------------------------------------
const zomato = defineConnector({
  id: 'zomato',
  displayName: 'Zomato',
  tier: 'E',
  coverage: 'India (+ legacy global), EN; restaurant listings/reviews. Public content API discontinued; only a POS integration API remains',
  plan: {
    access: 'Public content API (developers.zomato.com) was DISCONTINUED (~2022). Only zomato.com/developer/integration POS API remains (merchant-only). No content read access.',
    incremental: 'none — no API delta and listing pages are anti-bot protected. Production would diff by content_hash on any future licensed feed.',
    fingerprint: 'content-hash of the probe response (no sitemap-lastmod or version stamp available behind the WAF).',
  },
  async run(_input, deps) {
    const notes: string[] = [];
    const headroom = Math.max(5_000, deps.timeoutMs - 4_000);
    notes.push(
      'Zomato public content API (legacy developers.zomato.com) was discontinued ~2022. The only remaining developer surface is the POS Integration API (zomato.com/developer/integration), which is merchant-only and exposes no consumer listing/review content.',
    );

    // Confirm the wall with a single cheap GET of the public site (no scraping of bodies).
    let status = 0;
    let snippet = '';
    try {
      const res = await fetchT(deps.fetch, 'https://www.zomato.com/', {
        method: 'GET',
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        timeoutMs: headroom,
        allowNotOk: true,
      });
      status = res.status;
      snippet = (await res.text()).slice(0, 1500);
    } catch (e) {
      notes.push(`Homepage probe failed: ${e instanceof Error ? e.message : String(e)} (consistent with aggressive anti-bot).`);
    }
    const challenge = status ? looksLikeChallenge(status, snippet) : null;
    if (challenge) notes.push(`Public site probe: HTTP ${status} — ${challenge}. Listing pages are not crawlable.`);
    else if (status) notes.push(`Public site probe: HTTP ${status} (no sanctioned content API regardless).`);

    return {
      status: 'blocked',
      sourceFingerprint: sourceFp('content-hash', {
        probe: 'zomato.com',
        httpStatus: status,
        challenge: challenge ?? 'none',
        // hash input includes a stable marker so the value is reproducible across runs
        // while still flipping if the WAF response class changes.
        bodyClass: snippet ? 'html' : 'empty',
      }),
      incremental: {
        method: 'none',
        supported: false,
        description:
          'No public content API (discontinued ~2022) and listing pages are anti-bot protected — no since-param, no usable sitemap-lastmod. A licensed/partner feed would be diffed by content_hash.',
      },
      notes,
    };
  },
});

// ---------------------------------------------------------------------------
// 4. Swiggy Dineout (India) — no public content API; POS partner only.
// ---------------------------------------------------------------------------
const swiggyDineout = defineConnector({
  id: 'swiggy-dineout',
  displayName: 'Swiggy Dineout',
  tier: 'E',
  coverage: 'India, EN; dine-out restaurant discovery/booking. No public content API — POS/partner integration only',
  plan: {
    access: 'No public content API. Swiggy exposes only partner/POS integration (merchant-side). Consumer listing data is behind an app/SPA + anti-bot.',
    incremental: 'none — no API delta; SPA content is not sitemap-indexed at listing granularity. Future licensed feed → content_hash diff.',
    fingerprint: 'content-hash of the probe response (no version/lastmod signal available).',
  },
  async run(_input, deps) {
    const notes: string[] = [];
    const headroom = Math.max(5_000, deps.timeoutMs - 4_000);
    notes.push(
      'Swiggy (incl. Dineout) offers no public read-only content API — only partner/POS integrations. Consumer listings render in an authenticated SPA behind anti-bot; not sanctioned for scraping.',
    );

    let status = 0;
    let snippet = '';
    try {
      const res = await fetchT(deps.fetch, 'https://www.swiggy.com/dineout', {
        method: 'GET',
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        timeoutMs: headroom,
        allowNotOk: true,
      });
      status = res.status;
      snippet = (await res.text()).slice(0, 1500);
    } catch (e) {
      notes.push(`Dineout probe failed: ${e instanceof Error ? e.message : String(e)}.`);
    }
    const challenge = status ? looksLikeChallenge(status, snippet) : null;
    if (challenge) notes.push(`Dineout probe: HTTP ${status} — ${challenge}.`);
    else if (status) notes.push(`Dineout probe: HTTP ${status} (SPA shell; listing data fetched client-side via private endpoints).`);

    return {
      status: 'blocked',
      sourceFingerprint: sourceFp('content-hash', {
        probe: 'swiggy.com/dineout',
        httpStatus: status,
        challenge: challenge ?? 'none',
        bodyClass: snippet ? 'spa-shell' : 'empty',
      }),
      incremental: {
        method: 'none',
        supported: false,
        description:
          'No public API delta; SPA is not listing-level sitemap-indexed. A partner/licensed feed would be diffed by content_hash.',
      },
      notes,
    };
  },
});

// ---------------------------------------------------------------------------
// 5. magicpin (India) — ToS bans automated access; sitemap exists.
// ---------------------------------------------------------------------------
const magicpin = defineConnector({
  id: 'magicpin',
  displayName: 'magicpin',
  tier: 'E',
  coverage: 'India, EN; hyperlocal merchant/food discovery + deals. ToS prohibits automated access',
  plan: {
    access: 'No public content API; ToS explicitly bans automated access/scraping. Probe the published sitemap index only.',
    incremental: 'sitemap-lastmod — URL <lastmod> from the sitemap index gives the changed set since T.',
    fingerprint: 'sitemap maxLastmod + URL count (sitemap-lastmod-max).',
  },
  async run(_input, deps) {
    return sitemapBlockedProbe(deps, {
      // robots.txt advertises this index (confirmed at write time).
      sitemapUrls: ['https://magicpin.in/static/sitemaps/index.xml', 'https://magicpin.in/sitemap.xml'],
      homepageUrl: 'https://magicpin.in/',
      tosNote:
        "magicpin ToS explicitly prohibits automated access/scraping. Status 'blocked' — the sitemap gives a ToS-light fingerprint, but ingesting page content needs a data agreement.",
    });
  },
});

// ---------------------------------------------------------------------------
// 6. Burpple (SG/MY) — no API, dynamic load-more; sitemap exists.
// ---------------------------------------------------------------------------
const burpple = defineConnector({
  id: 'burpple',
  displayName: 'Burpple',
  tier: 'E',
  coverage: 'Singapore & Malaysia, EN; food discovery, user reviews, "Beyond" deals. No API; infinite/load-more UI',
  plan: {
    access: 'No public content API; listings load via dynamic "load more" (XHR). Probe the sitemap; page bodies would need a browser.',
    incremental: 'sitemap-lastmod — venue/guide URL <lastmod> gives the changed set; load-more bodies need a browser only for those URLs.',
    fingerprint: 'sitemap maxLastmod + URL count (sitemap-lastmod-max).',
  },
  async run(_input, deps) {
    return sitemapBlockedProbe(deps, {
      sitemapUrls: ['https://www.burpple.com/sitemap.xml', 'https://www.burpple.com/sitemap_index.xml'],
      homepageUrl: 'https://www.burpple.com/',
      tosNote:
        "Burpple has no sanctioned API and uses dynamic load-more for listings. Status 'blocked' — sitemap-lastmod is the delta signal; fetching venue bodies would require a browser and is ToS-risky.",
    });
  },
});

// ---------------------------------------------------------------------------
// 7. HungryGoWhere (Singapore) — Grab editorial, no API; sitemap.
// ---------------------------------------------------------------------------
const hungrygowhere = defineConnector({
  id: 'hungrygowhere',
  displayName: 'HungryGoWhere',
  tier: 'E',
  coverage: 'Singapore, EN; Grab-owned editorial food guide + listings. No public API',
  plan: {
    access: 'No public content API (Grab editorial property). Probe the published sitemap index.',
    incremental: 'sitemap-lastmod — article/listing URL <lastmod> gives the changed set since T.',
    fingerprint: 'sitemap maxLastmod + URL count (sitemap-lastmod-max).',
  },
  async run(_input, deps) {
    return sitemapBlockedProbe(deps, {
      // robots.txt advertises sitemap_index.xml on the apex host (confirmed at write time).
      sitemapUrls: [
        'https://hungrygowhere.com/sitemap_index.xml',
        'https://www.hungrygowhere.com/sitemap_index.xml',
        'https://www.hungrygowhere.com/sitemap.xml',
      ],
      homepageUrl: 'https://www.hungrygowhere.com/',
      tosNote:
        "HungryGoWhere (Grab) has no public content API. Status 'blocked' — sitemap-lastmod is a clean delta signal; editorial content ingestion would need Grab's permission.",
    });
  },
});

// ---------------------------------------------------------------------------
// 8. Foody / ShopeeFood (Vietnam) — no open API; sitemap (risky).
// ---------------------------------------------------------------------------
const foodyShopeefood = defineConnector({
  id: 'foody-shopeefood',
  displayName: 'Foody / ShopeeFood',
  tier: 'E',
  coverage: 'Vietnam, VI; Foody listings + ShopeeFood (Sea Group) delivery. No open content API',
  plan: {
    access: 'No open public content API (private app/XHR endpoints behind anti-bot). Probe the sitemap.',
    incremental: 'sitemap-lastmod — listing URL <lastmod> gives the changed set; otherwise no public delta.',
    fingerprint: 'sitemap maxLastmod + URL count (sitemap-lastmod-max), or homepage HEAD fallback.',
  },
  async run(_input, deps) {
    return sitemapBlockedProbe(deps, {
      sitemapUrls: [
        'https://www.foody.vn/sitemap.xml',
        'https://www.foody.vn/sitemap_index.xml',
        'https://shopeefood.vn/sitemap.xml',
      ],
      homepageUrl: 'https://www.foody.vn/',
      tosNote:
        "Foody/ShopeeFood exposes no open content API; private app endpoints sit behind anti-bot. Status 'blocked' — sitemap-lastmod (where reachable) is the delta signal.",
    });
  },
});

// ---------------------------------------------------------------------------
// 9. Eatigo (TH/SG/MY/HK/IN) — ToS explicitly bans AI/automated scraping.
// ---------------------------------------------------------------------------
const eatigo = defineConnector({
  id: 'eatigo',
  displayName: 'Eatigo',
  tier: 'E',
  coverage: 'Thailand, Singapore, Malaysia, Hong Kong, India; EN; time-based restaurant reservation discounts. ToS bans AI/automated scraping',
  plan: {
    access: 'No public content API; ToS EXPLICITLY bans AI/automated scraping. Probe sitemap/homepage to document the wall only.',
    incremental: 'none — ToS forbids automated access, so even sitemap-driven delta would violate it. Any licensed feed → content_hash diff.',
    fingerprint: 'content-hash of the probe response (we deliberately do not rely on sitemap-lastmod given the explicit anti-automation ToS).',
  },
  async run(_input, deps) {
    const notes: string[] = [];
    const headroom = Math.max(5_000, deps.timeoutMs - 4_000);
    notes.push(
      "Eatigo's Terms explicitly prohibit AI/automated scraping and data extraction. We therefore classify 'blocked' and do NOT exercise sitemap-driven crawling; only a single homepage HEAD probe documents reachability.",
    );

    let status = 0;
    let challenge: string | null = null;
    let head: Awaited<ReturnType<typeof headFingerprint>> | null = null;
    try {
      head = await headFingerprint(deps.fetch, 'https://eatigo.com/', headroom);
      status = head.status;
      challenge = status ? looksLikeChallenge(status, '') : null;
    } catch (e) {
      notes.push(`Homepage HEAD failed: ${e instanceof Error ? e.message : String(e)}.`);
    }
    if (challenge) notes.push(`Homepage HEAD: HTTP ${status} — ${challenge}.`);
    else if (status) notes.push(`Homepage HEAD: HTTP ${status}.`);

    return {
      status: 'blocked',
      sourceFingerprint: sourceFp('content-hash', {
        probe: 'eatigo.com',
        httpStatus: status,
        etag: head?.headers['etag'] ?? '',
        lastModified: head?.headers['last-modified'] ?? '',
        challenge: challenge ?? 'none',
      }),
      incremental: {
        method: 'none',
        supported: false,
        description:
          'ToS explicitly bans automated access, so no sanctioned delta exists (we deliberately avoid sitemap crawling here). A licensed feed would be diffed by content_hash.',
      },
      notes,
    };
  },
});

// ---------------------------------------------------------------------------
// 10. Qraved (Indonesia) — no API, continuity uncertain; sitemap (risky).
// ---------------------------------------------------------------------------
const qraved = defineConnector({
  id: 'qraved',
  displayName: 'Qraved',
  tier: 'E',
  coverage: 'Indonesia, EN/ID; restaurant discovery + dining deals. No public API; service continuity uncertain',
  plan: {
    access: 'No public content API; product continuity uncertain. Probe sitemap/homepage to confirm liveness + a fingerprint.',
    incremental: 'sitemap-lastmod — listing URL <lastmod> where the sitemap is live; otherwise homepage HEAD.',
    fingerprint: 'sitemap maxLastmod + URL count (sitemap-lastmod-max), or homepage HEAD fallback.',
  },
  async run(_input, deps) {
    return sitemapBlockedProbe(deps, {
      sitemapUrls: ['https://www.qraved.com/sitemap.xml', 'https://www.qraved.com/sitemap_index.xml'],
      homepageUrl: 'https://www.qraved.com/',
      tosNote:
        "Qraved has no public content API and its continuity is uncertain. Status 'blocked' — sitemap-lastmod (if the site is live) is the delta signal; the HEAD fallback also serves as a liveness check.",
    });
  },
});

// ---------------------------------------------------------------------------
// 11. DiningCode (Korea) — no API, aggregated DB; DB-producer-rights risk; sitemap.
// ---------------------------------------------------------------------------
const diningcode = defineConnector({
  id: 'diningcode',
  displayName: 'DiningCode (다이닝코드)',
  tier: 'E',
  coverage: 'South Korea, KO; big-data-driven restaurant rankings (aggregated DB). No API; database-producer-rights risk',
  plan: {
    access: 'No public content API; data is an aggregated/derived database (Korean DB-producer rights apply). Probe sitemap only.',
    incremental: 'sitemap-lastmod — restaurant URL <lastmod> gives the changed set since T.',
    fingerprint: 'sitemap maxLastmod + URL count (sitemap-lastmod-max), or homepage HEAD fallback.',
  },
  async run(_input, deps) {
    return sitemapBlockedProbe(deps, {
      sitemapUrls: [
        'https://www.diningcode.com/sitemap.xml',
        'https://www.diningcode.com/sitemap_index.xml',
        'https://www.diningcode.com/sitemap/sitemap.xml',
      ],
      homepageUrl: 'https://www.diningcode.com/',
      tosNote:
        "DiningCode's content is an aggregated database carrying Korean database-producer (sui generis DB) rights — extracting a substantial part is legally risky. Status 'blocked' — sitemap-lastmod is a ToS-light fingerprint only.",
    });
  },
});

export const tierEAsiaConnectors: SourceConnector[] = [
  tabelog,
  wongnai,
  zomato,
  swiggyDineout,
  magicpin,
  burpple,
  hungrygowhere,
  foodyShopeefood,
  eatigo,
  qraved,
  diningcode,
];
