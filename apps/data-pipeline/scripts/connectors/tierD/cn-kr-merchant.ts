/**
 * Tier D — China / Korea merchant-gated platforms.
 *
 * IMPORTANT framing: every "open platform" in this cluster is a MERCHANT / ISV
 * operations gateway, NOT a third-party content API. Onboarding requires a local
 * business entity (a Chinese 营业执照 for the CN platforms; a Korean merchant /
 * Partner-Center account for the KR ones) plus a signed supplier/ISV agreement.
 * None of them expose review/UGC egress to outside developers. So there is no
 * lightweight "pull a few records" path: the cheapest signal that CLASSIFIES the
 * source is portal/docs REACHABILITY + a content_hash of the gateway HTML, which
 * doubles as the change-detection fingerprint (no API timestamp exists).
 *
 * Each connector therefore:
 *   1. HEAD/GET-probes the open-platform (or partner-center) URL,
 *   2. detects anti-bot interstitials via looksLikeChallenge,
 *   3. fingerprints via content_hash of the gateway body (fallback: HEAD ETag /
 *      Last-Modified, or a sitemap-lastmod heuristic for the scrape-only KR ones),
 *   4. returns needs_license (entity + agreement required) — or blocked where even
 *      the merchant gateway is WAF/login-walled with no public content surface.
 *
 * incremental = none/full-only for all of them: these are transactional supplier
 * gateways, not catalog feeds, so there is no sanctioned delta mechanism for
 * third-party content ingestion.
 */
import { defineConnector } from '../core/connector.js';
import {
  fetchT,
  headFingerprint,
  looksLikeChallenge,
  sitemapProbe,
  sourceFp,
  sha256,
  UA,
} from '../core/fingerprint.js';
import type { SourceConnector } from '../core/types.js';

/**
 * Injected runtime fields this module actually uses. Declared locally so the
 * module imports only `SourceConnector` from core/types (the allowed type),
 * while still being strongly typed for the probe helper.
 */
type ProbeDeps = { fetch: typeof fetch; timeoutMs: number };

/**
 * Shared probe: GET the gateway URL with a tight budget, classify the wall, and
 * derive a content_hash fingerprint of the body. Never throws — returns a result
 * object the connector body turns into a PullBody. Falls back to a HEAD ETag/
 * Last-Modified fingerprint when the body can't be read. The `fp` field type is
 * INFERRED from sourceFp/headFingerprint so no SourceFingerprint import is needed.
 */
async function probePortal(deps: ProbeDeps, url: string, label: string) {
  const budget = Math.max(4_000, deps.timeoutMs - 4_000);
  try {
    const res = await fetchT(deps.fetch, url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      timeoutMs: budget,
      allowNotOk: true,
    });
    const body = await res.text();
    const challenge = looksLikeChallenge(res.status, body);
    if (challenge) {
      // Even the gateway is behind anti-bot; fall back to a HEAD header fingerprint.
      const hf = await headFingerprint(deps.fetch, url, Math.min(8_000, budget));
      return {
        reached: true,
        status: res.status,
        challenge,
        fp: hf.fp ?? sourceFp('none', { reason: challenge, url }),
        note: `${label} gateway reachable but anti-bot guarded: ${challenge}.`,
      };
    }
    // content_hash of the gateway HTML = the per-source state fingerprint.
    const hash = sha256(body);
    return {
      reached: res.ok,
      status: res.status,
      challenge: null as string | null,
      fp: sourceFp('content-hash', {
        url,
        httpStatus: res.status,
        contentHash: hash,
        bytes: body.length,
      }),
      note: `${label} gateway probe: HTTP ${res.status}, ${body.length} bytes (content_hash=${hash.slice(0, 16)}).`,
    };
  } catch (e) {
    // Network failure: try a HEAD-only fingerprint before giving up.
    const hf = await headFingerprint(deps.fetch, url, Math.min(8_000, budget)).catch(() => ({
      fp: null,
      status: 0,
      headers: {} as Record<string, string>,
    }));
    return {
      reached: false,
      status: hf.status,
      challenge: null as string | null,
      fp: hf.fp ?? sourceFp('none', { reason: 'gateway unreachable', url }),
      note: `${label} gateway unreachable: ${e instanceof Error ? e.message : String(e)} (timeout / geo-block / DNS).`,
    };
  }
}

