import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import migrationSql from '../migrations/0003_pool.sql?raw';
import sourceSql from '../migrations/0005_pool_source.sql?raw';
import { routePool } from '../src/pool/handlers.js';
import { PoolDeviceStore, PoolUrlRegistryStore } from '../src/pool/pool-d1.js';
import { sha256Hex } from '../src/pool/crypto.js';
import type { PoolEnv } from '../src/pool/auth.js';

const AUTH = 'Bearer dev-token';

beforeAll(async () => {
  for (const stmt of migrationSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.GROUPS.prepare(stmt).run();
  }
  for (const stmt of sourceSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.GROUPS.prepare(stmt).run();
  }
  await new PoolDeviceStore(env.GROUPS).provision('dev-h', await sha256Hex('dev-token'), '2026-06-14T00:00:00Z');
  const reg = new PoolUrlRegistryStore(env.GROUPS);
  await reg.upsert({ url: 'https://lease-a.com/1', host: 'lease-a.com', waitForSelector: '.x', dwellMs: 1500 });
  await reg.upsert({ url: 'https://lease-b.com/1', host: 'lease-b.com', waitForSelector: null, dwellMs: null });
});

function leaseReq(auth: string | undefined, body: unknown): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth !== undefined) headers['Authorization'] = auth;
  return new Request('http://localhost/pool/lease', { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('POST /pool/lease', () => {
  it('401s without a valid token', async () => {
    const res = await routePool(leaseReq(undefined, {}), new URL('http://localhost/pool/lease'), env as PoolEnv);
    expect(res?.status).toBe(401);
  });

  it('returns jobs and creates leases, capped by maxUrls', async () => {
    const res = await routePool(
      leaseReq(AUTH, { battery: { pct: 90, charging: true }, maxUrls: 1 }),
      new URL('http://localhost/pool/lease'),
      env as PoolEnv,
    );
    expect(res?.status).toBe(200);
    const json = (await res!.json()) as { jobs: Array<{ leaseId: string; url: string; engine: string }> };
    expect(json.jobs.length).toBe(1);
    expect(json.jobs[0]!.engine).toBe('webview');
    expect(json.jobs[0]!.leaseId).toMatch(/.+/);
    const open = await env.GROUPS.prepare("SELECT COUNT(*) AS c FROM pool_lease WHERE state='open'").first<{ c: number }>();
    expect(open!.c).toBeGreaterThanOrEqual(1);
  });

  it('returns an empty job list when nothing is due', async () => {
    await routePool(leaseReq(AUTH, { maxUrls: 20 }), new URL('http://localhost/pool/lease'), env as PoolEnv);
    const res = await routePool(leaseReq(AUTH, { maxUrls: 20 }), new URL('http://localhost/pool/lease'), env as PoolEnv);
    const json = (await res!.json()) as { jobs: unknown[] };
    expect(json.jobs.length).toBe(0);
  });
});

describe('routePool dispatch', () => {
  it('returns null for non-pool paths', async () => {
    const res = await routePool(new Request('http://localhost/health'), new URL('http://localhost/health'), env as PoolEnv);
    expect(res).toBeNull();
  });
});

import { PoolLeaseStore } from '../src/pool/pool-d1.js';

async function gzipB64(s: string): Promise<string> {
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  void w.write(new TextEncoder().encode(s));
  void w.close();
  const bytes = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function resultsReq(auth: string | undefined, body: unknown): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth !== undefined) headers['Authorization'] = auth;
  return new Request('http://localhost/pool/results', { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('POST /pool/results', () => {
  it('stores DOM in R2, updates registry, and closes the lease (idempotently)', async () => {
    const reg = new PoolUrlRegistryStore(env.GROUPS);
    await reg.upsert({ url: 'https://res.com/1', host: 'res.com', waitForSelector: null, dwellMs: null });
    const ls = new PoolLeaseStore(env.GROUPS);
    const now = new Date().toISOString();
    await ls.create([{ lease_id: 'RES-L1', url: 'https://res.com/1', host: 'res.com', device_id: 'dev-h' }], now, addIso(now, 300));

    const body = {
      leaseId: 'RES-L1', status: 200, finalUrl: 'https://res.com/1', title: 'Res',
      challenge: null, gzippedDomBase64: await gzipB64('<html>data</html>'),
      timings: { loadMs: 100, totalMs: 200 },
    };
    const res = await routePool(resultsReq(AUTH, body), new URL('http://localhost/pool/results'), env as PoolEnv);
    expect(res?.status).toBe(200);

    const row = await reg.get('https://res.com/1');
    expect(row?.content_hash).toMatch(/.+/);
    expect(row?.last_fetched_at).toMatch(/.+/);
    expect(await ls.getOpen('RES-L1', new Date().toISOString())).toBeNull();

    const listed = await env.DATA.list({ prefix: 'pool/' });
    expect(listed.objects.length).toBeGreaterThanOrEqual(1);

    const res2 = await routePool(resultsReq(AUTH, body), new URL('http://localhost/pool/results'), env as PoolEnv);
    expect(res2?.status).toBe(200);
  });

  it('records a challenge as backoff, not success', async () => {
    const reg = new PoolUrlRegistryStore(env.GROUPS);
    await reg.upsert({ url: 'https://res.com/2', host: 'res.com', waitForSelector: null, dwellMs: null });
    const ls = new PoolLeaseStore(env.GROUPS);
    const now = new Date().toISOString();
    await ls.create([{ lease_id: 'RES-L2', url: 'https://res.com/2', host: 'res.com', device_id: 'dev-h' }], now, addIso(now, 300));

    const body = {
      leaseId: 'RES-L2', status: 403, challenge: 'DataDome challenge',
      gzippedDomBase64: await gzipB64('blocked'), timings: {},
    };
    const res = await routePool(resultsReq(AUTH, body), new URL('http://localhost/pool/results'), env as PoolEnv);
    expect(res?.status).toBe(200);
    const row = await reg.get('https://res.com/2');
    expect(row?.consecutive_challenges).toBe(1);
    expect(row?.backoff_until).toMatch(/.+/);
    expect(row?.content_hash).toBeNull();
  });

  it('401s without a valid token', async () => {
    const res = await routePool(resultsReq(undefined, { leaseId: 'x' }), new URL('http://localhost/pool/results'), env as PoolEnv);
    expect(res?.status).toBe(401);
  });

  it('404s for an unknown or already-closed lease id with a fresh body', async () => {
    const body = { leaseId: 'does-not-exist', status: 200, challenge: null, gzippedDomBase64: await gzipB64('x'), timings: {} };
    const res = await routePool(resultsReq(AUTH, body), new URL('http://localhost/pool/results'), env as PoolEnv);
    expect(res?.status).toBe(404);
  });

  it('413s when the base64 payload exceeds the size cap', async () => {
    // The size guard runs before lease lookup, so no lease is needed.
    const huge = 'A'.repeat(12_000_001);
    const body = { leaseId: 'whatever', status: 200, challenge: null, gzippedDomBase64: huge, timings: {} };
    const res = await routePool(resultsReq(AUTH, body), new URL('http://localhost/pool/results'), env as PoolEnv);
    expect(res?.status).toBe(413);
  });

  it('400s when the payload is not valid gzip', async () => {
    const reg = new PoolUrlRegistryStore(env.GROUPS);
    await reg.upsert({ url: 'https://res.com/3', host: 'res.com', waitForSelector: null, dwellMs: null });
    const ls = new PoolLeaseStore(env.GROUPS);
    const now = new Date().toISOString();
    await ls.create([{ lease_id: 'RES-L3', url: 'https://res.com/3', host: 'res.com', device_id: 'dev-h' }], now, addIso(now, 300));
    const body = { leaseId: 'RES-L3', status: 200, challenge: null, gzippedDomBase64: btoa('not gzip'), timings: {} };
    const res = await routePool(resultsReq(AUTH, body), new URL('http://localhost/pool/results'), env as PoolEnv);
    expect(res?.status).toBe(400);
  });
});

describe('POST /pool/heartbeat', () => {
  it('200s for an authenticated device', async () => {
    const req = new Request('http://localhost/pool/heartbeat', {
      method: 'POST', headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: '{}',
    });
    const res = await routePool(req, new URL('http://localhost/pool/heartbeat'), env as PoolEnv);
    expect(res?.status).toBe(200);
  });
});

/** Local ISO offset helper for the tests above. */
function addIso(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}
