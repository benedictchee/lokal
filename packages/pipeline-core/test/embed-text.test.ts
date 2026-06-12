import { describe, it, expect } from 'vitest';
import { composeEmbedText } from '../src/embed/embed-text.js';
import type { TravelRecord } from '../src/record.js';

function sample(overrides: Partial<TravelRecord> = {}): TravelRecord {
  return {
    record_uuid: 'r-1',
    group_uuid: 'g-1',
    subject: 'poi',
    category: 'restaurant',
    name: 'Joe Pizza',
    lat: 40.73,
    lng: -74.0,
    h3_r5: '8a2a1072b59ffff',
    h3_r7: '872a1072bffffff',
    h3_r10: '8a2a1072b597fff',
    attributes: JSON.stringify({
      address: { housenumber: '7', street: 'Carmine St', city: 'New York', postcode: '10014', country: 'US' },
      cuisine: 'pizza',
      opening_hours: 'Mo-Su 11:00-23:00',
    }),
    source: 'osm',
    source_id: 'node/123',
    source_url: '',
    raw_r2_key: 'raw/osm/abc',
    lang: 'en',
    content_hash: 'deadbeef',
    data_version: 7,
    ...overrides,
  };
}

describe('composeEmbedText', () => {
  it('includes name, category, and the formatted address (street, city)', () => {
    const text = composeEmbedText(sample());
    expect(text).toContain('Joe Pizza');
    expect(text).toContain('restaurant');
    expect(text).toContain('Carmine St, New York');
  });

  it('omits the address segment when attributes has no address object', () => {
    const text = composeEmbedText(sample({ attributes: JSON.stringify({ cuisine: 'pizza' }) }));
    expect(text).toContain('Joe Pizza');
    expect(text).toContain('restaurant');
    expect(text).not.toContain('undefined');
    expect(text.trim().endsWith(',')).toBe(false);
  });

  it('tolerates malformed attributes JSON without throwing', () => {
    const text = composeEmbedText(sample({ attributes: 'not-json' }));
    expect(text).toContain('Joe Pizza');
    expect(text).toContain('restaurant');
    expect(text).not.toContain('undefined');
  });

  it('formats address from street alone when city is absent', () => {
    const attrs = JSON.stringify({ address: { street: 'Carmine St' } });
    const text = composeEmbedText(sample({ attributes: attrs }));
    expect(text).toContain('Carmine St');
    expect(text).not.toContain('undefined');
  });
});