// ---------------------------------------------------------------------------
// CHINA — supplier / ISV open platforms. All require a Chinese business entity.
// ---------------------------------------------------------------------------

export const meituan = defineConnector({
  id: 'meituan',
  displayName: 'Meituan Open Platform (美团开放平台)',
  tier: 'D',
  coverage: 'China; merchant/ISV operations APIs (local services, dining, hotels). No third-party review egress.',
  plan: {
    access:
      'open.meituan.com is a MERCHANT/ISV ops gateway — requires a Chinese business license (营业执照) + signed ISV agreement. Not a content API; no review/UGC egress for outside developers.',
    incremental: 'n/a — transactional supplier gateway, no sanctioned content delta feed (full-only/none).',
    fingerprint: 'content_hash of the open-platform gateway HTML (no API version/timestamp surface).',
  },
  async run(_input, deps) {
    const p = await probePortal(deps, 'https://open.meituan.com/', 'Meituan');
    return {
      status: 'needs_license',
      sourceFingerprint: p.fp,
      incremental: {
        method: 'none',
        supported: false,
        description:
          'No content delta mechanism: open.meituan.com serves merchant/ISV ops APIs, not a catalog/review feed. Ingestion would need a signed ISV partnership, not a since-param.',
      },
      notes: [
        p.note,
        'ENTITY REQUIREMENT: Chinese business license (营业执照) + ISV onboarding required to obtain any credentials.',
        'No review/UGC egress to third parties — even with credentials the scope is merchant operations, not content.',
        p.challenge ? `Anti-bot detected: ${p.challenge}.` : '',
      ].filter(Boolean),
    };
  },
});

export const mafengwo = defineConnector({
  id: 'mafengwo',
  displayName: 'Mafengwo Open Platform (马蜂窝开放平台)',
  tier: 'D',
  coverage: 'China; merchant commerce gateway (travel products). Community UGC/reviews are NOT exported.',
  plan: {
    access:
      'open.mafengwo.cn is a merchant COMMERCE gateway (product/order ops) requiring a Chinese entity. The travel community UGC (notes/reviews) is explicitly not exposed to third parties.',
    incremental: 'n/a — merchant commerce ops, no sanctioned UGC delta feed (full-only/none).',
    fingerprint: 'content_hash of the open-platform gateway HTML.',
  },
  async run(_input, deps) {
    const p = await probePortal(deps, 'https://open.mafengwo.cn/', 'Mafengwo');
    return {
      status: 'needs_license',
      sourceFingerprint: p.fp,
      incremental: {
        method: 'none',
        supported: false,
        description:
          'No UGC delta: the open platform covers merchant commerce only; community notes/reviews are not exported, so there is no third-party change feed.',
      },
      notes: [
        p.note,
        'ENTITY REQUIREMENT: Chinese business entity + merchant agreement to access the commerce gateway.',
        'UGC (travel notes / reviews) is the valuable content but is explicitly NOT egressed to third parties.',
        p.challenge ? `Anti-bot detected: ${p.challenge}.` : '',
      ].filter(Boolean),
    };
  },
});

