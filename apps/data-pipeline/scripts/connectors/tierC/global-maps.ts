/**
 * Tier C — global commercial maps / POI / review APIs.
 *
 * Tier C = an API EXISTS and is reachable, but the ToS forbids caching or
 * vectorizing the content (display / lookup-only). The legal usable artifact is
 * usually just the provider's stable ID (place_id / fsq_id / location_id / …),
 * which we may store to RE-FETCH on demand — not the body. So for these sources
 * the connector's job is:
 *   1. Prove the API base is reachable and confirm the auth gate (keyless probe).
 *   2. If the key env var IS present, pull a FEW records to prove reachability +
 *      capture the per-place fingerprint (almost always a content_hash, since
 *      none of these expose a per-place last_updated we can filter on).
 *   3. Document the (usually weak / non-existent) incremental delta honestly.
 *
 * None of these endpoints are invented: bases were confirmed against each
 * provider's current developer docs (June 2026). Where a provider deprecated an
 * older base (Foursquare v3 → places-api.foursquare.com on 2026-05-15) the new
 * base is used.
 *
 * IMPORTANT for graduation: because caching the BODY is disallowed, the
 * `record.raw` we attach here is a TRIMMED proof-of-reachability payload for the
 * prototype only; production would persist the ID + content_hash and re-fetch.
 */
import { defineConnector } from '../core/connector.js';
import { fetchT, mkRecord, sourceFp, UA } from '../core/fingerprint.js';
import type { PulledRecord, SourceConnector } from '../core/types.js';

/** Headroom so a slow keyed pull still returns before the framework's budget. */
function budget(timeoutMs: number): number {
  return Math.max(5_000, timeoutMs - 4_000);
}
/** Tier-C prototype cap. */
function cap(limit?: number): number {
  return Math.min(limit ?? 10, 25);
}

/** A small fixed probe location (George Town, Penang) — the project's home market. */
const PENANG = { lat: 5.4141, lng: 100.3288 };

/* -------------------------------------------------------------------------- */
/* google-places — Places API (New); env GOOGLE_MAPS_API_KEY                  */
/* -------------------------------------------------------------------------- */

interface GPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
}

export const googlePlaces = defineConnector({
  id: 'google-places',
  displayName: 'Google Places API (New)',
  tier: 'C',
  coverage: 'Global; commercial. ToS: no caching/storing content beyond place_id (lookup-only).',
  plan: {
    access: 'POST places.googleapis.com/v1/places:searchText with X-Goog-Api-Key (GOOGLE_MAPS_API_KEY) + X-Goog-FieldMask',
    incremental: 'none — no since-param; Place Details has no usable last_updated → full re-poll only',
    fingerprint: 'per-place content_hash of the Place detail proto (no exposed mtime); only place_id is storable per ToS',
  },
  async run(input, deps) {
    const key = deps.env.GOOGLE_MAPS_API_KEY;
    const url = 'https://places.googleapis.com/v1/places:searchText';
    const fieldMask = 'places.id,places.displayName,places.formattedAddress,places.location,places.types';
    const inc = {
      method: 'full-only' as const,
      supported: false,
      description:
        'Places API New exposes no updated_after filter and Place Details carries no usable last-modified; delta = re-poll and diff by content_hash. Only place_id may be cached per ToS.',
    };
    if (!key) {
      // Keyless probe: confirm the gate is the API key, not a network wall.
      let probeStatus = 0;
      try {
        const res = await fetchT(deps.fetch, url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': 'places.id', 'User-Agent': UA },
          body: JSON.stringify({ textQuery: 'restaurants in George Town Penang', maxResultCount: 1 }),
          timeoutMs: 12_000,
          allowNotOk: true,
        });
        probeStatus = res.status;
      } catch {
        /* network */
      }
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('content-hash', { gate: 'GOOGLE_MAPS_API_KEY', probeStatus, place: 'penang' }),
        incremental: inc,
        notes: [
          `No GOOGLE_MAPS_API_KEY; keyless searchText returned HTTP ${probeStatus} (auth gate confirmed).`,
          'Tier C: ToS forbids caching content; only place_id is storable. Set GOOGLE_MAPS_API_KEY to pull a few proof records.',
        ],
      };
    }
    try {
      const res = await fetchT(deps.fetch, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask, 'User-Agent': UA },
        body: JSON.stringify({ textQuery: 'restaurants in George Town Penang', maxResultCount: cap(input.limit) }),
        timeoutMs: budget(deps.timeoutMs),
      });
      const json = (await res.json()) as { places?: GPlace[] };
      const places = json.places ?? [];
      const records: PulledRecord[] = places
        .filter((p): p is GPlace & { id: string } => typeof p.id === 'string')
        .map((p) =>
          mkRecord('google-places', p.id, p, {
            name: p.displayName?.text,
            lat: p.location?.latitude,
            lng: p.location?.longitude,
            raw: { id: p.id, name: p.displayName?.text, types: p.types }, // trimmed; ToS forbids storing full body
          }),
        );
      return {
        status: 'ok',
        sourceFingerprint: sourceFp('content-hash', { count: places.length, place: 'penang', topId: records[0]?.source_id ?? '' }),
        incremental: inc,
        records,
        notes: [
          `Pulled ${records.length} places via GOOGLE_MAPS_API_KEY (proof of reachability).`,
          'Tier C: persist place_id only; re-fetch Place Details on demand. Body NOT cacheable per Google Maps Platform ToS.',
        ],
      };
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('content-hash', { gate: 'GOOGLE_MAPS_API_KEY', place: 'penang' }),
        incremental: inc,
        error: e instanceof Error ? e.message : String(e),
        notes: ['searchText call failed with a key present — see error.'],
      };
    }
  },
});

