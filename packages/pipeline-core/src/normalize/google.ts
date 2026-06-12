import type { TravelRecord } from '../record.js';
import type { MatchSignals } from '../types.js';
import { deriveCells } from '../h3.js';
import { recordUuid } from '../ids.js';
import { fnv1a } from '../hash.js';

/** The fields a normalizer can know up front — the Workflow adds group_uuid, data_version, raw_r2_key. */
type NormalizedRecord = Omit<TravelRecord, 'group_uuid' | 'data_version' | 'raw_r2_key'>;

/** A single review scraped from the place's Reviews tab. */
export interface GoogleReview {
  author: string;
  stars: number | null;
  date: string;
  text: string;
}

/** The panel data scraped from a place detail page. */
export interface GooglePanel {
  name: string;
  category: string;
  rating: number | null;
  review_count: number | null;
}

/** Raw place object produced by the scraper, before normalization. */
export interface GoogleRawPlace {
  place_id: string;
  ftid: string;
  place_href: string;
  panel: GooglePanel;
  reviews: GoogleReview[];
  scraped_at: string;
  /** Optional coordinates parsed from the place href. */
  lat?: number;
  lng?: number;
}

/** Top-level raw output file written by the scraper. */
export interface GoogleRawOutput {
  source: 'google';
  query: string;
  fetched_via: 'playwright-chrome';
  scraped_at: string;
  places: GoogleRawPlace[];
}

/**
 * Convert one raw Google Maps place into a TravelRecord (minus group_uuid/data_version/raw_r2_key)
 * plus entity-resolution match signals.
 *
 * Returns null when:
 * - place_id is missing
 * - lat/lng coordinates cannot be determined
 */
export function googlePlaceToRecord(
  raw: GoogleRawPlace,
): { record: NormalizedRecord; signals: MatchSignals } | null {
  if (!raw.place_id) return null;

  const lat = raw.lat;
  const lng = raw.lng;
  if (lat === undefined || lng === undefined || !isFinite(lat) || !isFinite(lng)) return null;

  const source = 'google';
  const source_id = raw.place_id;
  const name = raw.panel.name;
  const category = raw.panel.category || 'place';

  const cells = deriveCells(lat, lng);

  const attributes = JSON.stringify({
    rating: raw.panel.rating !== null ? Number(raw.panel.rating) : null,
    review_count: raw.panel.review_count !== null ? Number(raw.panel.review_count) : null,
    ftid: raw.ftid,
    reviews: raw.reviews.map((r) => ({
      text: r.text,
      stars: r.stars,
      author: r.author,
      date: r.date,
    })),
  });

  const record: NormalizedRecord = {
    record_uuid: recordUuid(source, source_id),
    subject: 'poi',
    category,
    name,
    lat,
    lng,
    h3_r5: cells.h3_r5,
    h3_r7: cells.h3_r7,
    h3_r10: cells.h3_r10,
    attributes,
    source,
    source_id,
    source_url: `https://www.google.com/maps/place/?q=place_id:${source_id}`,
    lang: 'en',
    content_hash: fnv1a(name + lat + lng + source + source_id),
  };

  // Google POIs are standalone by default for MVP — no brand signals extracted.
  const signals: MatchSignals = {};

  return { record, signals };
}
