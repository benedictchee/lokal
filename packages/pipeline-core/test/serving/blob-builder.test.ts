import { describe, it, expect } from 'vitest';
import type { TravelRecord } from '../../src/record.js';
import { bucketByR7, buildGroupBlobs } from '../../src/serving/blob-builder.js';

function rec(over: Partial<TravelRecord>): TravelRecord {
  return {
    record_uuid: 'r-uuid',
    group_uuid: 'g-uuid',
    subject: 'poi',
    category: 'restaurant',
    name: 'Somewhere',
    lat: 1.3,
    lng: 103.8,
    h3_r5: '8565a9bffffffff',
    h3_r7: '8765a9b40ffffff',
    h3_r10: '8a65a9b40007fff',
    attributes: '{}',
    source: 'osm',
    source_id: 'node/1',
    source_url: '',
    raw_r2_key: 'raw/osm/abc',
    lang: 'en',
    content_hash: 'deadbeef',
    data_version: 7,
    ...over,
  };
}

describe('bucketByR7', () => {
  it('groups records by their h3_r7 cell', () => {
    const a = rec({ record_uuid: 'a', h3_r7: 'cellA' });
    const b = rec({ record_uuid: 'b', h3_r7: 'cellA' });
    const c = rec({ record_uuid: 'c', h3_r7: 'cellB' });

    const buckets = bucketByR7([a, b, c]);

    expect(buckets.size).toBe(2);
    expect(buckets.get('cellA')!.map((r) => r.record_uuid)).toEqual(['a', 'b']);
    expect(buckets.get('cellB')!.map((r) => r.record_uuid)).toEqual(['c']);
  });

  it('returns an empty map for no records', () => {
    expect(bucketByR7([]).size).toBe(0);
  });
});

describe('buildGroupBlobs', () => {
  it('emits one blob per r7 cell at key groups/r7/<h3_r7>, stamped with data_version', () => {
    const a = rec({ record_uuid: 'a', h3_r7: 'cellA' });
    const b = rec({ record_uuid: 'b', h3_r7: 'cellA' });
    const c = rec({ record_uuid: 'c', h3_r7: 'cellB' });

    const blobs = buildGroupBlobs([a, b, c], 42);

    expect(blobs).toHaveLength(2);

    const byKey = new Map(blobs.map((bl) => [bl.key, bl]));
    expect([...byKey.keys()].sort()).toEqual(['groups/r7/cellA', 'groups/r7/cellB']);

    const blobA = JSON.parse(byKey.get('groups/r7/cellA')!.body);
    expect(blobA.h3_r7).toBe('cellA');
    expect(blobA.data_version).toBe(42);
    expect(blobA.records.map((r: TravelRecord) => r.record_uuid)).toEqual(['a', 'b']);
    // full snake_case record is preserved in the blob body
    expect(blobA.records[0].content_hash).toBe('deadbeef');
    expect(blobA.records[0].group_uuid).toBe('g-uuid');

    const blobB = JSON.parse(byKey.get('groups/r7/cellB')!.body);
    expect(blobB.data_version).toBe(42);
    expect(blobB.records).toHaveLength(1);
  });

  it('stamps the passed data_version, not the per-record one', () => {
    const a = rec({ record_uuid: 'a', h3_r7: 'cellA', data_version: 1 });
    const [blob] = buildGroupBlobs([a], 99);
    expect(JSON.parse(blob.body).data_version).toBe(99);
  });
});