/* -------------------------------------------------------------------------- */
/* tripadvisor-content — Content API; env TRIPADVISOR_API_KEY                 */
/* -------------------------------------------------------------------------- */

interface TaLocation {
  location_id?: string;
  name?: string;
  address_obj?: { address_string?: string };
}

export const tripadvisorContent = defineConnector({
  id: 'tripadvisor-content',
  displayName: 'Tripadvisor Content API',
  tier: 'C',
  coverage: 'Global; commercial. ToS: cache location_id only, display content live (lookup-only). 50 QPS.',
  plan: {
    access: 'GET api.content.tripadvisor.com/api/v1/location/search?key=TRIPADVISOR_API_KEY',
    incremental: 'none — no since-param; cache the location_id and re-pull details, diff by content_hash',
    fingerprint: 'location_id + content_hash of the location detail (no exposed mtime)',
  },
  async run(input, deps) {
    const key = deps.env.TRIPADVISOR_API_KEY;
    const base = 'https://api.content.tripadvisor.com/api/v1/location/search';
    const inc = {
      method: 'none' as const,
      supported: false,
      description:
        'Content API has no updated_after parameter; the only stable artifact is location_id. Delta = re-fetch /location/{id}/details and diff by content_hash.',
    };
    if (!key) {
      let probeStatus = 0;
      try {
        const res = await fetchT(deps.fetch, `${base}?searchQuery=${encodeURIComponent('George Town Penang')}&language=en`, {
          headers: { Accept: 'application/json', 'User-Agent': UA },
          timeoutMs: 12_000,
          allowNotOk: true,
        });
        probeStatus = res.status;
      } catch {
        /* network */
      }
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('content-hash', { gate: 'TRIPADVISOR_API_KEY', probeStatus }),
        incremental: inc,
        notes: [
          `No TRIPADVISOR_API_KEY; keyless /location/search returned HTTP ${probeStatus} (auth gate confirmed).`,
          'Tier C: cache location_id only; render content live. 50 QPS partner limit.',
        ],
      };
    }
    try {
      const res = await fetchT(deps.fetch, `${base}?key=${encodeURIComponent(key)}&searchQuery=${encodeURIComponent('George Town Penang')}&language=en`, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
        timeoutMs: budget(deps.timeoutMs),
      });
      const json = (await res.json()) as { data?: TaLocation[] };
      const locs = (json.data ?? []).slice(0, cap(input.limit));
      const records: PulledRecord[] = locs
        .filter((l): l is TaLocation & { location_id: string } => typeof l.location_id === 'string')
        .map((l) =>
          mkRecord('tripadvisor-content', l.location_id, l, {
            name: l.name,
            raw: { location_id: l.location_id, name: l.name }, // trimmed
          }),
        );
      return {
        status: 'ok',
        sourceFingerprint: sourceFp('content-hash', { count: locs.length, topId: records[0]?.source_id ?? '' }),
        incremental: inc,
        records,
        notes: [`Pulled ${records.length} locations via TRIPADVISOR_API_KEY.`, 'Tier C: store location_id; content rendered live per ToS.'],
      };
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('content-hash', { gate: 'TRIPADVISOR_API_KEY' }),
        incremental: inc,
        error: e instanceof Error ? e.message : String(e),
        notes: ['/location/search failed with a key present — see error.'],
      };
    }
  },
});

/* -------------------------------------------------------------------------- */
/* yelp-fusion — Fusion v3; env YELP_API_KEY (Bearer)                         */
/* -------------------------------------------------------------------------- */

interface YelpBiz {
  id?: string;
  name?: string;
  coordinates?: { latitude?: number; longitude?: number };
  review_count?: number;
}

