/**
 * Tier E — China community giants (大众点评 / 小红书 / 穷游网 / 抖音生活服务).
 *
 * These are the hardest sources in the catalog: no sanctioned data egress, very
 * aggressive anti-bot (signed/encrypted requests, glyph-obfuscated reviews,
 * xsec_token walls), AND real legal exposure under China's Anti-Unfair-
 * Competition Law (AUCL) for scraping their UGC. So every connector here:
 *
 *   1. performs the CHEAPEST sanctioned-ish probe that still classifies the wall
 *      — robots.txt / sitemap / homepage HEAD — never a logged-in scrape;
 *   2. reports `blocked` and an explicit risk note (scrape-only / AUCL);
 *   3. produces the BEST realistic fingerprint per source: sitemap-lastmod when a
 *      sitemap is actually reachable, otherwise a content_hash of the public
 *      listing/homepage body (the only thing we can legitimately observe);
 *   4. gates any real page extraction behind PROBE_BROWSER=1 (and even then keeps
 *      it tiny + non-authenticated), because the framework default must not spin
 *      up Chrome against a hostile, signed-request endpoint.
 *
 * None of these expose an open ingestion API, so none can ever be `ok` via HTTP
 * alone; the browser path is a controlled experiment to confirm the wall, not a
 * production ingestion route. Real ingestion requires a commercial partnership.
 */
import { defineConnector } from '../core/connector.js';
import {
  fetchT,
  looksLikeChallenge,
  mkRecord,
  sitemapProbe,
  sourceFp,
  stableStringify,
  UA,
} from '../core/fingerprint.js';
import { browserEnabled, withPage } from '../core/browser.js';
import type { PulledRecord, SourceConnector, SourceFingerprint } from '../core/types.js';

/**
 * Shared helper: fetch a public listing/homepage body and turn it into a
 * content_hash fingerprint (the fallback when no sitemap timestamp exists).
 * Returns the challenge string if a WAF interstitial is detected, so callers can
 * say WHY they are blocked instead of fingerprinting an error page.
 */
async function bodyFingerprint(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<{ fp: SourceFingerprint | null; status: number; challenge: string | null; bytes: number }> {
  try {
    const res = await fetchT(fetchFn, url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      timeoutMs,
      allowNotOk: true,
    });
    const body = await res.text();
    const challenge = looksLikeChallenge(res.status, body);
    if (challenge) return { fp: null, status: res.status, challenge, bytes: body.length };
    // Hash the body so the fingerprint flips when the public listing changes; we
    // record only the length + hash (never the obfuscated/encrypted UGC itself).
    const fp = sourceFp('content-hash', {
      status: res.status,
      bytes: body.length,
      bodyHash: sourceFp('content-hash', { b: body }).value,
      url,
    });
    return { fp, status: res.status, challenge: null, bytes: body.length };
  } catch (e) {
    return { fp: null, status: 0, challenge: e instanceof Error ? e.message : String(e), bytes: 0 };
  }
}

/* ------------------------------------------------------------------ dianping */
/**
 * 大众点评 (Dianping) — China's Yelp. Reviews are rendered with glyph-obfuscated
 * / SVG-mapped fonts and the JSON endpoints require signed requests, so the only
 * legitimately observable signal is the public HTML. robots.txt explicitly
 * blocks AI/CN crawlers but allows /note/*; we still treat this as scrape-only
 * and AUCL-risky. Incremental: sitemap-lastmod IF a sitemap is reachable, else
 * full-only (re-pull + content_hash diff).
 */
