import { describe, it, expect } from 'vitest';
import { validate as uuidValidate, version as uuidVersion, v5 as uuidv5 } from 'uuid';
import { recordUuid, NS_RECORD } from '../src/ids.js';

describe('recordUuid', () => {
  it('exports NS_RECORD as the pinned namespace UUID', () => {
    expect(NS_RECORD).toBe('1b671a64-40d5-491e-99b0-da01ff1f3341');
    expect(uuidValidate(NS_RECORD)).toBe(true);
  });

  it('is deterministic: same (source, sourceId) -> same uuid', () => {
    const a = recordUuid('osm', 'node/123');
    const b = recordUuid('osm', 'node/123');
    expect(a).toBe(b);
  });

  it('produces a valid UUIDv5', () => {
    const id = recordUuid('osm', 'way/456');
    expect(uuidValidate(id)).toBe(true);
    expect(uuidVersion(id)).toBe(5);
  });

  it('is distinct across different source / sourceId', () => {
    const osmNode = recordUuid('osm', 'node/123');
    const osmWay = recordUuid('osm', 'way/123');
    const gtfsNode = recordUuid('gtfs', 'node/123');
    const set = new Set([osmNode, osmWay, gtfsNode]);
    expect(set.size).toBe(3);
  });

  it('joins source and sourceId with a single colon (matches uuidv5 over "source:sourceId")', () => {
    expect(recordUuid('osm', 'node/123')).toBe(uuidv5('osm:node/123', NS_RECORD));
  });

  it('does not collapse a moved colon: ("a:b","c") !== ("a","b:c")', () => {
    expect(recordUuid('a:b', 'c')).not.toBe(recordUuid('a', 'b:c'));
  });
});