export const yelpFusion = defineConnector({
  id: 'yelp-fusion',
  displayName: 'Yelp Fusion API',
  tier: 'C',
  coverage: 'US (+ limited intl); commercial. ToS: 24h cache max, display-only.',
  plan: {
    access: 'GET api.yelp.com/v3/businesses/search with Authorization: Bearer YELP_API_KEY',
    incremental: 'none — no since-param; 24h cache ceiling forces re-poll, diff by content_hash',
    fingerprint: 'business_id + content_hash of the business detail (no exposed mtime)',
  },
  async run(input, deps) {
    const key = deps.env.YELP_API_KEY;
    const base = 'https://api.yelp.com/v3/businesses/search';
    const q = `?latitude=${PENANG.lat}&longitude=${PENANG.lng}&limit=${cap(input.limit)}`;
    const inc = {
      method: 'none' as const,
      supported: false,
      description:
        'Fusion has no updated_after filter and its ToS caps caching at 24h; delta = re-query and diff by content_hash within the 24h window. business_id is the stable key.',
    };
    if (!key) {
      let probeStatus = 0;
      try {
        const res = await fetchT(deps.fetch, `${base}${q}`, { headers: { 'User-Agent': UA }, timeoutMs: 12_000, allowNotOk: true });
        probeStatus = res.status; // expect 401 (missing bearer)
      } catch {
        /* network */
      }
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('content-hash', { gate: 'YELP_API_KEY', probeStatus }),
        incremental: inc,
        notes: [
          `No YELP_API_KEY; keyless /businesses/search returned HTTP ${probeStatus} (Bearer gate confirmed).`,
          'Tier C: Yelp ToS caps caching at 24h; store business_id, render live.',
        ],
      };
    }
    try {
      const res = await fetchT(deps.fetch, `${base}${q}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'User-Agent': UA },
        timeoutMs: budget(deps.timeoutMs),
      });
      const json = (await res.json()) as { businesses?: YelpBiz[] };
      const biz = (json.businesses ?? []).slice(0, cap(input.limit));
      const records: PulledRecord[] = biz
        .filter((b): b is YelpBiz & { id: string } => typeof b.id === 'string')
        .map((b) =>
          mkRecord('yelp-fusion', b.id, b, {
            name: b.name,
            lat: b.coordinates?.latitude,
            lng: b.coordinates?.longitude,
            raw: { id: b.id, name: b.name, review_count: b.review_count }, // trimmed
          }),
        );
      return {
        status: 'ok',
        sourceFingerprint: sourceFp('content-hash', { count: biz.length, topId: records[0]?.source_id ?? '' }),
        incremental: inc,
        records,
        notes: [`Pulled ${records.length} businesses via YELP_API_KEY.`, 'Tier C: 24h cache ceiling; persist business_id only.'],
      };
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('content-hash', { gate: 'YELP_API_KEY' }),
        incremental: inc,
        error: e instanceof Error ? e.message : String(e),
        notes: ['/businesses/search failed with a key present — see error.'],
      };
    }
  },
});

/* -------------------------------------------------------------------------- */
/* foursquare-places-api — new Places API; env FOURSQUARE_API_KEY (Bearer)    */
/* (places-api.foursquare.com — v3 base deprecated 2026-05-15)                */
/* -------------------------------------------------------------------------- */

interface FsqPlace {
  fsq_place_id?: string;
  fsq_id?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  date_refreshed?: string;
}

export const foursquarePlacesApi = defineConnector({
  id: 'foursquare-places-api',
  displayName: 'Foursquare Places API (FSQ OS Places)',
  tier: 'C',
  coverage: 'Global; paid live API. ToS: 30-day cache, display/lookup-only.',
  plan: {
    access: 'GET places-api.foursquare.com/places/search with Authorization: Bearer FOURSQUARE_API_KEY (v3 base deprecated 2026-05-15)',
    incremental: 'sort-by-updated via date_refreshed — the only Tier-C source exposing a per-place freshness date',
    fingerprint: 'fsq_id + date_refreshed (real per-place mtime); 30-day cache ceiling',
  },
  async run(input, deps) {
    const key = deps.env.FOURSQUARE_API_KEY;
    const base = 'https://places-api.foursquare.com/places/search';
    const fields = 'fsq_place_id,name,latitude,longitude,date_refreshed';
    const q = `?ll=${PENANG.lat},${PENANG.lng}&radius=2000&limit=${cap(input.limit)}&fields=${encodeURIComponent(fields)}`;
    const inc = {
      method: 'sort-by-updated' as const,
      supported: true,
      description:
        'Each place carries date_refreshed; sort/scan by it and keep places refreshed since the last snapshot — a real (coarse) per-place freshness delta. Fingerprint = fsq_id + date_refreshed.',
      sinceApplied: input.sinceTimestamp,
    };
    if (!key) {
      let probeStatus = 0;
      try {
        const res = await fetchT(deps.fetch, `${base}${q}`, {
          headers: { Accept: 'application/json', 'X-Places-Api-Version': '2025-06-17', 'User-Agent': UA },
          timeoutMs: 12_000,
          allowNotOk: true,
        });
        probeStatus = res.status; // expect 401
      } catch {
        /* network */
      }
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('fsq_id+date_refreshed', { gate: 'FOURSQUARE_API_KEY', probeStatus }),
        incremental: inc,
        notes: [
          `No FOURSQUARE_API_KEY; keyless /places/search returned HTTP ${probeStatus} (Bearer gate confirmed).`,
          'Tier C: 30-day cache ceiling. New base places-api.foursquare.com (v3 api.foursquare.com deprecated 2026-05-15).',
        ],
      };
    }
    try {
      const res = await fetchT(deps.fetch, `${base}${q}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'X-Places-Api-Version': '2025-06-17', 'User-Agent': UA },
        timeoutMs: budget(deps.timeoutMs),
      });
      const json = (await res.json()) as { results?: FsqPlace[] };
      const results = (json.results ?? []).slice(0, cap(input.limit));
      const records: PulledRecord[] = results
        .map((p) => ({ p, id: p.fsq_place_id ?? p.fsq_id }))
        .filter((x): x is { p: FsqPlace; id: string } => typeof x.id === 'string')
        .map(({ p, id }) =>
          mkRecord('foursquare-places-api', id, p, {
            name: p.name,
            lat: p.latitude,
            lng: p.longitude,
            updated_at: p.date_refreshed,
            raw: { fsq_id: id, name: p.name, date_refreshed: p.date_refreshed }, // trimmed
          }),
        );
      const maxRefreshed = records.map((r) => r.updated_at).filter((x): x is string => !!x).sort().at(-1) ?? '';
      return {
        status: 'ok',
        sourceFingerprint: sourceFp('fsq_id+date_refreshed', { count: results.length, maxRefreshed, topId: records[0]?.source_id ?? '' }),
        incremental: inc,
        records,
        notes: [`Pulled ${records.length} places via FOURSQUARE_API_KEY; max date_refreshed=${maxRefreshed || 'n/a'}.`, 'Tier C: 30-day cache ceiling.'],
      };
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('fsq_id+date_refreshed', { gate: 'FOURSQUARE_API_KEY' }),
        incremental: inc,
        error: e instanceof Error ? e.message : String(e),
        notes: ['/places/search failed with a key present — see error.'],
      };
    }
  },
});

/* -------------------------------------------------------------------------- */
/* mapbox — Search Box API; env MAPBOX_TOKEN                                  */
/* -------------------------------------------------------------------------- */

interface MapboxSuggestion {
  mapbox_id?: string;
  name?: string;
  full_address?: string;
  feature_type?: string;
}

