import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import migrationSql from '../migrations/0004_refresh.sql?raw';
import { SourceSnapshotStore, RecordStateStore } from '../src/refresh/refresh-d1.js';

beforeAll(async () => {
  for (const stmt of migrationSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.GROUPS.prepare(stmt).run();
  }
});

describe('0004_refresh migration', () => {
  it('creates source_snapshot and record_state', async () => {
    const rows = await env.GROUPS
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('source_snapshot','record_state') ORDER BY name")
      .all<{ name: string }>();
    expect(rows.results.map((r) => r.name)).toEqual(['record_state', 'source_snapshot']);
  });
});

describe('SourceSnapshotStore', () => {
  it('returns null for an unknown source, then round-trips a saved snapshot', async () => {
    const store = new SourceSnapshotStore(env.GROUPS);
    expect(await store.get('unknown')).toBeNull();
    await store.save({
      source: 'wikidata', fingerprint_method: 'etag', fingerprint_value: 'abc',
      cursor: null, since_ts: '2026-06-16T00:00:00Z', last_run_at: '2026-06-16T00:00:00Z', last_status: 'ok',
    });
    const got = await store.get('wikidata');
    expect(got?.fingerprint_value).toBe('abc');
    expect(got?.since_ts).toBe('2026-06-16T00:00:00Z');
  });

  it('markUnchanged updates run time and status without touching the fingerprint', async () => {
    const store = new SourceSnapshotStore(env.GROUPS);
    await store.save({
      source: 'dbpedia', fingerprint_method: 'count', fingerprint_value: 'v1',
      cursor: null, since_ts: null, last_run_at: '2026-06-16T00:00:00Z', last_status: 'ok',
    });
    await store.markUnchanged('dbpedia', '2026-06-17T00:00:00Z');
    const got = await store.get('dbpedia');
    expect(got?.fingerprint_value).toBe('v1');
    expect(got?.last_status).toBe('unchanged');
    expect(got?.last_run_at).toBe('2026-06-17T00:00:00Z');
  });
});

describe('RecordStateStore', () => {
  it('upsertObserved inserts new rows, then reports their hashes', async () => {
    const store = new RecordStateStore(env.GROUPS);
    await store.upsertObserved([
      { record_uuid: 'u1', source: 's', source_url: 'http://x/1', content_hash: 'h1' },
      { record_uuid: 'u2', source: 's', source_url: 'http://x/2', content_hash: 'h2' },
    ], '2026-06-16T00:00:00Z');
    const hashes = await store.hashesForSource('s');
    expect(hashes.get('u1')).toBe('h1');
    expect(hashes.get('u2')).toBe('h2');
    expect(hashes.size).toBe(2);
  });

  it('bumps last_changed_at only when the hash actually changes', async () => {
    const store = new RecordStateStore(env.GROUPS);
    await store.upsertObserved([{ record_uuid: 'c1', source: 's2', source_url: 'u', content_hash: 'h1' }], '2026-06-16T00:00:00Z');
    // Same hash -> last_changed_at stays, last_seen_at advances.
    await store.upsertObserved([{ record_uuid: 'c1', source: 's2', source_url: 'u', content_hash: 'h1' }], '2026-06-17T00:00:00Z');
    let row = await env.GROUPS.prepare('SELECT * FROM record_state WHERE record_uuid=?').bind('c1').first<any>();
    expect(row.last_changed_at).toBe('2026-06-16T00:00:00Z');
    expect(row.last_seen_at).toBe('2026-06-17T00:00:00Z');
    // Changed hash -> last_changed_at advances.
    await store.upsertObserved([{ record_uuid: 'c1', source: 's2', source_url: 'u', content_hash: 'h2' }], '2026-06-18T00:00:00Z');
    row = await env.GROUPS.prepare('SELECT * FROM record_state WHERE record_uuid=?').bind('c1').first<any>();
    expect(row.last_changed_at).toBe('2026-06-18T00:00:00Z');
    expect(row.content_hash).toBe('h2');
  });
});
