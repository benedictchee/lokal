import type { OverpassElement } from '../../src/types.js';

// A non-branded standalone restaurant node (lat/lon directly on the element).
export const standaloneRestaurant: OverpassElement = {
  type: 'node',
  id: 11111,
  lat: 5.41535,
  lon: 100.33205,
  tags: {
    amenity: 'restaurant',
    name: 'Tek Sen Restaurant',
    cuisine: 'chinese',
    opening_hours: 'Th-Tu 11:30-14:30,17:30-20:30',
    'addr:housenumber': '18',
    'addr:street': 'Lebuh Carnarvon',
    'addr:city': 'George Town',
    'addr:postcode': '10100',
    'addr:country': 'MY',
  },
};

// A branded chain outlet (carries brand + brand:wikidata → chain signals).
export const brandedCafe: OverpassElement = {
  type: 'node',
  id: 22222,
  lat: 5.42101,
  lon: 100.33890,
  tags: {
    amenity: 'cafe',
    name: 'Starbucks Gurney',
    brand: 'Starbucks',
    'brand:wikidata': 'Q37158',
    'addr:street': 'Persiaran Gurney',
    'addr:city': 'George Town',
  },
};

// A 'way' POI: no lat/lon on the element, coords come from `center` (Overpass `out center`).
export const wayWithCenter: OverpassElement = {
  type: 'way',
  id: 33333,
  center: { lat: 5.41999, lon: 100.34010 },
  tags: {
    tourism: 'hotel',
    name: 'Eastern & Oriental Hotel',
    'addr:street': 'Lebuh Farquhar',
    'addr:city': 'George Town',
  },
};

// A shop POI — category must fall through amenity(none) → shop.
export const shopElement: OverpassElement = {
  type: 'node',
  id: 44444,
  lat: 5.41600,
  lon: 100.33300,
  tags: {
    shop: 'bakery',
    name: 'Sunshine Bakery',
  },
};

// No usable name → normalizer returns null.
export const namelessElement: OverpassElement = {
  type: 'node',
  id: 55555,
  lat: 5.41700,
  lon: 100.33400,
  tags: {
    amenity: 'bench',
  },
};

// No usable coords (way without center, no lat/lon) → normalizer returns null.
export const noCoordsElement: OverpassElement = {
  type: 'way',
  id: 66666,
  tags: {
    amenity: 'restaurant',
    name: 'Ghost Kitchen',
  },
};