export const dianping = defineConnector({
  id: 'dianping',
  displayName: '大众点评 (Dianping)',
  tier: 'E',
  coverage: 'China, ZH; merchant reviews/POIs; glyph-obfuscated reviews + signed JSON APIs',
  plan: {
    access:
      'No public API. Public HTML only; review text is glyph/SVG-obfuscated and data APIs require signed requests. Scrape-only + AUCL legal risk.',
    incremental:
      'sitemap-lastmod IF a sitemap is reachable (changed-URL set); otherwise full-only re-pull + content_hash diff.',
    fingerprint:
      'content_hash of the public listing body (glyph obfuscation makes review parsing unreliable; no API timestamp).',
  },
  async run(input, deps) {
    const notes: string[] = [];
    const t = Math.max(5_000, deps.timeoutMs - 4_000);

    // 1) Try the cheap sitemap-lastmod heuristic first (best realistic delta).
    const sm = await sitemapProbe(deps.fetch, 'https://www.dianping.com/sitemap.xml', t);
    let fp: SourceFingerprint;
    let incMethod: 'sitemap-lastmod' | 'full-only' = 'full-only';
    let incSupported = false;

    if (sm && !sm.challenge && sm.urlCount > 0) {
      fp = sourceFp('sitemap-lastmod-max', {
        maxLastmod: sm.maxLastmod ?? 'none',
        urlCount: sm.urlCount,
        sample: sm.sampleLoc ?? '',
      });
      incMethod = 'sitemap-lastmod';
      incSupported = true;
      notes.push(`Sitemap reachable: ${sm.urlCount} entries, maxLastmod=${sm.maxLastmod ?? 'n/a'} → sitemap-lastmod delta.`);
    } else {
      if (sm?.challenge) notes.push(`Sitemap blocked: ${sm.challenge}.`);
      // 2) Fall back to a content_hash of the public homepage/listing body.
      const bf = await bodyFingerprint(deps.fetch, 'https://www.dianping.com/', t);
      if (bf.challenge) {
        notes.push(`Homepage probe blocked: ${bf.challenge} (HTTP ${bf.status}).`);
        fp = sourceFp('none', { reason: bf.challenge });
      } else if (bf.fp) {
        fp = bf.fp;
        notes.push(`No usable sitemap; fingerprinting public homepage body (${bf.bytes} bytes, HTTP ${bf.status}).`);
      } else {
        fp = sourceFp('none', { reason: 'homepage unreachable' });
      }
    }

    notes.push(
      'Reviews are glyph/SVG-obfuscated and JSON APIs are signed; AUCL legal risk on UGC scraping. Real ingestion needs a commercial agreement.',
    );

    // 3) Browser path (gated): only attempt a tiny, NON-authenticated listing read.
    if (browserEnabled(deps.env)) {
      const recs = await tryBrowserList(
        deps,
        'https://www.dianping.com/shanghai/ch10',
        'a[href*="/shop/"]',
        '/shop/',
        'dianping',
        Math.min(input.limit ?? 10, 25),
        notes,
      );
      if (recs.length) {
        return {
          status: 'partial',
          sourceFingerprint: fp,
          incremental: { method: incMethod, supported: incSupported, description: incDesc(incMethod) },
          records: recs,
          notes: [...notes, `Chrome read ${recs.length} shop links (names obfuscated; demo of the wall, not a production route).`],
        };
      }
    } else {
      notes.push('Set PROBE_BROWSER=1 to attempt a tiny non-authenticated Chrome listing read.');
    }

    return {
      status: 'blocked',
      sourceFingerprint: fp,
      incremental: { method: incMethod, supported: incSupported, description: incDesc(incMethod) },
      notes,
    };
  },
});

/* -------------------------------------------------------------- xiaohongshu */
/**
 * 小红书 / RED (Xiaohongshu) — UGC lifestyle/travel notes. robots.txt is a blanket
 * Disallow:/ and every content API requires an `xsec_token` signature with heavy
 * device fingerprinting; there is no sitemap to lean on. Incremental: none (no
 * timestamped feed we can observe). Fingerprint: content_hash of whatever public
 * surface responds (homepage/explore), purely to detect that the wall is up.
 */
