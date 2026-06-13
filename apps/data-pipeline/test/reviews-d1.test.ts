import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { D1ReviewFingerprintStore, D1CriticalInfoStore } from '../src/reviews-d1.js';
import { EMPTY_CRITICAL_INFO } from '@travel/pipeline-core';
import migrationSql from '../migrations/0002_reviews.sql?raw';

// Apply the reviews migration once against the isolated-per-suite D1 (env.GROUPS),
// mirroring registry-d1.test.ts's ?raw + split-on-';' application pattern.
beforeAll(async () => {
  for (const stmt of migrationSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.GROUPS.prepare(stmt).run();
  }
});

describe('D1ReviewFingerprintStore.markSeen', () => {
  it('returns all fps as new on first insert, none on repeat', async () => {
    const store = new D1ReviewFingerprintStore(env.GROUPS);
    const fps = [{ fp: 'aaaa1111', firstSeen: 't' }, { fp: 'bbbb2222', firstSeen: 't' }];
    expect((await store.markSeen('placeX', fps)).size).toBe(2);
    expect((await store.markSeen('placeX', fps)).size).toBe(0);
  });
  it('scopes dedup per place', async () => {
    const store = new D1ReviewFingerprintStore(env.GROUPS);
    await store.markSeen('placeA', [{ fp: 'shared00', firstSeen: 't' }]);
    expect((await store.markSeen('placeB', [{ fp: 'shared00', firstSeen: 't' }])).size).toBe(1);
  });
  it('returns empty set for empty input', async () => {
    const store = new D1ReviewFingerprintStore(env.GROUPS);
    expect((await store.markSeen('placeZ', [])).size).toBe(0);
  });
});

describe('D1CriticalInfoStore', () => {
  it('round-trips put -> get and returns null for missing', async () => {
    const store = new D1CriticalInfoStore(env.GROUPS);
    await store.put({
      place_id: 'p1', record_uuid: 'r1',
      critical_json: JSON.stringify(EMPTY_CRITICAL_INFO),
      embed_text: 'Foo cafe', review_count: 3, updated_at: 't', last_processed_at: 't',
    });
    const got = await store.get('p1');
    expect(got?.record_uuid).toBe('r1');
    expect(got?.review_count).toBe(3);
    expect(await store.get('missing')).toBeNull();
  });
});