export const ctrip = defineConnector({
  id: 'ctrip',
  displayName: 'Ctrip / Trip.com Supplier & Affiliate (携程)',
  tier: 'D',
  coverage: 'China + intl; supplier push (hotels/activities) + affiliate widgets. No open content/review API.',
  plan: {
    access:
      'Ctrip exposes a SUPPLIER PUSH gateway (inventory in, via connectivity partner) and affiliate widgets (linkout, not data egress). No open third-party content/review API; partnership required.',
    incremental: 'n/a — supplier push is inbound; affiliate is widget linkout. No content pull delta (full-only/none).',
    fingerprint: 'content_hash of the partner/affiliate portal HTML.',
  },
  async run(_input, deps) {
    // Affiliate/partner gateway is the public-facing surface to fingerprint.
    const p = await probePortal(deps, 'https://ct.ctrip.com/', 'Ctrip affiliate/partner');
    return {
      status: 'needs_license',
      sourceFingerprint: p.fp,
      incremental: {
        method: 'none',
        supported: false,
        description:
          'Supplier connectivity is push-IN (we would send inventory, not pull catalog); affiliate is a widget linkout, not a data feed. No content-pull delta exists.',
      },
      notes: [
        p.note,
        'ENTITY REQUIREMENT: signed supplier/connectivity or affiliate agreement; supplier connectivity typically routed via an approved channel manager.',
        'No review egress: affiliate widgets render Ctrip content client-side, they do not license the data.',
        p.challenge ? `Anti-bot detected: ${p.challenge}.` : '',
      ].filter(Boolean),
    };
  },
});

export const qunar = defineConnector({
  id: 'qunar',
  displayName: 'Qunar Supplier Platform (去哪儿)',
  tier: 'D',
  coverage: 'China; supplier/distribution platform (Ctrip group). No open content/review API.',
  plan: {
    access:
      'Qunar (Ctrip group) runs a SUPPLIER platform for inventory distribution. Onboarding requires a Chinese entity + supplier agreement; no open third-party content/review egress.',
    incremental: 'n/a — supplier distribution platform, no sanctioned content delta feed (full-only/none).',
    fingerprint: 'content_hash of the supplier-platform gateway HTML.',
  },
  async run(_input, deps) {
    const p = await probePortal(deps, 'https://b.qunar.com/', 'Qunar supplier');
    return {
      status: 'needs_license',
      sourceFingerprint: p.fp,
      incremental: {
        method: 'none',
        supported: false,
        description:
          'Supplier-facing distribution gateway: inventory flows in from suppliers; there is no third-party content-pull or review delta mechanism.',
      },
      notes: [
        p.note,
        'ENTITY REQUIREMENT: Chinese business entity + supplier agreement (Ctrip-group supplier onboarding).',
        'No review egress to third-party content consumers.',
        p.challenge ? `Anti-bot detected: ${p.challenge}.` : '',
      ].filter(Boolean),
    };
  },
});

export const tongcheng = defineConnector({
  id: 'tongcheng',
  displayName: 'Tongcheng Travel Supplier (同程旅行)',
  tier: 'D',
  coverage: 'China; supplier-facing distribution platform (hotels/transport/tickets). No open content/review API.',
  plan: {
    access:
      'Tongcheng runs a SUPPLIER-FACING platform for inventory distribution; requires a Chinese entity + supplier agreement. No open third-party content/review egress.',
    incremental: 'n/a — supplier distribution, no sanctioned content delta feed (full-only/none).',
    fingerprint: 'content_hash of the supplier-platform gateway HTML.',
  },
  async run(_input, deps) {
    const p = await probePortal(deps, 'https://www.ly.com/', 'Tongcheng');
    return {
      status: 'needs_license',
      sourceFingerprint: p.fp,
      incremental: {
        method: 'none',
        supported: false,
        description:
          'Supplier-facing distribution: inventory is pushed by suppliers; no third-party content-pull or review delta exists.',
      },
      notes: [
        p.note,
        'ENTITY REQUIREMENT: Chinese business entity + supplier agreement.',
        'No review egress; the public www.ly.com surface is consumer booking, not a data feed.',
        p.challenge ? `Anti-bot detected: ${p.challenge}.` : '',
      ].filter(Boolean),
    };
  },
});

