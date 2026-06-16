import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import migrationSql from '../migrations/0003_pool.sql?raw';
import sourceSql from '../migrations/0005_pool_source.sql?raw';
import { PoolDeviceStore, PoolUrlRegistryStore, PoolLeaseStore } from '../src/pool/pool-d1.js';

// Apply the pool migrations once against the isolated-per-suite D1 (env.GROUPS),
// mirroring reviews-d1.test.ts's ?raw + split-on-';' application pattern.
beforeAll(async () => {
  for (const stmt of migrationSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.GROUPS.prepare(stmt).run();
  }
  for (const stmt of sourceSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.GROUPS.prepare(stmt).run();
  }
});

describe('0003_pool migration', () => {
  it('creates the three pool tables', async () => {
    const rows = await env.GROUPS
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pool_%' ORDER BY name")
      .all<{ name: string }>();
    expect(rows.results.map((r) => r.name)).toEqual(['pool_device', 'pool_lease', 'pool_url_registry']);
  });
});

describe('PoolDeviceStore', () => {
  it('provisions and looks up a device by token hash', async () => {
    const store = new PoolDeviceStore(env.GROUPS);
    await store.provision('dev-1', 'hash-1', '2026-06-14T00:00:00Z');
    expect((await store.findByTokenHash('hash-1'))?.device_id).toBe('dev-1');
    expect(await store.findByTokenHash('nope')).toBeNull();
  });
  it('does not return a disabled device', async () => {
    const store = new PoolDeviceStore(env.GROUPS);
    await store.provision('dev-2', 'hash-2', '2026-06-14T00:00:00Z');
    await env.GROUPS.prepare('UPDATE pool_device SET enabled=0 WHERE device_id=?').bind('dev-2').run();
    expect(await store.findByTokenHash('hash-2')).toBeNull();
  });
});

describe('PoolUrlRegistryStore.selectLeasable', () => {
  const now = '2026-06-14T12:00:00Z';
  it('returns enabled, due, non-backed-off URLs and skips others', async () => {
    const reg = new PoolUrlRegistryStore(env.GROUPS);
    await reg.upsert({ url: 'https://a.com/1', host: 'a.com', waitForSelector: '.x', dwellMs: 2000 });
    await reg.upsert({ url: 'https://b.com/1', host: 'b.com', waitForSelector: null, dwellMs: null });
    await env.GROUPS.prepare('UPDATE pool_url_registry SET enabled=0 WHERE url=?').bind('https://b.com/1').run();
    const got = await reg.selectLeasable(now, 5, new Set());
    expect(got.map((u) => u.url)).toEqual(['https://a.com/1']);
    expect(got[0]!.dwellMs).toBe(2000);
  });
  it('excludes URLs whose host is paced out', async () => {
    const reg = new PoolUrlRegistryStore(env.GROUPS);
    await reg.upsert({ url: 'https://c.com/1', host: 'c.com', waitForSelector: null, dwellMs: null });
    expect((await reg.selectLeasable(now, 5, new Set(['c.com']))).length).toBe(0);
  });
  it('respects the limit', async () => {
    const reg = new PoolUrlRegistryStore(env.GROUPS);
    await reg.upsert({ url: 'https://d.com/1', host: 'd.com', waitForSelector: null, dwellMs: null });
    await reg.upsert({ url: 'https://d.com/2', host: 'd.com', waitForSelector: null, dwellMs: null });
    expect((await reg.selectLeasable(now, 1, new Set())).length).toBe(1);
  });
});

describe('PoolUrlRegistryStore.markFetched / markChallenge', () => {
  const now = '2026-06-14T12:00:00Z';
  it('markFetched clears backoff and sets content_hash + next_due', async () => {
    const reg = new PoolUrlRegistryStore(env.GROUPS);
    await reg.upsert({ url: 'https://e.com/1', host: 'e.com', waitForSelector: null, dwellMs: null });
    await reg.markFetched('https://e.com/1', 'hash123', now, '2026-06-15T12:00:00Z');
    const row = await reg.get('https://e.com/1');
    expect(row?.content_hash).toBe('hash123');
    expect(row?.consecutive_challenges).toBe(0);
    expect(row?.next_due_at).toBe('2026-06-15T12:00:00Z');
  });
  it('markChallenge increments the counter and sets backoff_until', async () => {
    const reg = new PoolUrlRegistryStore(env.GROUPS);
    await reg.upsert({ url: 'https://f.com/1', host: 'f.com', waitForSelector: null, dwellMs: null });
    await reg.markChallenge('https://f.com/1', '2026-06-14T13:00:00Z');
    const row = await reg.get('https://f.com/1');
    expect(row?.consecutive_challenges).toBe(1);
    expect(row?.backoff_until).toBe('2026-06-14T13:00:00Z');
  });
});

describe('PoolLeaseStore', () => {
  const now = '2026-06-14T12:00:00Z';
  const later = '2026-06-14T12:10:00Z';
  it('creates leases, lists open hosts, and marks done', async () => {
    const ls = new PoolLeaseStore(env.GROUPS);
    await ls.create([{ lease_id: 'L1', url: 'https://g.com/1', host: 'g.com', device_id: 'dev-1' }], now, later);
    expect(await ls.openHosts(now)).toContain('g.com');
    const lease = await ls.getOpen('L1', now);
    expect(lease?.url).toBe('https://g.com/1');
    await ls.markDone('L1');
    expect(await ls.getOpen('L1', now)).toBeNull();
  });
  it('reclaimExpired flips stale open leases to expired', async () => {
    const ls = new PoolLeaseStore(env.GROUPS);
    await ls.create([{ lease_id: 'L2', url: 'https://h.com/1', host: 'h.com', device_id: 'dev-1' }], now, '2026-06-14T12:01:00Z');
    const reclaimed = await ls.reclaimExpired('2026-06-14T12:05:00Z');
    expect(reclaimed).toBeGreaterThanOrEqual(1);
    expect(await ls.getOpen('L2', '2026-06-14T12:05:00Z')).toBeNull();
  });
});
