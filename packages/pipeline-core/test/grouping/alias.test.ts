import { describe, it, expect } from 'vitest';
import { aliasFor, slugify } from '../../src/grouping/alias.js';

const rec = (over: Partial<{ subject: string; category: string; name: string; record_uuid: string }> = {}) => ({
  subject: 'poi',
  category: 'restaurant',
  name: 'Tek Sen Restaurant',
  record_uuid: '7652d8d8-903d-5c7c-9eab-f982ef6aec68',
  ...over,
});

describe('slugify', () => {
  it('lowercases, dashes non-alphanumerics, trims edge dashes', () => {
    expect(slugify('Old Town White Coffee!')).toBe('old-town-white-coffee');
    expect(slugify('  --Kopitiam--  ')).toBe('kopitiam');
  });
});

describe('aliasFor precedence', () => {
  it('1) brand:wikidata wins over every other signal', () => {
    const a = aliasFor(rec({ subject: 'transport', category: 'bus' }), {
      brand: 'McDonalds',
      brandWikidata: 'Q38076',
    });
    expect(a).toEqual({ key: 'brand:wikidata:Q38076', kind: 'chain', name: 'McDonalds' });
  });

  it('2) brand:slug when wikidata absent but brand present', () => {
    const a = aliasFor(rec({ subject: 'transport' }), { brand: 'Old Town White Coffee' });
    expect(a).toEqual({
      key: 'brand:slug:old-town-white-coffee',
      kind: 'chain',
      name: 'Old Town White Coffee',
    });
  });

  it('3) transport:<category> when no brand and subject is transport', () => {
    const a = aliasFor(rec({ subject: 'transport', category: 'bus', name: 'Komtar Bus Terminal' }), {});
    expect(a).toEqual({ key: 'transport:bus', kind: 'transport_category', name: 'bus' });
  });

  it('4) standalone:<record_uuid> as the fallback (reads rec.record_uuid snake_case)', () => {
    const a = aliasFor(rec(), {});
    expect(a).toEqual({
      key: 'standalone:7652d8d8-903d-5c7c-9eab-f982ef6aec68',
      kind: 'standalone',
      name: 'Tek Sen Restaurant',
    });
  });

  it('brand falls back to slug even if brand has odd casing/punctuation', () => {
    const a = aliasFor(rec(), { brand: "McDonald's" });
    expect(a.key).toBe('brand:slug:mcdonald-s');
    expect(a.kind).toBe('chain');
    expect(a.name).toBe("McDonald's");
  });
});
