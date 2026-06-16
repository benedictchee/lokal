import { describe, it, expect } from 'vitest';
import { mergeIntoR7Blob, type TravelRecord } from '@travel/pipeline-core';

const rec = (uuid: string, name: string): TravelRecord => ({
  record_uuid: uuid, group_uuid: 'g', subject: 'poi', category: 'attraction', name,
  lat: 5, lng: 100, h3_r5: 'r5', h3_r7: 'R7', h3_r10: 'r10', attributes: '{}',
  source: 'wikidata', source_id: uuid, source_url: 'u', raw_r2_key: '', lang: 'en',
  content_hash: 'h-' + name, data_version: 2,
});

describe('mergeIntoR7Blob', () => {
  it('preserves unchanged, replaces changed, and adds new records', () => {
    const existing = JSON.stringify({ h3_r7: 'R7', data_version: 1, records: [rec('A', 'a'), rec('B', 'b')] });
    const body = mergeIntoR7Blob(existing, 'R7', [rec('B', 'b2'), rec('C', 'c')], 2);
    const parsed = JSON.parse(body) as { h3_r7: string; data_version: number; records: TravelRecord[] };
    expect(parsed.h3_r7).toBe('R7');
    expect(parsed.data_version).toBe(2);
    const byUuid = new Map(parsed.records.map((r) => [r.record_uuid, r.name]));
    expect(byUuid.get('A')).toBe('a');   // preserved
    expect(byUuid.get('B')).toBe('b2');  // replaced
    expect(byUuid.get('C')).toBe('c');   // added
    expect(parsed.records.length).toBe(3);
  });

  it('starts from empty when there is no existing blob', () => {
    const body = mergeIntoR7Blob(null, 'R7', [rec('A', 'a')], 2);
    const parsed = JSON.parse(body) as { records: TravelRecord[] };
    expect(parsed.records.length).toBe(1);
  });
});
