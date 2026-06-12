import type { TravelRecord } from '../record.js';
import type { MatchSignals } from '../types.js';
import { deriveCells } from '../h3.js';
import { recordUuid } from '../ids.js';
import { fnv1a } from '../hash.js';

/** The fields a normalizer can know up front — the Workflow adds group_uuid, data_version, raw_r2_key. */
type NormalizedRecord = Omit<TravelRecord, 'group_uuid' | 'data_version' | 'raw_r2_key'>;

/** Raw row from stops.txt (csv-parse columns:true output, BOM-stripped). */
export interface GtfsStop {
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_lat: string;
  stop_lon: string;
  /** Any extra columns present in the feed (location_type, parent_station, etc.) */
  [key: string]: string;
}

/** Options for the GTFS stop normalizer. */
export interface GtfsStopOpts {
  source: string;
  category: string;
  sourceUrl: string;
}

/**
 * Map GTFS route_type integer to a category string.
 * Used for mixed-mode feeds; the Penang bus path passes category='bus' directly.
 * 0=tram/light_rail, 1=mrt (heavy rail subway), 2=train (intercity),
 * 3=bus, 4=ferry, 5=cable_car, 6=cable_car, 7=cable_car.
 */
export function routeTypeToCategory(routeType: number): string {
  switch (routeType) {
    case 0: return 'light_rail';
    case 1: return 'mrt';
    case 2: return 'train';
    case 3: return 'bus';
    case 4: return 'ferry';
    case 5:
    case 6:
    case 7: return 'cable_car';
    default: return 'bus';
  }
}

/**
 * Convert one GTFS stops.txt row into a TravelRecord (minus group_uuid/data_version/raw_r2_key)
 * plus entity-resolution match signals. Returns null when lat/lng are not finite or name is missing.
 *
 * Transport records use aliasFor's transport:<category> path, so ALL bus stops in a feed
 * share ONE minted group_uuid via InMemoryGroupRegistry — no brand signals needed.
 */
export function gtfsStopToRecord(
  stop: GtfsStop,
  opts: GtfsStopOpts,
): { record: NormalizedRecord; signals: MatchSignals } | null {
  const name = stop.stop_name?.trim();
  if (!name) return null;

  const rawLat = stop.stop_lat?.trim();
  const rawLng = stop.stop_lon?.trim();
  if (!rawLat || !rawLng) return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!isFinite(lat) || !isFinite(lng)) return null;

  const { source, category, sourceUrl } = opts;
  const source_id = stop.stop_id;
  const cells = deriveCells(lat, lng);

  const record: NormalizedRecord = {
    record_uuid: recordUuid(source, source_id),
    subject: 'transport',
    category,
    name,
    lat,
    lng,
    h3_r5: cells.h3_r5,
    h3_r7: cells.h3_r7,
    h3_r10: cells.h3_r10,
    attributes: JSON.stringify({ stop_code: stop.stop_code }),
    source,
    source_id,
    source_url: sourceUrl,
    lang: 'en',
    content_hash: fnv1a(name + lat + lng + source + source_id),
  };

  // Transport groups by category, not brand — empty signals so aliasFor falls
  // through to the transport:<category> path.
  const signals: MatchSignals = {};

  return { record, signals };
}
