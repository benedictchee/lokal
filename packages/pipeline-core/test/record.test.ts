import { describe, it, expect } from 'vitest';
import { RecordSchema } from '@travel/proto-ts';
import {
  type TravelRecord,
  recordMetadata,
  toNdjsonLine,
  recordToProto,
  recordFromProto,
} from '../src/record.js';

// A fully-populated sample TravelRecord (all snake_case fields present).
const sample: TravelRecord = {
  record_uuid: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
  group_uuid: '018f2c1a-0000-7000-8000-000000000000',
  subject: 'poi',
  category: 'restaurant',
  name: 'Toh Yuen',
  lat: 5.4141,
  lng: 100.3288,
  h3_r5: '85650d33fffffff',
  h3_r7: '87650d33effffff',
  h3_r10: '8a650d33e74ffff',
  attributes: JSON.stringify({
    address: { housenumber: '1', street: 'Jalan Magazine', city: 'George Town', postcode: '10300', country: 'MY' },
    cuisine: 'chinese',
    opening_hours: 'Mo-Su 11:00-22:00',
  }),
  source: 'osm',
  source_id: 'node/123456789',
  source_url: 'https://www.openstreetmap.org/node/123456789',
  raw_r2_key: 'raw/osm/0a1b2c3d',
  lang: 'en',
  content_hash: '1a2b3c4d',
  data_version: 7,
};

describe('TravelRecord drift-guard', () => {
  it('every proto field.name (snake_case) is a key of TravelRecord', () => {
    const keys = new Set(Object.keys(sample));
    for (const field of RecordSchema.fields) {
      expect(keys.has(field.name)).toBe(true);
    }
  });

  it('every TravelRecord key is a proto field.name (no orphan TS fields)', () => {
    const protoNames = new Set(RecordSchema.fields.map((f) => f.name));
    for (const key of Object.keys(sample)) {
      expect(protoNames.has(key)).toBe(true);
    }
  });
});

describe('recordToProto / recordFromProto bridge', () => {
  it('round-trips deep-equal', () => {
    const proto = recordToProto(sample);
    const back = recordFromProto(proto);
    expect(back).toEqual(sample);
  });

  it('maps data_version (number) to proto dataVersion (bigint)', () => {
    const proto = recordToProto(sample);
    expect(proto.dataVersion).toBe(7n);
    expect(recordFromProto(proto).data_version).toBe(7);
  });

  it('camelCase proto accessors carry the snake_case values', () => {
    const proto = recordToProto(sample);
    expect(proto.recordUuid).toBe(sample.record_uuid);
    expect(proto.h3R7).toBe(sample.h3_r7);
    expect(proto.rawR2Key).toBe(sample.raw_r2_key);
  });
});

describe('recordMetadata', () => {
  it('returns exactly the 6 snake_case pointer keys', () => {
    const meta = recordMetadata(sample);
    expect(Object.keys(meta).sort()).toEqual(
      ['category', 'group_uuid', 'h3_r10', 'h3_r5', 'h3_r7', 'subject'].sort(),
    );
    expect(meta).toEqual({
      subject: 'poi',
      category: 'restaurant',
      group_uuid: '018f2c1a-0000-7000-8000-000000000000',
      h3_r5: '85650d33fffffff',
      h3_r7: '87650d33effffff',
      h3_r10: '8a650d33e74ffff',
    });
  });
});

describe('toNdjsonLine', () => {
  it('emits a single-line snake_case JSON string round-tripping the record', () => {
    const line = toNdjsonLine(sample);
    expect(line).not.toContain('\n');
    expect(line).toContain('"record_uuid"');
    expect(line).toContain('"h3_r7"');
    expect(line).toContain('"data_version":7');
    expect(JSON.parse(line)).toEqual(sample);
  });
});
