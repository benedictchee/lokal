/**
 * Tier D — partner/affiliate-gated OTAs. Reviews are rarely (often never)
 * licensed for downstream AI use, and several explicitly forbid data forwarding
 * or require non-indexable display. None of these expose a keyless public data
 * endpoint, so the CHEAP, SANCTIONED probe here is: HEAD the public *developer /
 * partner docs portal* to confirm it is reachable (the gate is contractual, not
 * technical), classify the source as `needs_license`, and document the realistic
 * review-delta mechanism + fingerprint for the day a partner agreement lands.
 *
 * Each connector:
 *  - headFingerprint() the docs/portal URL → an `etag`/`last-modified` source
 *    fingerprint that flips when the API contract/docs change (the cheapest
 *    signal we can legally take without a key).
 *  - looksLikeChallenge() on the probe so we report WAF walls honestly.
 *  - if a partner credential is present in deps.env, attempt a tiny live pull of
 *    a few records (status 'ok'/'partial'); otherwise 'needs_license'.
 *  - plan.incremental reflects the BEST realistic delta for THIS source
 *    (Booking last_change 24h window is the only true since-param here).
 *
 * Confirmed portal/doc URLs (no invented endpoints):
 *   booking-com   https://developers.booking.com/demand/docs  (host demandapi.booking.com)
 *   agoda         https://partners.agoda.com/DeveloperPortal/
 *   klook         https://klook.gitbook.io/openapi
 *   getyourguide  https://code.getyourguide.com/partner-api-spec/  (api.getyourguide.com)
 *   viator        https://docs.viator.com/partner-api/  (api.viator.com)
 *   thefork       https://docs.thefork.io/
 *   opentable     https://docs.opentable.com/
 *   resy          https://docs.resy.com/
 *   hostelworld   https://partner-api.hostelworld.com/
 *   trip-com      https://connect.trip.com/  (open.trip.com/docs)
 *   traveloka     https://www.travelokapartnersnetwork.com/
 *   chope         https://www.chope.co/  (partner program)
 */
import { defineConnector } from '../core/connector.js';
import type { PullBody } from '../core/connector.js';
import { fetchT, headFingerprint, looksLikeChallenge, mkRecord, sourceFp, UA } from '../core/fingerprint.js';
import type { ConnectorDeps, IncrementalCapability, SourceConnector } from '../core/types.js';

/**
 * Shared portal probe used by every tier-D OTA: HEAD the docs/portal URL for a
 * cheap fingerprint, falling back to a light GET when HEAD yields nothing (some
 * docs CDNs reject HEAD). Returns the fingerprint + any anti-bot challenge so
 * the connector can report the wall honestly. Never throws.
 */
async function probePortal(
  deps: ConnectorDeps,
  url: string,
): Promise<{
  fp: ReturnType<typeof sourceFp>;
  status: number;
  challenge: string | null;
  reachable: boolean;
  via: 'head' | 'get' | 'none';
}> {
  const budget = Math.max(6000, Math.min(deps.timeoutMs - 4000, 15000));
  // 1) Cheapest: HEAD → ETag/Last-Modified fingerprint.
  try {
    const h = await headFingerprint(deps.fetch, url, budget);
    if (h.fp && h.status > 0 && h.status < 400) {
      return { fp: h.fp, status: h.status, challenge: null, reachable: true, via: 'head' };
    }
    // HEAD reached the host but gave no usable validators / non-2xx → try a small GET.
    const res = await fetchT(deps.fetch, url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json' },
      timeoutMs: budget,
      allowNotOk: true,
    });
    const body = (await res.text()).slice(0, 2000);
    const challenge = looksLikeChallenge(res.status, body);
    if (challenge) {
      return { fp: sourceFp('none', { reason: challenge, url }), status: res.status, challenge, reachable: true, via: 'get' };
    }
    const etag = res.headers.get('etag');
    const lastmod = res.headers.get('last-modified');
    const fp = sourceFp(etag ? 'portal-etag' : lastmod ? 'portal-last-modified' : 'portal-status', {
      url,
      status: res.status,
      ...(etag ? { etag } : {}),
      ...(lastmod ? { lastModified: lastmod } : {}),
    });
    return { fp, status: res.status, challenge: null, reachable: res.status > 0 && res.status < 500, via: 'get' };
  } catch (e) {
    return {
      fp: sourceFp('none', { reason: `portal unreachable: ${e instanceof Error ? e.message : String(e)}`, url }),
      status: 0,
      challenge: null,
      reachable: false,
      via: 'none',
    };
  }
}