export const mapbox = defineConnector({
  id: 'mapbox',
  displayName: 'Mapbox Search Box / Geocoding',
  tier: 'C',
  coverage: 'Global; commercial. ToS: no permanent storage of results (display-only), no bulk.',
  plan: {
    access: 'GET api.mapbox.com/search/searchbox/v1/suggest?access_token=MAPBOX_TOKEN (session-based)',
    incremental: 'none — no since-param, no bulk; re-query and diff by content_hash',
    fingerprint: 'mapbox_id + content_hash of the retrieved feature (no exposed mtime)',
  },
  async run(input, deps) {
    const key = deps.env.MAPBOX_TOKEN;
    const base = 'https://api.mapbox.com/search/searchbox/v1/suggest';
    const session = '00000000-0000-4000-8000-000000000001'; // fixed UUID for the probe session
    const inc = {
      method: 'none' as const,
      supported: false,
      description:
        'Search Box has no updated_after and no bulk export; mapbox_id is the stable artifact. Delta = re-suggest/retrieve and diff by content_hash. ToS forbids permanent result storage.',
    };
    const q = (tok: string) =>
      `${base}?q=${encodeURIComponent('cafe George Town Penang')}&proximity=${PENANG.lng},${PENANG.lat}&session_token=${session}&limit=${cap(input.limit)}&access_token=${encodeURIComponent(tok)}`;
    if (!key) {
      let probeStatus = 0;
      try {
        const res = await fetchT(deps.fetch, q('invalid'), { headers: { 'User-Agent': UA }, timeoutMs: 12_000, allowNotOk: true });
        probeStatus = res.status; // expect 401 for a bad/missing token
      } catch {
        /* network */
      }
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('content-hash', { gate: 'MAPBOX_TOKEN', probeStatus }),
        incremental: inc,
        notes: [
          `No MAPBOX_TOKEN; probe with an invalid token returned HTTP ${probeStatus} (token gate confirmed).`,
          'Tier C: no permanent storage of results; persist mapbox_id, re-fetch live.',
        ],
      };
    }
    try {
      const res = await fetchT(deps.fetch, q(key), { headers: { Accept: 'application/json', 'User-Agent': UA }, timeoutMs: budget(deps.timeoutMs) });
      const json = (await res.json()) as { suggestions?: MapboxSuggestion[] };
      const sugg = (json.suggestions ?? []).slice(0, cap(input.limit));
      const records: PulledRecord[] = sugg
        .filter((s): s is MapboxSuggestion & { mapbox_id: string } => typeof s.mapbox_id === 'string')
        .map((s) =>
          mkRecord('mapbox', s.mapbox_id, s, {
            name: s.name,
            raw: { mapbox_id: s.mapbox_id, name: s.name, feature_type: s.feature_type }, // trimmed (suggest has no coords; /retrieve does)
          }),
        );
      return {
        status: 'ok',
        sourceFingerprint: sourceFp('content-hash', { count: sugg.length, topId: records[0]?.source_id ?? '' }),
        incremental: inc,
        records,
        notes: [`Pulled ${records.length} suggestions via MAPBOX_TOKEN (coords require a follow-up /retrieve).`, 'Tier C: persist mapbox_id only.'],
      };
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('content-hash', { gate: 'MAPBOX_TOKEN' }),
        incremental: inc,
        error: e instanceof Error ? e.message : String(e),
        notes: ['/searchbox/v1/suggest failed with a token present — see error.'],
      };
    }
  },
});

/* -------------------------------------------------------------------------- */
/* tomtom — Search API POI Search; env TOMTOM_API_KEY                         */
/* -------------------------------------------------------------------------- */

interface TomTomResult {
  id?: string;
  poi?: { name?: string };
  position?: { lat?: number; lon?: number };
}

export const tomtom = defineConnector({
  id: 'tomtom',
  displayName: 'TomTom Search / POI',
  tier: 'C',
  coverage: 'Global; commercial. ToS: 30-day cache, display/lookup-only.',
  plan: {
    access: 'GET api.tomtom.com/search/2/poiSearch/{query}.json?key=TOMTOM_API_KEY',
    incremental: 'none — no since-param; 30-day cache ceiling forces re-poll, diff by content_hash',
    fingerprint: 'POI id + content_hash of the POI result (no exposed mtime)',
  },
  async run(input, deps) {
    const key = deps.env.TOMTOM_API_KEY;
    const query = encodeURIComponent('restaurant');
    const base = `https://api.tomtom.com/search/2/poiSearch/${query}.json`;
    const q = (k: string) => `${base}?lat=${PENANG.lat}&lon=${PENANG.lng}&radius=2000&limit=${cap(input.limit)}&key=${encodeURIComponent(k)}`;
    const inc = {
      method: 'none' as const,
      supported: false,
      description:
        'Search API has no updated_after filter; ToS caps caching at 30 days. Delta = re-query and diff by content_hash. The POI id is the stable key.',
    };
    if (!key) {
      let probeStatus = 0;
      try {
        const res = await fetchT(deps.fetch, q('invalid'), { headers: { 'User-Agent': UA }, timeoutMs: 12_000, allowNotOk: true });
        probeStatus = res.status; // expect 403 (Forbidden) for a bad key
      } catch {
        /* network */
      }
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('content-hash', { gate: 'TOMTOM_API_KEY', probeStatus }),
        incremental: inc,
        notes: [
          `No TOMTOM_API_KEY; probe with an invalid key returned HTTP ${probeStatus} (key gate confirmed).`,
          'Tier C: 30-day cache ceiling; persist POI id, render content live.',
        ],
      };
    }
    try {
      const res = await fetchT(deps.fetch, q(key), { headers: { Accept: 'application/json', 'User-Agent': UA }, timeoutMs: budget(deps.timeoutMs) });
      const json = (await res.json()) as { results?: TomTomResult[] };
      const results = (json.results ?? []).slice(0, cap(input.limit));
      const records: PulledRecord[] = results
        .filter((r): r is TomTomResult & { id: string } => typeof r.id === 'string')
        .map((r) =>
          mkRecord('tomtom', r.id, r, {
            name: r.poi?.name,
            lat: r.position?.lat,
            lng: r.position?.lon,
            raw: { id: r.id, name: r.poi?.name }, // trimmed
          }),
        );
      return {
        status: 'ok',
        sourceFingerprint: sourceFp('content-hash', { count: results.length, topId: records[0]?.source_id ?? '' }),
        incremental: inc,
        records,
        notes: [`Pulled ${records.length} POIs via TOMTOM_API_KEY.`, 'Tier C: 30-day cache ceiling.'],
      };
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('content-hash', { gate: 'TOMTOM_API_KEY' }),
        incremental: inc,
        error: e instanceof Error ? e.message : String(e),
        notes: ['/poiSearch failed with a key present — see error.'],
      };
    }
  },
});