export const xiaohongshu = defineConnector({
  id: 'xiaohongshu',
  displayName: '小红书 / RED (Xiaohongshu)',
  tier: 'E',
  coverage: 'China, ZH; UGC lifestyle & travel notes; xsec_token-signed APIs, robots Disallow:/',
  plan: {
    access:
      'No public API; robots.txt is Disallow:/. Content APIs require xsec_token signing + device fingerprint. Scrape-only + AUCL legal risk.',
    incremental: 'none — no public timestamped feed/sitemap to diff; every note fetch is signed & rate-walled.',
    fingerprint: 'content_hash of the public surface (homepage/explore) — detects the wall; cannot enumerate notes.',
  },
  async run(input, deps) {
    const notes: string[] = [];
    const t = Math.max(5_000, deps.timeoutMs - 4_000);

    // No sitemap to probe (robots Disallow:/). Fingerprint the public surface.
    const bf = await bodyFingerprint(deps.fetch, 'https://www.xiaohongshu.com/explore', t);
    let fp: SourceFingerprint;
    if (bf.challenge) {
      notes.push(`Public surface blocked: ${bf.challenge} (HTTP ${bf.status}).`);
      fp = sourceFp('none', { reason: bf.challenge });
    } else if (bf.fp) {
      fp = bf.fp;
      notes.push(`Fingerprinting /explore body (${bf.bytes} bytes, HTTP ${bf.status}); content gated behind xsec_token.`);
    } else {
      fp = sourceFp('none', { reason: 'explore unreachable' });
    }
    notes.push(
      'robots.txt Disallow:/ ; xsec_token + device-fingerprint signing on every content API; no timestamped feed. AUCL legal risk on UGC. Partnership/API licence required.',
    );

    const inc = {
      method: 'none' as const,
      supported: false,
      description: 'No public sitemap or timestamped feed; signed APIs prevent enumeration — cannot compute a since-delta.',
    };

    if (browserEnabled(deps.env)) {
      // Even with a browser, unauthenticated /explore typically redirects to a
      // login/signing wall — we attempt once to demonstrate that, not to ingest.
      const recs = await tryBrowserList(
        deps,
        'https://www.xiaohongshu.com/explore',
        'a[href*="/explore/"]',
        '/explore/',
        'xiaohongshu',
        Math.min(input.limit ?? 10, 25),
        notes,
      );
      if (recs.length) {
        return {
          status: 'partial',
          sourceFingerprint: fp,
          incremental: inc,
          records: recs,
          notes: [...notes, `Chrome read ${recs.length} note links before the xsec_token wall (demo only).`],
        };
      }
    } else {
      notes.push('Set PROBE_BROWSER=1 to demonstrate the login/xsec_token wall via Chrome.');
    }

    return { status: 'blocked', sourceFingerprint: fp, incremental: inc, notes };
  },
});

/* --------------------------------------------------------------------- qyer */
/**
 * 穷游网 (Qyer) — outbound-travel guides for Chinese travellers. The most
 * scrape-friendly of the four: classic content site with destination/guide
 * pages, so a sitemap-lastmod heuristic is the documented best delta. Still
 * Tier E (ToS reserves rights, WAF in front), so default is `blocked` and the
 * browser path is gated. Fingerprint: sitemap (max lastmod + URL count).
 */