export const fliggy = defineConnector({
  id: 'fliggy',
  displayName: 'Fliggy / Alibaba Open Platform (飞猪)',
  tier: 'D',
  coverage: 'China; Alibaba/Taobao open-platform supplier/ISV channel for travel. No open content/review API.',
  plan: {
    access:
      'Fliggy distributes via the Alibaba/Taobao open platform (open.taobao.com) supplier/ISV channel — requires a Chinese entity + Taobao/Alibaba ISV onboarding. No open third-party content/review egress.',
    incremental: 'n/a — Taobao open-platform supplier/ISV APIs, no sanctioned content delta feed (full-only/none).',
    fingerprint: 'content_hash of the Alibaba/Taobao open-platform gateway HTML.',
  },
  async run(_input, deps) {
    // Fliggy rides the Taobao Open Platform; fingerprint that gateway.
    const p = await probePortal(deps, 'https://open.taobao.com/', 'Fliggy/Taobao Open Platform');
    return {
      status: 'needs_license',
      sourceFingerprint: p.fp,
      incremental: {
        method: 'none',
        supported: false,
        description:
          'Taobao Open Platform supplier/ISV APIs are transactional (product/order/logistics); no third-party travel-content or review delta feed is exposed.',
      },
      notes: [
        p.note,
        'ENTITY REQUIREMENT: Chinese entity + Alibaba/Taobao ISV (TOP) onboarding and app review.',
        'No review egress: Fliggy POI/review content is not licensed through the open platform.',
        p.challenge ? `Anti-bot detected: ${p.challenge}.` : '',
      ].filter(Boolean),
    };
  },
});

// ---------------------------------------------------------------------------
// KOREA — merchant / POS / Partner-Center gated. No public developer content API.
// ---------------------------------------------------------------------------

export const catchtable = defineConnector({
  id: 'catchtable',
  displayName: 'CatchTable (캐치테이블)',
  tier: 'D',
  coverage: 'Korea; restaurant reservation/POS platform. No public API — merchant/POS gated.',
  plan: {
    access:
      'CatchTable has NO public developer API; integration is merchant/POS-gated (restaurant onboarding). Outside content access would be scrape-only and ToS-risky.',
    incremental: 'n/a — no API; sitemap-lastmod is the only cheap change heuristic if the site exposes one (else none).',
    fingerprint: 'sitemap-lastmod-max if a sitemap is reachable; otherwise content_hash of the landing page.',
  },
  async run(_input, deps) {
    const notes: string[] = [];
    // Prefer a sitemap fingerprint (cheapest change heuristic for a no-API site).
    const sm = await sitemapProbe(deps.fetch, 'https://app.catchtable.co.kr/sitemap.xml').catch(() => null);
    let fp = sourceFp('none', { reason: 'pending probe', source: 'catchtable' });
    let incSupported = false;
    let incMethod: 'sitemap-lastmod' | 'none' = 'none';
    if (sm && !sm.challenge && (sm.urlCount > 0 || sm.maxLastmod)) {
      fp = sourceFp('sitemap-lastmod-max', {
        maxLastmod: sm.maxLastmod ?? 'none',
        urlCount: sm.urlCount,
        sample: sm.sampleLoc ?? '',
      });
      incSupported = true;
      incMethod = 'sitemap-lastmod';
      notes.push(`Sitemap probe: ${sm.urlCount} entries, maxLastmod=${sm.maxLastmod ?? 'n/a'} (would be the delta heuristic if scraping were licensed).`);
    } else {
      if (sm?.challenge) notes.push(`Sitemap blocked: ${sm.challenge}.`);
      // Fall back to a content_hash of the public landing page.
      const p = await probePortal(deps, 'https://www.catchtable.co.kr/', 'CatchTable');
      fp = p.fp;
      notes.push(p.note);
      if (p.challenge) notes.push(`Anti-bot detected: ${p.challenge}.`);
    }
    return {
      // No public API and no licensed scrape path → blocked (the wall is demonstrated).
      status: 'blocked',
      sourceFingerprint: fp,
      incremental: {
        method: incMethod,
        supported: incSupported,
        description: incSupported
          ? 'Sitemap <lastmod> could yield a changed-URL set, but page bodies are login/JS-gated and scraping is ToS-risky — no sanctioned ingest.'
          : 'No API, no usable sitemap; no sanctioned delta mechanism for third-party content.',
      },
      notes: [
        ...notes,
        'NO public developer API. Integration is merchant/POS-gated (restaurant onboarding); reviews/availability are not egressed to third parties.',
        'A partner agreement or licensed scrape would be required for any ingestion.',
      ],
    };
  },
});