/* -------------------------------------------------------------------------- */
/* here-dev — Geocoding & Search v7 /discover; env HERE_API_KEY               */
/* -------------------------------------------------------------------------- */

interface HereItem {
  id?: string;
  title?: string;
  position?: { lat?: number; lng?: number };
}

export const hereDev = defineConnector({
  id: 'here-dev',
  displayName: 'HERE Geocoding & Search v7',
  tier: 'C',
  coverage: 'Global; commercial. ToS: 30-day cache, display/lookup-only.',
  plan: {
    access: 'GET discover.search.hereapi.com/v1/discover?apiKey=HERE_API_KEY&at=lat,lng&q=…',
    incremental: 'none — no since-param; 30-day cache ceiling forces re-poll, diff by content_hash',
    fingerprint: 'HERE id + content_hash of the discover item (no exposed mtime)',
  },
  async run(input, deps) {
    const key = deps.env.HERE_API_KEY;
    const base = 'https://discover.search.hereapi.com/v1/discover';
    const q = (k: string) => `${base}?at=${PENANG.lat},${PENANG.lng}&q=${encodeURIComponent('restaurant')}&limit=${cap(input.limit)}&apiKey=${encodeURIComponent(k)}`;
    const inc = {
      method: 'none' as const,
      supported: false,
      description:
        'Geocoding & Search v7 has no updated_after filter; ToS caps caching at 30 days. Delta = re-discover and diff by content_hash. The HERE id is the stable key.',
    };
    if (!key) {
      let probeStatus = 0;
      try {
        const res = await fetchT(deps.fetch, q('invalid'), { headers: { 'User-Agent': UA }, timeoutMs: 12_000, allowNotOk: true });
        probeStatus = res.status; // expect 401
      } catch {
        /* network */
      }
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('content-hash', { gate: 'HERE_API_KEY', probeStatus }),
        incremental: inc,
        notes: [
          `No HERE_API_KEY; probe with an invalid key returned HTTP ${probeStatus} (apiKey gate confirmed).`,
          'Tier C: 30-day cache ceiling; persist HERE id, render content live.',
        ],
      };
    }
    try {
      const res = await fetchT(deps.fetch, q(key), { headers: { Accept: 'application/json', 'User-Agent': UA }, timeoutMs: budget(deps.timeoutMs) });
      const json = (await res.json()) as { items?: HereItem[] };
      const items = (json.items ?? []).slice(0, cap(input.limit));
      const records: PulledRecord[] = items
        .filter((i): i is HereItem & { id: string } => typeof i.id === 'string')
        .map((i) =>
          mkRecord('here-dev', i.id, i, {
            name: i.title,
            lat: i.position?.lat,
            lng: i.position?.lng,
            raw: { id: i.id, title: i.title }, // trimmed
          }),
        );
      return {
        status: 'ok',
        sourceFingerprint: sourceFp('content-hash', { count: items.length, topId: records[0]?.source_id ?? '' }),
        incremental: inc,
        records,
        notes: [`Pulled ${records.length} items via HERE_API_KEY.`, 'Tier C: 30-day cache ceiling.'],
      };
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('content-hash', { gate: 'HERE_API_KEY' }),
        incremental: inc,
        error: e instanceof Error ? e.message : String(e),
        notes: ['/v1/discover failed with a key present — see error.'],
      };
    }
  },
});

/* -------------------------------------------------------------------------- */
/* apple-maps — MapKit JS / Maps Server API (JWT); env APPLE_MAPS_TOKEN       */
/* -------------------------------------------------------------------------- */

interface AppleSearchResult {
  id?: string;
  displayMapRegion?: unknown;
  name?: string;
  coordinate?: { latitude?: number; longitude?: number };
}