export const qyer = defineConnector({
  id: 'qyer',
  displayName: '穷游网 (Qyer)',
  tier: 'E',
  coverage: 'China→outbound, ZH; destination guides & itineraries; WAF-fronted content site',
  plan: {
    access: 'No public API. Content site behind a WAF; ToS reserves rights. Scrape-only + AUCL/ToS risk.',
    incremental: 'sitemap-lastmod — guide/destination URLs carry <lastmod>; diff the changed-URL set since T.',
    fingerprint: 'sitemap: max(<lastmod>) + URL count (no API timestamp).',
  },
  async run(input, deps) {
    const notes: string[] = [];
    const t = Math.max(5_000, deps.timeoutMs - 4_000);

    const sm = await sitemapProbe(deps.fetch, 'https://www.qyer.com/sitemap.xml', t);
    let fp: SourceFingerprint;
    let incSupported = false;

    if (sm && !sm.challenge && sm.urlCount > 0) {
      fp = sourceFp('sitemap-lastmod-max', {
        maxLastmod: sm.maxLastmod ?? 'none',
        urlCount: sm.urlCount,
        sample: sm.sampleLoc ?? '',
      });
      incSupported = true;
      notes.push(`Sitemap reachable: ${sm.urlCount} entries, maxLastmod=${sm.maxLastmod ?? 'n/a'} → sitemap-lastmod delta.`);
    } else if (sm?.challenge) {
      notes.push(`Sitemap blocked: ${sm.challenge} — WAF in front; cheap fingerprinting needs the challenge solved.`);
      // Best-effort body fingerprint so a snapshot still has SOME value.
      const bf = await bodyFingerprint(deps.fetch, 'https://www.qyer.com/', t);
      fp = bf.fp ?? sourceFp('none', { reason: sm.challenge });
      if (bf.fp) notes.push(`Fell back to homepage content_hash (${bf.bytes} bytes, HTTP ${bf.status}).`);
    } else {
      notes.push('Sitemap unreachable; falling back to homepage content_hash.');
      const bf = await bodyFingerprint(deps.fetch, 'https://www.qyer.com/', t);
      fp = bf.fp ?? sourceFp('none', { reason: bf.challenge ?? 'homepage unreachable' });
      if (bf.challenge) notes.push(`Homepage probe: ${bf.challenge} (HTTP ${bf.status}).`);
    }

    notes.push('ToS reserves rights + WAF; AUCL/ToS risk on guide scraping. Real ingestion needs a partnership.');

    const inc = {
      method: 'sitemap-lastmod' as const,
      supported: incSupported,
      description:
        'Sitemap <lastmod> per guide/destination URL gives the changed-URL set since T without re-pulling everything.',
    };

    if (browserEnabled(deps.env)) {
      const recs = await tryBrowserList(
        deps,
        'https://place.qyer.com/',
        'a[href*="place.qyer.com"]',
        'qyer.com/',
        'qyer',
        Math.min(input.limit ?? 10, 25),
        notes,
      );
      if (recs.length) {
        return {
          status: 'partial',
          sourceFingerprint: fp,
          incremental: inc,
          records: recs,
          notes: [...notes, `Chrome read ${recs.length} place/guide links (demo; production needs a licence).`],
        };
      }
    } else {
      notes.push('Set PROBE_BROWSER=1 to attempt a small Chrome read of place/guide links.');
    }

    return { status: 'blocked', sourceFingerprint: fp, incremental: inc, notes };
  },
});

/* ------------------------------------------------------------- douyin-life */
/**
 * 抖音生活服务 (Douyin Life Services) — ByteDance's video-based local-services /
 * "店探" (store探店) platform. Critically, it is MERCHANT-ONLY: there is no public
 * consumer content egress at all — listings live inside the app / authenticated
 * merchant console, and robots blocks ByteSpider-class crawlers from peers like
 * Dianping. So there is no public surface to enumerate and no timestamped feed.
 * Incremental: none. Fingerprint: content_hash of whatever marketing/landing
 * page responds, purely to confirm the absence of a public data surface.
 */
