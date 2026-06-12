import type { TravelRecord } from '../record.js';
import type { OverpassElement, MatchSignals } from '../types.js';
import { deriveCells } from '../h3.js';
import { recordUuid } from '../ids.js';
import { fnv1a } from '../hash.js';

/** The fields a normalizer can know up front — the Workflow adds group_uuid, data_version, raw_r2_key. */
type NormalizedRecord = Omit<TravelRecord, 'group_uuid' | 'data_version' | 'raw_r2_key'>;

function pickCoords(el: OverpassElement): { lat: number; lng: number } | null {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center && typeof el.center.lat === 'number' && typeof el.center.lon === 'number') {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return null;
}

/** Build the address OBJECT from addr:* tags (only present keys, snake_case-free OSM names mapped). */
function buildAddress(tags: Record<string, string>): Record<string, string> {
  const address: Record<string, string> = {};
  if (tags['addr:housenumber']) address.housenumber = tags['addr:housenumber'];
  if (tags['addr:street']) address.street = tags['addr:street'];
  if (tags['addr:city']) address.city = tags['addr:city'];
  if (tags['addr:postcode']) address.postcode = tags['addr:postcode'];
  if (tags['addr:country']) address.country = tags['addr:country'];
  return address;
}

/**
 * Convert one Overpass element into a TravelRecord (minus group_uuid/data_version/raw_r2_key)
 * plus the entity-resolution match signals. Returns null when the element has no usable
 * coordinates or no name.
 */
export function osmElementToRecord(
  el: OverpassElement,
): { record: NormalizedRecord; signals: MatchSignals } | null {
  const name = el.tags.name;
  if (!name) return null;

  const coords = pickCoords(el);
  if (!coords) return null;

  const category = el.tags.amenity ?? el.tags.shop ?? el.tags.tourism;
  if (!category) return null;

  const source = 'osm';
  const source_id = `${el.type}/${el.id}`;
  const { lat, lng } = coords;
  const cells = deriveCells(lat, lng);

  const attributes = JSON.stringify({
    address: buildAddress(el.tags),
    cuisine: el.tags.cuisine,
    opening_hours: el.tags.opening_hours,
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
    source_url: `https://www.openstreetmap.org/${source_id}`,
    lang: 'en',
    content_hash: fnv1a(name + lat + lng + source + source_id),
  };

  const signals: MatchSignals = {};
  if (el.tags.brand) signals.brand = el.tags.brand;
  if (el.tags['brand:wikidata']) signals.brandWikidata = el.tags['brand:wikidata'];

  return { record, signals };
}