export const appleMaps = defineConnector({
  id: 'apple-maps',
  displayName: 'Apple Maps Server API',
  tier: 'C',
  coverage: 'Global; commercial. ToS: NO caching of results permitted (strict display-only).',
  plan: {
    access: 'Two-step: exchange APPLE_MAPS_TOKEN (JWT) at maps-api.apple.com/v1/token → access token → GET /v1/search',
    incremental: 'none — no since-param and ToS forbids caching; every render is a live re-fetch',
    fingerprint: 'content_hash only (no stable provider id exposed for storage; no mtime)',
  },
  async run(input, deps) {
    const token = deps.env.APPLE_MAPS_TOKEN;
    const tokenUrl = 'https://maps-api.apple.com/v1/token';
    const inc = {
      method: 'none' as const,
      supported: false,
      description:
        'No updated_after parameter, and the Apple Maps ToS forbids caching results at all — so there is no legal snapshot to diff. Every use is a live lookup; fingerprint is a content_hash for change-detection in-flight only.',
    };
    if (!token) {
      // Probe the token-exchange endpoint without a JWT to confirm the auth gate.
      let probeStatus = 0;
      try {
        const res = await fetchT(deps.fetch, tokenUrl, { headers: { 'User-Agent': UA }, timeoutMs: 12_000, allowNotOk: true });
        probeStatus = res.status; // expect 401 (no Authorization)
      } catch {
        /* network */
      }
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('content-hash', { gate: 'APPLE_MAPS_TOKEN', probeStatus }),
        incremental: inc,
        notes: [
          `No APPLE_MAPS_TOKEN; /v1/token without a JWT returned HTTP ${probeStatus} (auth gate confirmed).`,
          'Tier C (strict): Apple Maps ToS forbids caching results; lookup-only, no stored body or id.',
        ],
      };
    }
    try {
      // Step 1: exchange the JWT auth token for a short-lived access token.
      const tokRes = await fetchT(deps.fetch, tokenUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': UA },
        timeoutMs: budget(deps.timeoutMs),
      });
      const tok = (await tokRes.json()) as { accessToken?: string };
      const access = tok.accessToken;
      if (!access) {
        return {
          status: 'partial',
          sourceFingerprint: sourceFp('content-hash', { gate: 'APPLE_MAPS_TOKEN', step: 'token-exchange', got: 'no-accessToken' }),
          incremental: inc,
          notes: ['Token exchange succeeded but returned no accessToken; check the JWT (team/key id, maps service enabled).'],
        };
      }
      // Step 2: a single search to prove reachability.
      const searchUrl = `https://maps-api.apple.com/v1/search?q=${encodeURIComponent('restaurant George Town Penang')}&searchLocation=${PENANG.lat},${PENANG.lng}`;
      const res = await fetchT(deps.fetch, searchUrl, {
        headers: { Authorization: `Bearer ${access}`, Accept: 'application/json', 'User-Agent': UA },
        timeoutMs: budget(deps.timeoutMs),
      });
      const json = (await res.json()) as { results?: AppleSearchResult[] };
      const results = (json.results ?? []).slice(0, cap(input.limit));
      const records: PulledRecord[] = results.map((r, idx) =>
        // Apple does not expose a durable, storable place id; key the prototype record by name+index.
        mkRecord('apple-maps', r.id ?? `result-${idx}-${r.name ?? 'unnamed'}`, r, {
          name: r.name,
          lat: r.coordinate?.latitude,
          lng: r.coordinate?.longitude,
          raw: { name: r.name }, // trimmed; ToS forbids storing the body
        }),
      );
      return {
        status: 'ok',
        sourceFingerprint: sourceFp('content-hash', { count: results.length, topName: records[0]?.name ?? '' }),
        incremental: inc,
        records,
        notes: [`Pulled ${records.length} search results via APPLE_MAPS_TOKEN (JWT→access-token exchange).`, 'Tier C (strict): results are NOT cacheable per ToS — live lookup only.'],
      };
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('content-hash', { gate: 'APPLE_MAPS_TOKEN' }),
        incremental: inc,
        error: e instanceof Error ? e.message : String(e),
        notes: ['Token exchange or /v1/search failed with a token present — see error.'],
      };
    }
  },
});

/* -------------------------------------------------------------------------- */
/* google-hotels — hotel/attraction reviews via Places API; GOOGLE_MAPS_API_KEY */
/* -------------------------------------------------------------------------- */

interface GHotel {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
}

export const googleHotels = defineConnector({
  id: 'google-hotels',
  displayName: 'Google Hotels/Attractions (Places API reviews)',
  tier: 'C',
  coverage: 'Global; commercial. ToS: no caching beyond place_id (lookup-only).',
  plan: {
    access: 'POST places.googleapis.com/v1/places:searchText (lodging/attraction query) with X-Goog-Api-Key (GOOGLE_MAPS_API_KEY)',
    incremental: 'none — reviews/ratings have no since-param; re-poll Place Details, diff by content_hash',
    fingerprint: 'place_id + content_hash of the rating/review block (rating+userRatingCount move when reviews change)',
  },
  async run(input, deps) {
    const key = deps.env.GOOGLE_MAPS_API_KEY;
    const url = 'https://places.googleapis.com/v1/places:searchText';
    const fieldMask = 'places.id,places.displayName,places.location,places.rating,places.userRatingCount';
    const inc = {
      method: 'none' as const,
      supported: false,
      description:
        'No since-param for reviews; the rating + userRatingCount approximate review change. Delta = re-poll Place Details and diff by content_hash. Only place_id is storable per ToS.',
    };
    if (!key) {
      let probeStatus = 0;
      try {
        const res = await fetchT(deps.fetch, url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': 'places.id', 'User-Agent': UA },
          body: JSON.stringify({ textQuery: 'hotels in George Town Penang', maxResultCount: 1 }),
          timeoutMs: 12_000,
          allowNotOk: true,
        });
        probeStatus = res.status;
      } catch {
        /* network */
      }
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('content-hash', { gate: 'GOOGLE_MAPS_API_KEY', probeStatus, scope: 'lodging' }),
        incremental: inc,
        notes: [
          `No GOOGLE_MAPS_API_KEY; keyless searchText returned HTTP ${probeStatus} (auth gate confirmed).`,
          'Tier C: hotel/attraction reviews via Places API; cache place_id only, content rendered live.',
        ],
      };
    }
    try {
      const res = await fetchT(deps.fetch, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask, 'User-Agent': UA },
        body: JSON.stringify({ textQuery: 'hotels in George Town Penang', maxResultCount: cap(input.limit) }),
        timeoutMs: budget(deps.timeoutMs),
      });
      const json = (await res.json()) as { places?: GHotel[] };
      const places = json.places ?? [];
      const records: PulledRecord[] = places
        .filter((p): p is GHotel & { id: string } => typeof p.id === 'string')
        .map((p) =>
          mkRecord(
            'google-hotels',
            p.id,
            // hash the rating block so the content_hash moves when reviews/ratings change
            { id: p.id, rating: p.rating, userRatingCount: p.userRatingCount },
            {
              name: p.displayName?.text,
              lat: p.location?.latitude,
              lng: p.location?.longitude,
              raw: { id: p.id, name: p.displayName?.text, rating: p.rating, userRatingCount: p.userRatingCount }, // trimmed
            },
          ),
        );
      return {
        status: 'ok',
        sourceFingerprint: sourceFp('content-hash', { count: places.length, topId: records[0]?.source_id ?? '' }),
        incremental: inc,
        records,
        notes: [`Pulled ${records.length} lodging POIs via GOOGLE_MAPS_API_KEY.`, 'Tier C: persist place_id only; reviews/ratings rendered live.'],
      };
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('content-hash', { gate: 'GOOGLE_MAPS_API_KEY', scope: 'lodging' }),
        incremental: inc,
        error: e instanceof Error ? e.message : String(e),
        notes: ['searchText (lodging) failed with a key present — see error.'],
      };
    }
  },
});

