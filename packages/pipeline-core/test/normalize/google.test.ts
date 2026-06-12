import { describe, it, expect } from 'vitest';
import { googlePlaceToRecord } from '../../src/normalize/google.js';
import type { GoogleRawPlace } from '../../src/normalize/google.js';
import { deriveCells } from '../../src/h3.js';
import { recordUuid } from '../../src/ids.js';
import { fnv1a } from '../../src/hash.js';

/** Golden fixture: a real-looking George Town restaurant with reviews. */
const goldenPlace: GoogleRawPlace = {
  place_id: 'ChIJt0YJo5bDSjAR5c3eAkhX-OM',
  ftid: '0x304ac396a30946b7:0xe3f8574802decde5',
  place_href:
    'https://www.google.com/maps/place/Auction+Rooms+Georgetown/@5.4157621,100.3318078,17z/data=!3d5.4157621!4d100.3318078',
  panel: {
    name: 'Auction Rooms Georgetown',
    category: 'Restaurant',
    rating: 4.8,
    review_count: 312,
  },
  reviews: [
    {
      author: 'Jane Doe',
      stars: 5,
      date: '2 months ago',
      text: 'Amazing food and great atmosphere. Highly recommend the breakfast!',
    },
    {
      author: 'Ahmad Ibrahim',
      stars: 4,
      date: '1 month ago',
      text: 'Good coffee and cozy interior.',
    },
  ],
  lat: 5.4157621,
  lng: 100.3318078,
  scraped_at: '2026-06-13T01:00:00.000Z',
};

describe('googlePlaceToRecord', () => {
  it('normalizes a golden George Town place into a snake_case TravelRecord (minus group/version/raw key)', () => {
    const out = googlePlaceToRecord(goldenPlace);
    expect(out).not.toBeNull();
    const { record, signals } = out!;

    const cells = deriveCells(5.4157621, 100.3318078);
    expect(record.record_uuid).toBe(recordUuid('google', 'ChIJt0YJo5bDSjAR5c3eAkhX-OM'));
    expect(record.subject).toBe('poi');
    expect(record.category).toBe('Restaurant');
    expect(record.name).toBe('Auction Rooms Georgetown');
    expect(record.lat).toBe(5.4157621);
    expect(record.lng).toBe(100.3318078);
    expect(record.h3_r5).toBe(cells.h3_r5);
    expect(record.h3_r7).toBe(cells.h3_r7);
    expect(record.h3_r10).toBe(cells.h3_r10);
    expect(record.source).toBe('google');
    expect(record.source_id).toBe('ChIJt0YJo5bDSjAR5c3eAkhX-OM');
    expect(record.source_url).toBe(
      'https://www.google.com/maps/place/?q=place_id:ChIJt0YJo5bDSjAR5c3eAkhX-OM',
    );
    expect(record.lang).toBe('en');
    expect(record.content_hash).toBe(
      fnv1a(
        'Auction Rooms Georgetown' +
          5.4157621 +
          100.3318078 +
          'google' +
          'ChIJt0YJo5bDSjAR5c3eAkhX-OM',
      ),
    );

    // attributes is a JSON string; reviews array must survive into it.
    const attrs = JSON.parse(record.attributes);
    expect(attrs.rating).toBe(4.8);
    expect(attrs.review_count).toBe(312);
    expect(attrs.ftid).toBe('0x304ac396a30946b7:0xe3f8574802decde5');
    expect(Array.isArray(attrs.reviews)).toBe(true);
    expect(attrs.reviews).toHaveLength(2);

    const firstReview = attrs.reviews[0];
    expect(firstReview.author).toBe('Jane Doe');
    expect(firstReview.stars).toBe(5);
    expect(firstReview.date).toBe('2 months ago');
    expect(firstReview.text).toBe(
      'Amazing food and great atmosphere. Highly recommend the breakfast!',
    );

    // standalone POI → no chain signals
    expect(signals).toEqual({});

    // The three excluded fields must NOT be present on record
    expect('group_uuid' in record).toBe(false);
    expect('data_version' in record).toBe(false);
    expect('raw_r2_key' in record).toBe(false);
  });

  it('preserves an empty reviews array in attributes', () => {
    const place: GoogleRawPlace = { ...goldenPlace, reviews: [] };
    const out = googlePlaceToRecord(place);
    expect(out).not.toBeNull();
    const attrs = JSON.parse(out!.record.attributes);
    expect(attrs.reviews).toEqual([]);
  });

  it('falls back to "place" when panel.category is empty string', () => {
    const place: GoogleRawPlace = {
      ...goldenPlace,
      panel: { ...goldenPlace.panel, category: '' },
    };
    const out = googlePlaceToRecord(place);
    expect(out).not.toBeNull();
    expect(out!.record.category).toBe('place');
  });

  it('returns null when place_id is missing', () => {
    const place: GoogleRawPlace = { ...goldenPlace, place_id: '' };
    expect(googlePlaceToRecord(place)).toBeNull();
  });

  it('returns null when lat is missing', () => {
    const place = { ...goldenPlace, lat: undefined } as unknown as GoogleRawPlace;
    expect(googlePlaceToRecord(place)).toBeNull();
  });

  it('returns null when lng is missing', () => {
    const place = { ...goldenPlace, lng: undefined } as unknown as GoogleRawPlace;
    expect(googlePlaceToRecord(place)).toBeNull();
  });

  it('returns null when coordinates are non-finite', () => {
    const place: GoogleRawPlace = { ...goldenPlace, lat: NaN, lng: 100.33 };
    expect(googlePlaceToRecord(place)).toBeNull();
  });
});