export const yanolja = defineConnector({
  id: 'yanolja',
  displayName: 'Yanolja Cloud B2B Solution (야놀자클라우드)',
  tier: 'D',
  coverage: 'Korea + global; B2B Cloud PMS/inventory APIs for property operators only. No public content/review API.',
  plan: {
    access:
      'Yanolja Cloud exposes B2B Cloud Solution inventory/PMS APIs to contracted property operators only — not a public third-party content/review API. Requires a signed B2B agreement.',
    incremental: 'n/a — operator inventory/PMS APIs, no sanctioned third-party content delta feed (full-only/none).',
    fingerprint: 'content_hash of the B2B cloud solution portal HTML.',
  },
  async run(_input, deps) {
    const p = await probePortal(deps, 'https://cloud.yanolja.com/', 'Yanolja Cloud B2B');
    return {
      status: 'needs_license',
      sourceFingerprint: p.fp,
      incremental: {
        method: 'none',
        supported: false,
        description:
          'B2B Cloud APIs serve a property operator its OWN inventory/PMS data under contract; there is no cross-property content or review delta feed for third parties.',
      },
      notes: [
        p.note,
        'ENTITY REQUIREMENT: signed B2B Cloud Solution agreement; scope is the operator’s own inventory, not a content catalog.',
        'No review egress to third-party content consumers.',
        p.challenge ? `Anti-bot detected: ${p.challenge}.` : '',
      ].filter(Boolean),
    };
  },
});

export const yeogiGoodchoice = defineConnector({
  id: 'yeogi-goodchoice',
  displayName: 'Yeogi Eottae / GoodChoice (여기어때)',
  tier: 'D',
  coverage: 'Korea; accommodation OTA. Merchant Partner Center only — no public developer content API.',
  plan: {
    access:
      'Yeogi Eottae (GoodChoice) offers only a merchant PARTNER CENTER for property operators; no public developer/content API. Outside content access would be scrape-only and ToS-risky.',
    incremental: 'n/a — merchant partner center only, no sanctioned content delta feed (full-only/none).',
    fingerprint: 'content_hash of the partner-center / landing-page gateway HTML.',
  },
  async run(_input, deps) {
    // Probe the partner-center gateway; fall back to the main site if needed.
    const p = await probePortal(deps, 'https://partner.goodchoice.kr/', 'GoodChoice Partner Center');
    let fp = p.fp;
    const notes = [p.note];
    if (!p.reached) {
      const alt = await probePortal(deps, 'https://www.goodchoice.kr/', 'GoodChoice');
      fp = alt.fp;
      notes.push(alt.note);
      if (alt.challenge) notes.push(`Anti-bot detected: ${alt.challenge}.`);
    } else if (p.challenge) {
      notes.push(`Anti-bot detected: ${p.challenge}.`);
    }
    return {
      // Merchant-gated with no public content surface → needs_license, and blocked
      // in practice for third-party content (documented in notes).
      status: 'needs_license',
      sourceFingerprint: fp,
      incremental: {
        method: 'none',
        supported: false,
        description:
          'Partner Center serves an operator its own listing/booking ops; there is no third-party content-pull or review delta mechanism. Public site is JS/anti-bot gated (effectively blocked for scraping).',
      },
      notes: [
        ...notes,
        'ENTITY REQUIREMENT: Korean merchant Partner Center account (property operator); no public developer API.',
        'No review egress; third-party content ingestion would require a partnership or licensed scrape.',
      ],
    };
  },
});

export const tierDCnKrConnectors: SourceConnector[] = [
  meituan,
  mafengwo,
  ctrip,
  qunar,
  tongcheng,
  fliggy,
  catchtable,
  yanolja,
  yeogiGoodchoice,
];
