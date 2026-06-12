import { describe, it, expect, beforeEach } from 'vitest';
import type { TravelRecord } from '../../src/record.js';
import { NdjsonR2LakeWriter } from '../../src/lake/ndjson-r2.js';

/** Minimal in-memory R2Bucket stub supporting the methods NdjsonR2LakeWriter uses. */
function makeR2Stub() {
  const store = new Map<string, ArrayBuffer>();

  const bucket: R2Bucket = {
    async put(key: string, value: ArrayBuffer | ArrayBufferView | string | ReadableStream) {
      let buf: ArrayBuffer;
      if (value instanceof ArrayBuffer) {
        buf = value;
      } else if (ArrayBuffer.isView(value)) {
        buf = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
      } else if (typeof value === 'string') {
        buf = new TextEncoder().encode(value).buffer as ArrayBuffer;
      } else {
        // ReadableStream
        buf = await new Response(value as ReadableStream).arrayBuffer();
      }
      store.set(key, buf);
      return {
        key,
        version: '1',
        size: buf.byteLength,
        etag: 'etag',
        httpEtag: '"etag"',
        checksums: { toJSON: () => ({}) },
        uploaded: new Date(),
        httpMetadata: {},
        customMetadata: {},
        range: undefined,
        storageClass: 'Standard',
        ssecKeyMd5: undefined,
        writeHttpMetadata: () => {},
      } as unknown as R2Object;
    },
    async get(key: string) {
      const buf = store.get(key);
      if (buf === undefined) return null;
      const readableStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(buf));
          controller.close();
        },
      });
      return {
        key,
        version: '1',
        size: buf.byteLength,
        etag: 'etag',
        httpEtag: '"etag"',
        checksums: { toJSON: () => ({}) },
        uploaded: new Date(),
        httpMetadata: {},
        customMetadata: {},
        range: undefined,
        storageClass: 'Standard',
        ssecKeyMd5: undefined,
        body: readableStream,
        bodyUsed: false,
        arrayBuffer: async () => buf,
        text: async () => new TextDecoder().decode(buf),
        json: async () => JSON.parse(new TextDecoder().decode(buf)),
        blob: async () => new Blob([buf]),
        writeHttpMetadata: () => {},
      } as unknown as R2ObjectBody;
    },
    async list(opts?: { prefix?: string }) {
      const prefix = opts?.prefix ?? '';
      const objects = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => ({
          key: k,
          version: '1',
          size: v.byteLength,
          etag: 'etag',
          httpEtag: '"etag"',
          checksums: { toJSON: () => ({}) },
          uploaded: new Date(),
          httpMetadata: {},
          customMetadata: {},
          storageClass: 'Standard',
          ssecKeyMd5: undefined,
          writeHttpMetadata: () => {},
        })) as unknown as R2Object[];
      return {
        objects,
        truncated: false,
        cursor: undefined,
        delimitedPrefixes: [],
      } as unknown as R2Objects;
    },
    async delete(keys: string | string[]) {},
    async head(key: string) { return null; },
    async createMultipartUpload(key: string) { throw new Error('not implemented'); },
    resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload { throw new Error('not implemented'); },
  };

  return { bucket, store };
}

async function readGzObject(bucket: R2Bucket, key: string): Promise<string> {
  const obj = await bucket.get(key);
  if (!obj) throw new Error(`no object at ${key}`);
  const decompressed = (obj as R2ObjectBody).body!.pipeThrough(new DecompressionStream('gzip'));
  return await new Response(decompressed).text();
}

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
    data_version: 5,
    ...over,
  };
}

describe('NdjsonR2LakeWriter', () => {
  it('writes ONE gz object at lake/<subject>/<region>/v<dataVersion>.ndjson.gz with N lines', async () => {
    const { bucket } = makeR2Stub();
    const writer = new NdjsonR2LakeWriter(bucket);
    const records = [
      rec({ record_uuid: 'a' }),
      rec({ record_uuid: 'b' }),
      rec({ record_uuid: 'c' }),
    ];

    await writer.append(records, { source: 'osm', region: 'georgetown', dataVersion: 5 });

    const key = 'lake/poi/georgetown/v5.ndjson.gz';
    const listed = await bucket.list({ prefix: 'lake/' });
    expect(listed.objects.map((o) => o.key)).toEqual([key]);

    const text = await readGzObject(bucket, key);
    const lines = text.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);
    const parsed = lines.map((l) => JSON.parse(l) as TravelRecord);
    expect(parsed.map((r) => r.record_uuid)).toEqual(['a', 'b', 'c']);
    // snake_case fields survive the NDJSON round-trip
    expect(parsed[0]!.content_hash).toBe('deadbeef');
    expect(parsed[0]!.group_uuid).toBe('g-uuid');
  });

  it('derives the key from subject of the first record (poi)', async () => {
    const { bucket } = makeR2Stub();
    const writer = new NdjsonR2LakeWriter(bucket);
    await writer.append([rec({ record_uuid: 'x' })], {
      source: 'osm',
      region: 'penang',
      dataVersion: 12,
    });
    const obj = await bucket.get('lake/poi/penang/v12.ndjson.gz');
    expect(obj).not.toBeNull();
  });

  it('retry overwrites the SAME deterministic key (no duplicate object)', async () => {
    const { bucket } = makeR2Stub();
    const writer = new NdjsonR2LakeWriter(bucket);
    const opts = { source: 'osm', region: 'kl', dataVersion: 9 };

    await writer.append([rec({ record_uuid: 'a' }), rec({ record_uuid: 'b' })], opts);
    // simulate a Workflow-step retry with the same data_version
    await writer.append([rec({ record_uuid: 'a' }), rec({ record_uuid: 'b' })], opts);

    const listed = await bucket.list({ prefix: 'lake/poi/kl/' });
    expect(listed.objects).toHaveLength(1);
    expect(listed.objects[0]!.key).toBe('lake/poi/kl/v9.ndjson.gz');

    const lines = (await readGzObject(bucket, 'lake/poi/kl/v9.ndjson.gz'))
      .split('\n')
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
  });

  it('no-ops on empty input (writes nothing)', async () => {
    const { bucket } = makeR2Stub();
    const writer = new NdjsonR2LakeWriter(bucket);
    await writer.append([], { source: 'osm', region: 'empty', dataVersion: 1 });
    const listed = await bucket.list({ prefix: 'lake/poi/empty/' });
    expect(listed.objects).toHaveLength(0);
  });
});
