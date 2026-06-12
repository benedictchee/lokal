/**
 * A single OSM element as returned by the Overpass API `out center` form.
 * SINGLE definition across the monorepo — fetcher + normalizer import it from here.
 */
export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number; // present on nodes
  lon?: number; // present on nodes
  center?: { lat: number; lon: number }; // present on ways/relations via `out center`
  tags: Record<string, string>;
}

/** Entity-resolution match signals extracted by the normalizer, consumed by aliasFor. */
export interface MatchSignals {
  brand?: string;
  brandWikidata?: string;
}
