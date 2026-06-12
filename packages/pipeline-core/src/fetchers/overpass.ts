/**
 * OSM Overpass API fetcher (v1 source).
 *
 * `OverpassElement` is defined once in `../types.ts` (Task 1) so the normalizer
 * (Task 4) never forward-depends on this later task; we import and re-export it.
 */
import type { OverpassElement } from '../types.js';
export type { OverpassElement };

interface OverpassResponse {
  elements: OverpassElement[];
}

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

/** Honest identification per OSM/Overpass usage policy (rate-limit accountability). */
const USER_AGENT = 'travel-data-pipeline/1.0 (+management@rushowl.app)';

export interface FetchOverpassOpts {
  /** [south, west, north, east] in WGS84 degrees. */
  bbox: [number, number, number, number];
}

export interface FetchOverpassDeps {
  /** Injected so tests can mock and Worker/CLI pass their own runtime fetch. */
  fetch: typeof fetch;
}

/**
 * Build the Overpass-QL query for POI candidates inside `bbox`.
 *
 * Covers `amenity`, `shop`, AND `tourism` as `nwr` (node/way/relation) sets and
 * emits `out center` so ways/relations carry a representative coordinate.
 */
function buildQuery(bbox: [number, number, number, number]): string {
  const [south, west, north, east] = bbox;
  // Overpass QL bbox filter order is (south,west,north,east).
  const box = `(${south},${west},${north},${east})`;
  return [
    '[out:json][timeout:180];',
    '(',
    `  nwr["amenity"]${box};`,
    `  nwr["shop"]${box};`,
    `  nwr["tourism"]${box};`,
    ');',
    'out center;',
  ].join('\n');
}

/**
 * Fetch POI candidate elements from Overpass for a single bbox.
 *
 * v1 issues ONE request per bbox. SEAM: for large regions, chunk `bbox` into a
 * grid (e.g. by max element count or area) and merge the per-chunk element
 * arrays here, deduping by `${type}/${id}`. Deferred past v1 (D7 — single-bbox).
 */
export async function fetchOverpass(
  opts: FetchOverpassOpts,
  deps: FetchOverpassDeps,
): Promise<OverpassElement[]> {
  const query = buildQuery(opts.bbox);
  const res = await deps.fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!res.ok) {
    throw new Error(`Overpass request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as OverpassResponse;
  return json.elements ?? [];
}