export const douyinLife = defineConnector({
  id: 'douyin-life',
  displayName: '抖音生活服务 (Douyin Life Services)',
  tier: 'E',
  coverage: 'China, ZH; video 店探/local-services; merchant-only, no public content egress',
  plan: {
    access:
      'No public/consumer API; merchant-only platform (content lives in-app / authenticated merchant console). No content egress.',
    incremental: 'none — no public listing surface or timestamped feed to diff.',
    fingerprint: 'content_hash of the public marketing/landing page (confirms no public data surface; not a data signal).',
  },
  async run(_input, deps) {
    const notes: string[] = [];
    const t = Math.max(5_000, deps.timeoutMs - 4_000);

    // Only a marketing/landing page is public; fingerprint it to prove the wall.
    const bf = await bodyFingerprint(deps.fetch, 'https://life.douyin.com/', t);
    let fp: SourceFingerprint;
    if (bf.challenge) {
      notes.push(`Landing page blocked: ${bf.challenge} (HTTP ${bf.status}).`);
      fp = sourceFp('none', { reason: bf.challenge });
    } else if (bf.fp) {
      fp = bf.fp;
      notes.push(`Fingerprinting merchant landing page (${bf.bytes} bytes, HTTP ${bf.status}) — no consumer listing exists here.`);
    } else {
      fp = sourceFp('none', { reason: 'landing page unreachable' });
    }

    notes.push(
      'Merchant-only platform: POI/review content lives in-app and the authenticated merchant console; NO public egress and no timestamped feed. AUCL/ToS risk. The only sanctioned route is an official merchant-data partnership.',
    );

    // No public listing to scrape — a browser would only hit the same login wall,
    // so we do not attempt extraction even when PROBE_BROWSER=1; we just note it.
    if (browserEnabled(deps.env)) {
      notes.push('PROBE_BROWSER set, but there is no public consumer listing to read — content is behind the merchant login.');
    }

    return {
      status: 'blocked',
      sourceFingerprint: fp,
      incremental: {
        method: 'none',
        supported: false,
        description: 'Merchant-only; no public listing surface or timestamped feed → no since-delta is possible.',
      },
      notes,
    };
  },
});

/* --------------------------------------------------------------- internals */

function incDesc(method: 'sitemap-lastmod' | 'full-only'): string {
  return method === 'sitemap-lastmod'
    ? 'Sitemap <lastmod> per URL gives the changed-URL set since T without re-pulling everything.'
    : 'No sitemap/feed timestamp; must re-pull the public listing and diff by content_hash (full-only).';
}

/**
 * Tiny, NON-authenticated Chrome read of anchor links from a public listing —
 * used ONLY to demonstrate the anti-bot wall under PROBE_BROWSER. Never throws;
 * pushes a note and returns [] on any failure (challenge, login redirect, etc.).
 */
async function tryBrowserList(
  deps: { env: Record<string, string | undefined>; timeoutMs: number; log: (m: string) => void },
  url: string,
  selector: string,
  hrefContains: string,
  connectorId: string,
  limit: number,
  notes: string[],
): Promise<PulledRecord[]> {
  try {
    const items = await withPage(
      async (page) => {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        // The callback runs in the browser; type the matched nodes structurally
        // (href + textContent) so this file needs no DOM lib in the Node tsconfig.
        return page.$$eval(
          selector,
          (els, opts) => {
            const { contains, max } = opts as { contains: string; max: number };
            const anchors = els as ReadonlyArray<{ href: string; textContent: string | null }>;
            const seen = new Set<string>();
            const out: Array<{ href: string; title: string }> = [];
            for (const e of anchors) {
              const href = e.href;
              const title = (e.textContent ?? '').trim();
              if (!href.includes(contains) || seen.has(href)) continue;
              seen.add(href);
              out.push({ href, title });
              if (out.length >= max) break;
            }
            return out;
          },
          { contains: hrefContains, max: limit },
        );
      },
      { timeoutMs: Math.max(8_000, deps.timeoutMs - 5_000) },
    );
    return items.map((it, i) => {
      const sid = it.href.split('//').pop() ?? `${connectorId}-${i}`;
      // We hash only the link metadata we observed — never obfuscated UGC bodies.
      return mkRecord(connectorId, sid, stableStringify(it), {
        name: it.title || undefined,
        raw: it,
      });
    });
  } catch (e) {
    notes.push(`Browser read failed (expected — anti-bot/login wall): ${e instanceof Error ? e.message : String(e)}.`);
    return [];
  }
}

export const tierECnConnectors: SourceConnector[] = [dianping, xiaohongshu, qyer, douyinLife];