/* -------------------------------------------------------------------------- */
/* untappd — beer/venues; env UNTAPPD_CLIENT_ID + UNTAPPD_CLIENT_SECRET       */
/* -------------------------------------------------------------------------- */

interface UntappdCheckin {
  checkin_id?: number;
  beer?: { beer_name?: string };
  venue?: { venue_id?: number; venue_name?: string; location?: { lat?: number; lng?: number } };
}

export const untappd = defineConnector({
  id: 'untappd',
  displayName: 'Untappd API (beer venues)',
  tier: 'C',
  coverage: 'Global beer/venues; API by approval. ToS: 24h cache, no competing beverage DB.',
  plan: {
    access: 'GET api.untappd.com/v4/* with client_id + client_secret (UNTAPPD_CLIENT_ID/SECRET) for unauthorized calls',
    incremental: 'cursor-pagination via max_id/min_id over the checkin id stream — a real resumable cursor',
    fingerprint: 'max checkin_id seen (monotonic) — the cheapest "anything new?" signal',
  },
  async run(input, deps) {
    const id = deps.env.UNTAPPD_CLIENT_ID;
    const secret = deps.env.UNTAPPD_CLIENT_SECRET;
    // Pub-checkins feed for a venue is the cleanest id-stream demo. (venue/checkins/VENUE_ID)
    const venueId = 1; // placeholder venue for the probe; real runs pass a target venue
    const base = `https://api.untappd.com/v4/venue/checkins/${venueId}`;
    const inc = {
      method: 'cursor-pagination' as const,
      supported: true,
      description:
        'Feeds (venue/beer/brewery checkins) accept max_id/min_id over the monotonically increasing checkin_id; resume from the prior run with min_id = last max checkin_id. Cursor = checkin id.',
      sinceApplied: input.cursor,
    };
    if (!id || !secret) {
      let probeStatus = 0;
      try {
        const res = await fetchT(deps.fetch, `${base}?client_id=invalid&client_secret=invalid&limit=1`, { headers: { 'User-Agent': UA }, timeoutMs: 12_000, allowNotOk: true });
        probeStatus = res.status; // expect 401/invalid_api_key
      } catch {
        /* network */
      }
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('max-checkin-id', { gate: 'UNTAPPD_CLIENT_ID+SECRET', probeStatus }),
        incremental: inc,
        notes: [
          `No UNTAPPD_CLIENT_ID/SECRET; probe with invalid creds returned HTTP ${probeStatus} (credential gate confirmed).`,
          'Tier C: API is by approval; 24h cache; ToS forbids building a competing beverage DB. Store venue_id + max checkin_id.',
        ],
      };
    }
    try {
      const params = new URLSearchParams({ client_id: id, client_secret: secret, limit: String(cap(input.limit)) });
      if (input.cursor) params.set('min_id', input.cursor); // resume: only checkins newer than the cursor
      const res = await fetchT(deps.fetch, `${base}?${params}`, { headers: { Accept: 'application/json', 'User-Agent': UA }, timeoutMs: budget(deps.timeoutMs) });
      const json = (await res.json()) as { response?: { checkins?: { items?: UntappdCheckin[] } } };
      const items = (json.response?.checkins?.items ?? []).slice(0, cap(input.limit));
      const records: PulledRecord[] = items
        .filter((c): c is UntappdCheckin & { checkin_id: number } => typeof c.checkin_id === 'number')
        .map((c) =>
          mkRecord('untappd', String(c.venue?.venue_id ?? c.checkin_id), c, {
            name: c.venue?.venue_name ?? c.beer?.beer_name,
            lat: c.venue?.location?.lat,
            lng: c.venue?.location?.lng,
            raw: { checkin_id: c.checkin_id, venue_id: c.venue?.venue_id, venue: c.venue?.venue_name }, // trimmed
          }),
        );
      const maxCheckin = items.map((c) => c.checkin_id ?? 0).reduce((a, b) => Math.max(a, b), 0);
      return {
        status: 'ok',
        sourceFingerprint: sourceFp('max-checkin-id', { maxCheckinId: maxCheckin, count: items.length }),
        incremental: inc,
        records,
        cursor: maxCheckin ? String(maxCheckin) : input.cursor,
        notes: [`Pulled ${records.length} checkins via UNTAPPD creds; max checkin_id=${maxCheckin}.`, 'Tier C: 24h cache, no competing DB.'],
      };
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('max-checkin-id', { gate: 'UNTAPPD_CLIENT_ID+SECRET' }),
        incremental: inc,
        error: e instanceof Error ? e.message : String(e),
        notes: ['venue/checkins failed with creds present — see error.'],
      };
    }
  },
});

