import { describe, it, expect } from 'vitest';
import { putRaw } from '../../src/lake/raw.js';
import { fnv1a } from '../../src/hash.js';

/** Minimal in-memory R2Bucket stub — only the methods putRaw touches. */
function makeBucketStub() {
  const store = new Map<string, string>();
  const bucket = {
    async put(key: string, value: string) {
      store.set(key, value);
      return { key };
    },
    async get(key: string) {
      const v = store.get(key);
      return v === undefined ? null : { async text() { return v; } };
    },
  };
  return { bucket: bucket as unknown as R2Bucket, store };
}

describe('putRaw', () => {
  it('writes under the deterministic key raw/<source>/<fnv1a-hex> and returns it', async () => {
    const { bucket, store } = makeBucketStub();
    const payload = '{"elements":[{"type":"node","id":1}]}';

    const key = await putRaw(bucket, 'osm', payload);

    expect(key).toBe(`raw/osm/${fnv1a(payload)}`);
    expect(store.get(key)).toBe(payload);
  });

  it('is idempotent — same source + payload yields the same key (retry overwrites, never duplicates)', async () => {
    const { bucket, store } = makeBucketStub();
    const payload = 'identical-bytes';

    const k1 = await putRaw(bucket, 'osm', payload);
    const k2 = await putRaw(bucket, 'osm', payload);

    expect(k1).toBe(k2);
    expect(store.size).toBe(1);
  });

  it('namespaces by source', async () => {
    const { bucket } = makeBucketStub();
    const payload = 'shared-bytes';

    const a = await putRaw(bucket, 'osm', payload);
    const b = await putRaw(bucket, 'gtfs', payload);

    expect(a).toBe(`raw/osm/${fnv1a(payload)}`);
    expect(b).toBe(`raw/gtfs/${fnv1a(payload)}`);
    expect(a).not.toBe(b);
  });
});
