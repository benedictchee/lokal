import { describe, it, expect } from 'vitest';
import { osmElementToRecord } from '../../src/normalize/osm.js';
import { deriveCells } from '../../src/h3.js';
import { recordUuid } from '../../src/ids.js';
import { fnv1a } from '../../src/hash.js';
import {
  standaloneRestaurant,
  brandedCafe,
  wayWithCenter,
  shopElement,
  namelessElement,
  noCoordsElement,
} from '../fixtures/overpass-sample.js';

describe('osmElementToRecord', () => {
  it('normalizes a standalone restaurant node into a snake_case TravelRecord (minus group/version/raw key)', () => {
    const out = osmElementToRecord(standaloneRestaurant);
    expect(out).not.toBeNull();
    const { record, signals } = out!;

    const cells = deriveCells(5.41535, 100.33205);
    expect(record.record_uuid).toBe(recordUuid('osm', 'node/11111'));
    expect(record.subject).toBe('poi');
    expect(record.category).toBe('restaurant');
    expect(record.name).toBe('Tek Sen Restaurant');
    expect(record.lat).toBe(5.41535);
    expect(record.lng).toBe(100.33205);
    expect(record.h3_r5).toBe(cells.h3_r5);
    expect(record.h3_r7).toBe(cells.h3_r7);
    expect(record.h3_r10).toBe(cells.h3_r10);
    expect(record.source).toBe('osm');
    expect(record.source_id).toBe('node/11111');
    expect(record.source_url).toBe('https://www.openstreetmap.org/node/11111');
    expect(record.lang).toBe('en');
    expect(record.content_hash).toBe(
      fnv1a('Tek Sen Restaurant' + 5.41535 + 100.33205 + 'osm' + 'node/11111'),
    );

    // attributes is a JSON STRING; address is an OBJECT inside it.
    const attrs = JSON.parse(record.attributes);
    expect(attrs.address).toEqual({
      housenumber: '18',
      street: 'Lebuh Carnarvon',
      city: 'George Town',
      postcode: '10100',
      country: 'MY',
    });
    expect(attrs.cuisine).toBe('chinese');
    expect(attrs.opening_hours).toBe('Th-Tu 11:30-14:30,17:30-20:30');

    // standalone → no chain signals
    expect(signals).toEqual({});

    // the three excluded fields are NOT present on record.
    expect('group_uuid' in record).toBe(false);
    expect('data_version' in record).toBe(false);
    expect('raw_r2_key' in record).toBe(false);
  });

  it('extracts brand + brand:wikidata signals for a chain outlet', () => {
    const out = osmElementToRecord(brandedCafe);
    expect(out).not.toBeNull();
    const { record, signals } = out!;
    expect(record.category).toBe('cafe');
    expect(signals).toEqual({ brand: 'Starbucks', brandWikidata: 'Q37158' });
    const attrs = JSON.parse(record.attributes);
    expect(attrs.address).toEqual({ street: 'Persiaran Gurney', city: 'George Town' });
  });

  it('reads coords from center for a way and category from tourism', () => {
    const out = osmElementToRecord(wayWithCenter);
    expect(out).not.toBeNull();
    const { record } = out!;
    expect(record.category).toBe('hotel');
    expect(record.lat).toBe(5.41999);
    expect(record.lng).toBe(100.34010);
    expect(record.source_id).toBe('way/33333');
    expect(record.source_url).toBe('https://www.openstreetmap.org/way/33333');
    const cells = deriveCells(5.41999, 100.34010);
    expect(record.h3_r7).toBe(cells.h3_r7);
  });

  it('derives category from shop when amenity and tourism are absent', () => {
    const out = osmElementToRecord(shopElement);
    expect(out).not.toBeNull();
    expect(out!.record.category).toBe('bakery');
    // empty address object when no addr:* tags
    expect(JSON.parse(out!.record.attributes).address).toEqual({});
  });

  it('returns null when the element has no usable name', () => {
    expect(osmElementToRecord(namelessElement)).toBeNull();
  });

  it('returns null when the element has no usable coords', () => {
    expect(osmElementToRecord(noCoordsElement)).toBeNull();
  });
});
