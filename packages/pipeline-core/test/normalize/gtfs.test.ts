import { describe, it, expect } from 'vitest';
import { gtfsStopToRecord, routeTypeToCategory } from '../../src/normalize/gtfs.js';
import type { GtfsStop } from '../../src/normalize/gtfs.js';
import { deriveCells } from '../../src/h3.js';
import { recordUuid } from '../../src/ids.js';
import { fnv1a } from '../../src/hash.js';

/** Golden stop fixture — shape matches csv-parse output with `columns:true, bom:true`.
 * Mirrors a real Penang Rapid Bus Penang row:
 * stop_id=12000418, stop_code=IBE0418, stop_name=Setia Triangle, lat=5.30294, lon=100.26187
 */
const goldenStop: GtfsStop = {
  stop_id: '12000418',
  stop_code: 'IBE0418',
  stop_name: 'Setia Triangle',
  stop_lat: '5.30294',
  stop_lon: '100.26187',
};

const OPTS = {
  source: 'gtfs-rapid-bus-penang',
  category: 'bus',
  sourceUrl: 'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-penang',
};

describe('gtfsStopToRecord', () => {
  it('normalizes a golden Penang bus stop into a snake_case TravelRecord (minus group/version/raw key)', () => {
    const out = gtfsStopToRecord(goldenStop, OPTS);
    expect(out).not.toBeNull();
    const { record, signals } = out!;

    const cells = deriveCells(5.30294, 100.26187);
    expect(record.record_uuid).toBe(recordUuid('gtfs-rapid-bus-penang', '12000418'));
    expect(record.subject).toBe('transport');
    expect(record.category).toBe('bus');
    expect(record.name).toBe('Setia Triangle');
    expect(record.lat).toBe(5.30294);
    expect(record.lng).toBe(100.26187);
    expect(record.h3_r5).toBe(cells.h3_r5);
    expect(record.h3_r7).toBe(cells.h3_r7);
    expect(record.h3_r10).toBe(cells.h3_r10);
    expect(record.source).toBe('gtfs-rapid-bus-penang');
    expect(record.source_id).toBe('12000418');
    expect(record.source_url).toBe('https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-penang');
    expect(record.lang).toBe('en');
    expect(record.content_hash).toBe(
      fnv1a('Setia Triangle' + 5.30294 + 100.26187 + 'gtfs-rapid-bus-penang' + '12000418'),
    );

    // attributes JSON contains stop_code
    const attrs = JSON.parse(record.attributes);
    expect(attrs.stop_code).toBe('IBE0418');

    // transport subject → empty signals (groups by category, not brand)
    expect(signals).toEqual({});

    // group_uuid / data_version / raw_r2_key are NOT on the record
    expect('group_uuid' in record).toBe(false);
    expect('data_version' in record).toBe(false);
    expect('raw_r2_key' in record).toBe(false);
  });

  it('returns null when stop_lat / stop_lon are empty strings', () => {
    const stop: GtfsStop = { ...goldenStop, stop_lat: '', stop_lon: '' };
    expect(gtfsStopToRecord(stop, OPTS)).toBeNull();
  });

  it('returns null when stop_lat / stop_lon are non-numeric', () => {
    const stop: GtfsStop = { ...goldenStop, stop_lat: 'NaN', stop_lon: 'NaN' };
    expect(gtfsStopToRecord(stop, OPTS)).toBeNull();
  });

  it('returns null when stop_name is empty', () => {
    const stop: GtfsStop = { ...goldenStop, stop_name: '' };
    expect(gtfsStopToRecord(stop, OPTS)).toBeNull();
  });

  it('returns null when stop_name is whitespace only', () => {
    const stop: GtfsStop = { ...goldenStop, stop_name: '   ' };
    expect(gtfsStopToRecord(stop, OPTS)).toBeNull();
  });

  it('tolerates extra columns (location_type, parent_station) that some feeds include', () => {
    const stop: GtfsStop = {
      ...goldenStop,
      location_type: '0',
      parent_station: '',
    };
    const out = gtfsStopToRecord(stop, OPTS);
    expect(out).not.toBeNull();
    expect(out!.record.name).toBe('Setia Triangle');
  });
});

describe('routeTypeToCategory', () => {
  it('maps 0 → light_rail', () => expect(routeTypeToCategory(0)).toBe('light_rail'));
  it('maps 1 → mrt', () => expect(routeTypeToCategory(1)).toBe('mrt'));
  it('maps 2 → train', () => expect(routeTypeToCategory(2)).toBe('train'));
  it('maps 3 → bus', () => expect(routeTypeToCategory(3)).toBe('bus'));
  it('maps 4 → ferry', () => expect(routeTypeToCategory(4)).toBe('ferry'));
  it('maps 5 → cable_car', () => expect(routeTypeToCategory(5)).toBe('cable_car'));
  it('maps 6 → cable_car', () => expect(routeTypeToCategory(6)).toBe('cable_car'));
  it('maps 7 → cable_car', () => expect(routeTypeToCategory(7)).toBe('cable_car'));
  it('maps unknown → bus (default)', () => expect(routeTypeToCategory(99)).toBe('bus'));
});