/** One-line summary of the portal probe outcome for notes[]. */
function portalNote(p: Awaited<ReturnType<typeof probePortal>>, url: string): string {
  if (!p.reachable) return `Partner docs portal unreachable (${url}); fingerprint via 'none'. Gate is contractual, not technical.`;
  if (p.challenge) return `Partner docs portal behind anti-bot: ${p.challenge} (${url}).`;
  return `Partner docs portal reachable (${p.via.toUpperCase()} HTTP ${p.status}, ${url}); fingerprinted via ${p.fp.method}. Access gate is the partner/licence agreement, not a technical wall.`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* booking-com — Demand API. The ONLY source here with a true since-param:      */
/* the `last_change` query supports a ~24h change-tracking window for reviews/   */
/* scores. Data-forwarding to third parties (incl. AI training) is forbidden.    */
/* ────────────────────────────────────────────────────────────────────────── */
export const bookingCom = defineConnector({
  id: 'booking-com',
  displayName: 'Booking.com (Demand API)',
  tier: 'D',
  coverage: 'Global; hotels/properties; reviews + scores; partner/connectivity contract required',
  plan: {
    access: 'Demand API (demandapi.booking.com) — API key + affiliate ID; signed partner agreement. Data forwarding to third parties forbidden.',
    incremental: "Reviews change-tracking via `last_change` 24h window — true server-side since-param (api-since-param).",
    fingerprint: 'Per-property reviews count + last_change timestamp (timestamped → exact); portal etag as keyless fallback.',
  },
  async run(input, deps): Promise<PullBody> {
    const notes: string[] = [];
    const PORTAL = 'https://developers.booking.com/demand/docs';
    const incremental: IncrementalCapability = {
      method: 'api-since-param',
      supported: true,
      description:
        "Demand API reviews/scores support a `last_change` change-tracking window (~24h): request properties changed since T and diff. This is a genuine server-side delta — the strongest available across tier D.",
      sinceApplied: input.sinceTimestamp,
    };
    const key = deps.env.BOOKING_DEMAND_API_KEY ?? deps.env.BOOKING_API_KEY;
    const affiliate = deps.env.BOOKING_AFFILIATE_ID;

    // Probe the docs portal for the keyless fingerprint regardless of key presence.
    const portal = await probePortal(deps, PORTAL);
    notes.push(portalNote(portal, PORTAL));

    if (!key || !affiliate) {
      notes.push(
        'No BOOKING_DEMAND_API_KEY / BOOKING_AFFILIATE_ID set. Demand API is partner-gated; review egress to third parties (incl. AI) is contractually forbidden — classify needs_license.',
      );
      return { status: 'needs_license', sourceFingerprint: portal.fp, incremental, notes };
    }

    // Credential present → confirm the gate against the real host (sandbox-style).
    const limit = Math.min(input.limit ?? 10, 25);
    try {
      const res = await fetchT(deps.fetch, 'https://demandapi.booking.com/3.1/accommodations/reviews/scores', {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/json',
          'X-Affiliate-Id': affiliate,
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ rows: limit }),
        timeoutMs: Math.max(6000, deps.timeoutMs - 4000),
        allowNotOk: true,
      });
      const text = await res.text();
      const challenge = looksLikeChallenge(res.status, text);
      if (challenge) {
        return {
          status: 'blocked',
          sourceFingerprint: sourceFp('none', { reason: challenge }),
          incremental,
          notes: [...notes, `Demand API call hit anti-bot: ${challenge}.`],
        };
      }
      if (!res.ok) {
        return {
          status: 'needs_license',
          sourceFingerprint: portal.fp,
          incremental,
          notes: [...notes, `Demand API returned HTTP ${res.status} with supplied credentials (likely scope/contract gate). Reviews require a signed Demand contract.`],
        };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      const rows = isRecordArray((parsed as { data?: unknown })?.data) ? ((parsed as { data: Array<Record<string, unknown>> }).data) : [];
      const records = rows.slice(0, limit).map((r) => {
        const sid = String(r.id ?? r.hotel_id ?? r.property_id ?? 'unknown');
        return mkRecord('booking-com', sid, r, {
          name: typeof r.name === 'string' ? r.name : undefined,
          updated_at: typeof r.last_change === 'string' ? r.last_change : undefined,
          raw: r,
        });
      });
      return {
        status: records.length ? 'ok' : 'partial',
        sourceFingerprint: sourceFp('reviewCount+last_change', { sampled: records.length, portal: portal.fp.value }),
        incremental,
        records,
        notes: [...notes, `Live Demand API pull via BOOKING_DEMAND_API_KEY: ${records.length} property review rows. NOTE: data forwarding to third parties is forbidden — for fingerprint/delta R&D only.`],
      };
    } catch (e) {
      return {
        status: 'needs_license',
        sourceFingerprint: portal.fp,
        incremental,
        notes: [...notes, `Demand API probe failed: ${e instanceof Error ? e.message : String(e)}.`],
      };
    }
  },
});