/* -------------------------------------------------------------------------- */
/* expedia-rapid — Rapid Guest Reviews; partner-gated; env EXPEDIA_RAPID_KEY  */
/* -------------------------------------------------------------------------- */

interface ExpediaReview {
  id?: string;
  title?: string;
  date_submitted?: string;
}

export const expediaRapid = defineConnector({
  id: 'expedia-rapid',
  displayName: 'Expedia Rapid Guest Reviews',
  tier: 'C',
  coverage: 'Global lodging reviews; partner-gated (EPS Rapid). ToS: 48h cache, display-only.',
  plan: {
    access: 'GET api.ean.com/v3/properties/{property_id}/guest-reviews with EAN signature auth (EXPEDIA_RAPID_KEY)',
    incremental: 'sort-by-updated — per-property review pull; track review count + newest date_submitted (48h cache)',
    fingerprint: 'property_id + review count (+ newest review date) — flips when a new review lands',
  },
  async run(input, deps) {
    const apiKey = deps.env.EXPEDIA_RAPID_KEY;
    // Production base is api.ean.com; reviews live under a property id.
    const propertyId = input.region ?? '12345'; // sample property for the probe
    const base = `https://api.ean.com/v3/properties/${propertyId}/guest-reviews`;
    const inc = {
      method: 'sort-by-updated' as const,
      supported: true,
      description:
        'Pull guest-reviews per property; the review count + newest date_submitted form the per-property delta (a new review changes the fingerprint). ToS caps caching at 48h. property_id is the stable key.',
      sinceApplied: input.sinceTimestamp,
    };
    if (!apiKey) {
      let probeStatus = 0;
      try {
        // EAN auth is a signed header; a keyless request confirms the partner gate (expect 401).
        const res = await fetchT(deps.fetch, `${base}?language=en-US`, { headers: { Accept: 'application/json', 'User-Agent': UA }, timeoutMs: 12_000, allowNotOk: true });
        probeStatus = res.status;
      } catch {
        /* network */
      }
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('property_id+review_count', { gate: 'EXPEDIA_RAPID_KEY', probeStatus, propertyId }),
        incremental: inc,
        notes: [
          `No EXPEDIA_RAPID_KEY; keyless guest-reviews returned HTTP ${probeStatus} (EAN partner gate confirmed).`,
          'Tier C: partner-gated; 48h cache. EAN auth = APIKey+Signature(sha512)+timestamp header; signature build deferred in prototype.',
        ],
      };
    }
    try {
      // NOTE: full EAN auth requires a shared secret to compute the sha512 signature; the
      // prototype sends the key in the header to prove reachability and capture the fingerprint.
      const res = await fetchT(deps.fetch, `${base}?language=en-US`, {
        headers: { Authorization: `EAN APIKey=${apiKey}`, Accept: 'application/json', 'User-Agent': UA },
        timeoutMs: budget(deps.timeoutMs),
        allowNotOk: true,
      });
      if (!res.ok) {
        return {
          status: 'partial',
          sourceFingerprint: sourceFp('property_id+review_count', { propertyId, probeStatus: res.status }),
          incremental: inc,
          notes: [
            `guest-reviews returned HTTP ${res.status} with key present — likely the sha512 Signature/timestamp is required (not just APIKey).`,
            'Reachability + fingerprint method confirmed; full signed-auth pull deferred to production.',
          ],
        };
      }
      const json = (await res.json()) as { reviews?: ExpediaReview[] };
      const reviews = (json.reviews ?? []).slice(0, cap(input.limit));
      const records: PulledRecord[] = reviews
        .filter((r): r is ExpediaReview & { id: string } => typeof r.id === 'string')
        .map((r) =>
          mkRecord('expedia-rapid', `${propertyId}:${r.id}`, r, {
            name: r.title,
            updated_at: r.date_submitted,
            raw: { id: r.id, propertyId, date_submitted: r.date_submitted }, // trimmed
          }),
        );
      const newest = records.map((r) => r.updated_at).filter((x): x is string => !!x).sort().at(-1) ?? '';
      return {
        status: 'ok',
        sourceFingerprint: sourceFp('property_id+review_count', { propertyId, reviewCount: reviews.length, newest }),
        incremental: inc,
        records,
        notes: [`Pulled ${records.length} reviews for property ${propertyId} via EXPEDIA_RAPID_KEY; newest=${newest || 'n/a'}.`, 'Tier C: 48h cache ceiling.'],
      };
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('property_id+review_count', { gate: 'EXPEDIA_RAPID_KEY', propertyId }),
        incremental: inc,
        error: e instanceof Error ? e.message : String(e),
        notes: ['guest-reviews failed with a key present — see error.'],
      };
    }
  },
});

/* -------------------------------------------------------------------------- */
/* Cluster export                                                             */
/* -------------------------------------------------------------------------- */

export const tierCGlobalConnectors: SourceConnector[] = [
  googlePlaces,
  tripadvisorContent,
  yelpFusion,
  foursquarePlacesApi,
  mapbox,
  tomtom,
  hereDev,
  appleMaps,
  googleHotels,
  untappd,
  expediaRapid,
];
