import { describe, it, expect, vi } from 'vitest';
import { NonRetryableError } from 'cloudflare:workflows';
import { enrichBatch } from '../src/consumers/enrich.js';
import type { TravelRecord } from '@travel/pipeline-core';

function rec(overrides: Partial<TravelRecord> = {}): TravelRecord {
  return {
    record_uuid: 'rec-1',
    group_uuid: 'grp-1',
    subject: 'poi',
    category: 'restaurant',
    name: 'Joe Pizza',
    lat: 40.73,
    lng: -74.0,
    h3_r5: '8a2a1072b59ffff',
    h3_r7: '872a1072bffffff',
    h3_r10: '8a2a1072b597fff',
    attributes: JSON.stringify({ address: { street: 'Carmine St', city: 'New York' } }),
    source: 'osm',
    source_id: 'node/1',
    source_url: '',
    raw_r2_key: 'raw/osm/abc',
    lang: 'en',
    content_hash: 'deadbeef',
    data_version: 7,
    ...overrides,
  };
}

function blobBody(records: TravelRecord[], dataVersion = 7): string {
  return JSON.stringify({ data_version: dataVersion, records });
}

function makeEnv(blobs: Record<string, string>) {
  const getCalls: string[] = [];
  const upserts: any[] = [];
  const aiCalls: any[] = [];
  const env = {
    DATA: {
      get: vi.fn(async (key: string) => {
        getCalls.push(key);
        const body = blobs[key];
        if (body === undefined) return null;
        return { text: async () => body } as unknown as R2ObjectBody;
      }),
    },
    AI: {
      run: vi.fn(async (_model: string, input: { text: string[] }) => {
        aiCalls.push(input);
        // bge-m3 returns 1024-dim vectors; one per input text.
        return { data: input.text.map(() => new Array(1024).fill(0.01)) };
      }),
    },
    VECTORIZE: {
      upsert: vi.fn(async (vectors: any[]) => {
        upserts.push(vectors);
        return { mutationId: 'm-1' };
      }),
    },
  };
  return { env, getCalls, upserts, aiCalls };
}

describe('enrichBatch', () => {
  it('embeds + upserts with id=record_uuid and recordMetadata, fetching the blob by key', async () => {
    const r = rec();
    const { env, getCalls, upserts, aiCalls } = makeEnv({
      'groups/r7/872a1072bffffff': blobBody([r]),
    });

    await enrichBatch([{ record_uuid: 'rec-1', h3_r7: '872a1072bffffff', source: 'osm' }], env as any);

    // Fetched the ONE blob by deterministic key (never list()).
    expect(getCalls).toEqual(['groups/r7/872a1072bffffff']);
    // bge-m3 invoked with the composed text.
    expect(env.AI.run).toHaveBeenCalledWith('@cf/baai/bge-m3', expect.anything());
    expect(aiCalls[0].text[0]).toContain('Joe Pizza');
    // Exactly one upsert batch, one vector.
    expect(upserts).toHaveLength(1);
    const v = upserts[0][0];
    expect(v.id).toBe('rec-1');
    expect(v.values).toHaveLength(1024);
    expect(v.metadata).toEqual({
      subject: 'poi',
      category: 'restaurant',
      group_uuid: 'grp-1',
      h3_r5: '8a2a1072b59ffff',
      h3_r7: '872a1072bffffff',
      h3_r10: '8a2a1072b597fff',
    });
  });

  it('dedupes on record_uuid (duplicate messages -> one vector)', async () => {
    const r = rec();
    const { env, upserts, aiCalls } = makeEnv({
      'groups/r7/872a1072bffffff': blobBody([r]),
    });

    await enrichBatch(
      [
        { record_uuid: 'rec-1', h3_r7: '872a1072bffffff', source: 'osm' },
        { record_uuid: 'rec-1', h3_r7: '872a1072bffffff', source: 'osm' },
      ],
      env as any,
    );

    const allVectors = upserts.flat();
    expect(allVectors.map((v: any) => v.id)).toEqual(['rec-1']);
    expect(aiCalls[0].text).toHaveLength(1);
  });

  it('throws NonRetryableError when the blob is missing (-> DLQ)', async () => {
    const { env } = makeEnv({}); // no blob
    await expect(
      enrichBatch([{ record_uuid: 'rec-1', h3_r7: '872a1072bffffff', source: 'osm' }], env as any),
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect(env.VECTORIZE.upsert).not.toHaveBeenCalled();
  });

  it('throws NonRetryableError when the record_uuid is absent from the blob', async () => {
    const { env } = makeEnv({
      'groups/r7/872a1072bffffff': blobBody([rec({ record_uuid: 'other' })]),
    });
    await expect(
      enrichBatch([{ record_uuid: 'rec-1', h3_r7: '872a1072bffffff', source: 'osm' }], env as any),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });

  it('throws NonRetryableError when the blob body is unparseable', async () => {
    const { env } = makeEnv({ 'groups/r7/872a1072bffffff': 'not-json' });
    await expect(
      enrichBatch([{ record_uuid: 'rec-1', h3_r7: '872a1072bffffff', source: 'osm' }], env as any),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });

  it('throws a retryable error (not NonRetryableError) when AI returns wrong number of vectors', async () => {
    const r = rec();
    const { env } = makeEnv({ 'groups/r7/872a1072bffffff': blobBody([r]) });
    // Override AI to return 0 vectors instead of 1 — simulates transient AI failure.
    env.AI.run = vi.fn(async () => ({ data: [] }));
    await expect(
      enrichBatch([{ record_uuid: 'rec-1', h3_r7: '872a1072bffffff', source: 'osm' }], env as any),
    ).rejects.toThrow();
    await expect(
      enrichBatch([{ record_uuid: 'rec-1', h3_r7: '872a1072bffffff', source: 'osm' }], env as any),
    ).rejects.not.toBeInstanceOf(NonRetryableError);
  });
});