/* ────────────────────────────────────────────────────────────────────────── */
/* agoda — Affiliate API (APAC). No review egress at all; affiliate availability */
/* /rate only. Fingerprint = property id + content_hash (no timestamp).          */
/* ────────────────────────────────────────────────────────────────────────── */
export const agoda = defineConnector({
  id: 'agoda',
  displayName: 'Agoda (Affiliate API)',
  tier: 'D',
  coverage: 'Global, dense APAC; affiliate availability/rate; NO review egress',
  plan: {
    access: 'Agoda Developer Portal (partners.agoda.com) — affiliate API; cid + key, partner agreement. No reviews exposed for egress.',
    incremental: 'No review feed and no modified timestamp → n/a; pull is full content + diff by content_hash (full-only).',
    fingerprint: 'Property id + content_hash of the property/rate payload; portal etag as keyless fallback.',
  },
  async run(_input, deps): Promise<PullBody> {
    const PORTAL = 'https://partners.agoda.com/DeveloperPortal/';
    const incremental: IncrementalCapability = {
      method: 'full-only',
      supported: false,
      description:
        'Affiliate API exposes availability/rates, not reviews, and carries no per-property modified timestamp. Delta = re-pull and diff by content_hash; no sanctioned review feed exists.',
    };
    const portal = await probePortal(deps, PORTAL);
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental,
      notes: [
        portalNote(portal, PORTAL),
        'Agoda affiliate API has NO review egress; reviews require a separate (unavailable) licence. Property id + content_hash is the only fingerprint when a partner cid/key lands.',
      ],
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────── */
/* klook — Partner API (APAC). Reviews are display-only; no delta. Fingerprint = */
/* activity id + rating count.                                                   */
/* ────────────────────────────────────────────────────────────────────────── */
export const klook = defineConnector({
  id: 'klook',
  displayName: 'Klook (Partner API)',
  tier: 'D',
  coverage: 'APAC; activities/experiences; reviews display-only (no storage/egress)',
  plan: {
    access: 'Klook OpenAPI (klook.gitbook.io/openapi) — partner key + signed agreement. Reviews are display-only.',
    incremental: 'No since-param and reviews are display-only (no retention) → none; activity catalogue re-pulled and diffed.',
    fingerprint: 'Activity id + review/rating count (count flip = new reviews); portal etag as keyless fallback.',
  },
  async run(_input, deps): Promise<PullBody> {
    const PORTAL = 'https://klook.gitbook.io/openapi';
    const incremental: IncrementalCapability = {
      method: 'none',
      supported: false,
      description:
        'Partner API has no review since-param; reviews are display-only and may not be retained. Best-effort delta = compare per-activity rating COUNT across snapshots (a count flip signals new reviews).',
    };
    const portal = await probePortal(deps, PORTAL);
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental,
      notes: [
        portalNote(portal, PORTAL),
        'Klook reviews are display-only per partner terms (no storage/egress for AI). Fingerprint = activity id + rating count once a partner key is provisioned.',
      ],
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────── */
/* getyourguide — Partner API. Ratings/reviews availability is tier-dependent;   */
/* no delta. Fingerprint = tour id + review count.                               */
/* ────────────────────────────────────────────────────────────────────────── */
export const getyourguide = defineConnector({
  id: 'getyourguide',
  displayName: 'GetYourGuide (Partner API)',
  tier: 'D',
  coverage: 'Global; tours/activities; ratings/reviews exposed by partner tier',
  plan: {
    access: 'GetYourGuide Partner API (api.getyourguide.com; spec at code.getyourguide.com/partner-api-spec) — token + tier-gated review access.',
    incremental: 'No review since-param → none; re-pull tour reviews and diff by content_hash / review count.',
    fingerprint: 'Tour (activity) id + review count; portal etag as keyless fallback.',
  },
  async run(_input, deps): Promise<PullBody> {
    const PORTAL = 'https://code.getyourguide.com/partner-api-spec/';
    const incremental: IncrementalCapability = {
      method: 'none',
      supported: false,
      description:
        'Partner API exposes ratings/reviews only at higher partner tiers and with no since-param. Delta = compare per-tour review COUNT across snapshots; full re-pull otherwise.',
    };
    const portal = await probePortal(deps, PORTAL);
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental,
      notes: [
        portalNote(portal, PORTAL),
        'Review/rating egress is gated by partner tier and contract. Fingerprint = tour id + review count once a tiered token is provisioned.',
      ],
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────── */
/* viator — Viator Partner API. Reviews available via product detail but MUST be */
/* non-indexable; no delta. Fingerprint = product id + review count.             */
/* ────────────────────────────────────────────────────────────────────────── */
export const viator = defineConnector({
  id: 'viator',
  displayName: 'Viator (Partner API)',
  tier: 'D',
  coverage: 'Global; tours/activities; reviews via product detail, must be non-indexable',
  plan: {
    access: 'Viator Partner API (api.viator.com; docs.viator.com/partner-api) — exact-key header + merchant/affiliate agreement. Reviews must remain non-indexable.',
    incremental: 'No review since-param → none; product /reviews re-pulled and diffed by review count / content_hash.',
    fingerprint: 'Product code (id) + review count; portal etag as keyless fallback.',
  },
  async run(_input, deps): Promise<PullBody> {
    const PORTAL = 'https://docs.viator.com/partner-api/';
    const incremental: IncrementalCapability = {
      method: 'none',
      supported: false,
      description:
        'Partner API serves reviews via the product-detail/reviews endpoint with no since-param. Delta = compare per-product review COUNT across snapshots and re-pull changed products.',
    };
    const portal = await probePortal(deps, PORTAL);
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental,
      notes: [
        portalNote(portal, PORTAL),
        'Viator reviews must be served NON-INDEXABLE per partner terms — incompatible with open AI ingestion without explicit licence. Fingerprint = product id + review count.',
      ],
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────── */
/* thefork — Partners API (Europe). Reviews only to partnership sites; rate      */
/* 200/min, 10k/day; no delta. Fingerprint = restaurant id + review count.       */
/* ────────────────────────────────────────────────────────────────────────── */
export const thefork = defineConnector({
  id: 'thefork',
  displayName: 'TheFork (Partners API)',
  tier: 'D',
  coverage: 'Europe; restaurants/reservations; reviews to partnership sites only',
  plan: {
    access: 'TheFork Partners API (docs.thefork.io) — credentials via developer portal; rate 200/min, 10k/day. Reviews restricted to partnership sites.',
    incremental: 'No review since-param → none; re-pull restaurant reviews and diff by review count (respect 200/min, 10k/day).',
    fingerprint: 'Restaurant id + review count; portal etag as keyless fallback.',
  },
  async run(_input, deps): Promise<PullBody> {
    const PORTAL = 'https://docs.thefork.io/';
    const incremental: IncrementalCapability = {
      method: 'none',
      supported: false,
      description:
        'Partners API has no review since-param. Delta = compare per-restaurant review COUNT across snapshots; throttle to the contracted 200 req/min and 10k req/day.',
    };
    const portal = await probePortal(deps, PORTAL);
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental,
      notes: [
        portalNote(portal, PORTAL),
        'TheFork reviews are licensed to PARTNERSHIP SITES only (no general AI egress). Rate caps 200/min, 10k/day. Fingerprint = restaurant id + review count.',
      ],
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────── */
/* opentable — partner Directory/Guest API. No review delta. Fingerprint =       */
/* restaurant id + content_hash.                                                 */
/* ────────────────────────────────────────────────────────────────────────── */
export const opentable = defineConnector({
  id: 'opentable',
  displayName: 'OpenTable (Directory/Guest API)',
  tier: 'D',
  coverage: 'Global; restaurants/reservations; partner Directory + Guest APIs',
  plan: {
    access: 'OpenTable partner APIs (docs.opentable.com — Directory, Reviews, Guest) — approved partner key only.',
    incremental: 'No since-param surfaced → none; re-pull restaurant records and diff by content_hash.',
    fingerprint: 'Restaurant (RID) id + content_hash of directory payload; portal etag as keyless fallback.',
  },
  async run(_input, deps): Promise<PullBody> {
    const PORTAL = 'https://docs.opentable.com/';
    const incremental: IncrementalCapability = {
      method: 'none',
      supported: false,
      description:
        'Partner Directory/Guest APIs expose no review since-param. Delta = re-pull restaurant records and diff by content_hash; a Reviews API exists but is approval-gated.',
    };
    const portal = await probePortal(deps, PORTAL);
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental,
      notes: [
        portalNote(portal, PORTAL),
        'OpenTable partner APIs require approval; reviews are not generally licensed for AI. Fingerprint = restaurant id + content_hash.',
      ],
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────── */
/* resy — partner API (US). No review delta. Fingerprint = venue id +            */
/* content_hash.                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */
export const resy = defineConnector({
  id: 'resy',
  displayName: 'Resy (Partner API)',
  tier: 'D',
  coverage: 'US; restaurants/reservations; partner-only API (POS/CRM integrations)',
  plan: {
    access: 'Resy partner API (docs.resy.com) — no self-serve portal; access via Resy partnerships team only.',
    incremental: 'No since-param → none; re-pull venue records and diff by content_hash.',
    fingerprint: 'Venue id + content_hash of venue payload; portal etag as keyless fallback.',
  },
  async run(_input, deps): Promise<PullBody> {
    const PORTAL = 'https://docs.resy.com/';
    const incremental: IncrementalCapability = {
      method: 'none',
      supported: false,
      description:
        'Partner API exposes no review since-param. Delta = re-pull venue records and diff by content_hash. The internal api.resy.com is undocumented/unsupported and off-limits.',
    };
    const portal = await probePortal(deps, PORTAL);
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental,
      notes: [
        portalNote(portal, PORTAL),
        'Resy has no self-serve developer portal; access is via direct partnership only. Fingerprint = venue id + content_hash.',
      ],
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────── */
/* hostelworld — Partner API. Latest reviews per property exposed → best tier-D  */
/* delta after Booking: sort-by-updated (newest-first, stop at T). Fingerprint = */
/* property id + review count.                                                   */
/* ────────────────────────────────────────────────────────────────────────── */
export const hostelworld = defineConnector({
  id: 'hostelworld',
  displayName: 'Hostelworld (Partner API)',
  tier: 'D',
  coverage: 'Global; hostels; partner API exposes latest reviews per property',
  plan: {
    access: 'Hostelworld Partner API (partner-api.hostelworld.com) — partner key + agreement.',
    incremental: 'Latest-reviews-per-property endpoint is newest-first → sort-by-updated: page until reviews older than T.',
    fingerprint: 'Property id + review count (count flip = new reviews); portal etag as keyless fallback.',
  },
  async run(input, deps): Promise<PullBody> {
    const PORTAL = 'https://partner-api.hostelworld.com/';
    const incremental: IncrementalCapability = {
      method: 'sort-by-updated',
      supported: true,
      description:
        'Partner API surfaces LATEST reviews per property in recency order. Delta = walk newest-first and stop once a review predates T — no full re-pull needed. (No explicit since-param, so this is the next-best mechanism.)',
      sinceApplied: input.sinceTimestamp,
    };
    const portal = await probePortal(deps, PORTAL);
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental,
      notes: [
        portalNote(portal, PORTAL),
        'Hostelworld exposes latest reviews per property (newest-first) — enables a sort-by-updated delta once a partner key lands. Fingerprint = property id + review count. Review egress for AI still requires a licence.',
      ],
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────── */
/* trip-com — connect.trip.com connectivity ONLY, no review egress. Reviews are  */
/* scrape-only (out of scope here). Fingerprint = content_hash.                  */
/* ────────────────────────────────────────────────────────────────────────── */
export const tripCom = defineConnector({
  id: 'trip-com',
  displayName: 'Trip.com (connectivity API)',
  tier: 'D',
  coverage: 'Global; hotels/activities; connectivity inventory only, NO review egress',
  plan: {
    access: 'Trip.com connectivity API (connect.trip.com; docs open.trip.com) — partner contract; inventory/booking only.',
    incremental: 'No review feed and no modified timestamp on inventory → n/a; diff inventory by content_hash. Reviews are scrape-only (out of scope).',
    fingerprint: 'content_hash of inventory payload; portal etag as keyless fallback.',
  },
  async run(_input, deps): Promise<PullBody> {
    const PORTAL = 'https://connect.trip.com/';
    const incremental: IncrementalCapability = {
      method: 'full-only',
      supported: false,
      description:
        'Connectivity API is inventory/booking only with no review feed and no per-record modified timestamp. Delta = re-pull and diff by content_hash. Reviews are not available via API (scrape-only — out of sanctioned scope).',
    };
    const portal = await probePortal(deps, PORTAL);
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental,
      notes: [
        portalNote(portal, PORTAL),
        'connect.trip.com offers connectivity (inventory/booking) only — NO review egress. Reviews would be scrape-only (separate tier). Fingerprint = content_hash.',
      ],
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────── */
/* traveloka — Atlas / Traveloka Partners Network (TPN) B2B inventory, no review */
/* feed. Fingerprint = property id + content_hash.                               */
/* ────────────────────────────────────────────────────────────────────────── */
export const traveloka = defineConnector({
  id: 'traveloka',
  displayName: 'Traveloka (Atlas / TPN B2B)',
  tier: 'D',
  coverage: 'SEA; hotels/activities; B2B inventory via Traveloka Partners Network, no review feed',
  plan: {
    access: 'Traveloka Partners Network / Atlas (travelokapartnersnetwork.com) — B2B agreement; inventory/redirection/MiniApp.',
    incremental: 'No review feed and no modified timestamp → n/a; diff inventory by content_hash.',
    fingerprint: 'Property id + content_hash of inventory payload; portal etag as keyless fallback.',
  },
  async run(_input, deps): Promise<PullBody> {
    const PORTAL = 'https://www.travelokapartnersnetwork.com/';
    const incremental: IncrementalCapability = {
      method: 'full-only',
      supported: false,
      description:
        'TPN/Atlas exposes B2B inventory only, with no review feed and no per-property modified timestamp. Delta = re-pull and diff by content_hash.',
    };
    const portal = await probePortal(deps, PORTAL);
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental,
      notes: [
        portalNote(portal, PORTAL),
        'Traveloka Partners Network is B2B inventory only — NO review feed. Fingerprint = property id + content_hash.',
      ],
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────── */
/* chope — partner booking API (SG/HK/TH/ID). No review delta. Fingerprint =     */
/* restaurant id + content_hash.                                                 */
/* ────────────────────────────────────────────────────────────────────────── */
export const chope = defineConnector({
  id: 'chope',
  displayName: 'Chope (Partner Booking API)',
  tier: 'D',
  coverage: 'SG/HK/TH/ID; restaurants/reservations; partner booking API',
  plan: {
    access: 'Chope partner booking API (chope.co partner program) — partner agreement; booking/availability.',
    incremental: 'No since-param → none; re-pull restaurant records and diff by content_hash.',
    fingerprint: 'Restaurant id + content_hash of restaurant payload; portal etag as keyless fallback.',
  },
  async run(_input, deps): Promise<PullBody> {
    const PORTAL = 'https://www.chope.co/';
    const incremental: IncrementalCapability = {
      method: 'none',
      supported: false,
      description:
        'Partner booking API exposes no review since-param. Delta = re-pull restaurant records and diff by content_hash.',
    };
    const portal = await probePortal(deps, PORTAL);
    return {
      status: 'needs_license',
      sourceFingerprint: portal.fp,
      incremental,
      notes: [
        portalNote(portal, PORTAL),
        'Chope partner API is booking-focused; reviews are not licensed for AI egress. Fingerprint = restaurant id + content_hash.',
      ],
    };
  },
});

/** Narrow an unknown to an array of plain records (used to parse loose API JSON). */
function isRecordArray(v: unknown): v is Array<Record<string, unknown>> {
  return Array.isArray(v) && v.every((x) => typeof x === 'object' && x !== null && !Array.isArray(x));
}

export const tierDOtaConnectors: SourceConnector[] = [
  bookingCom,
  agoda,
  klook,
  getyourguide,
  viator,
  thefork,
  opentable,
  resy,
  hostelworld,
  tripCom,
  traveloka,
  chope,
];
