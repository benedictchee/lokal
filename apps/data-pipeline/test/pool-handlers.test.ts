import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import migrationSql from '../migrations/0003_pool.sql?raw';
import { routePool } from '../src/pool/handlers.js';
import { PoolDeviceStore, PoolUrlRegistryStore } from '../src/pool/pool-d1.js';
import { sha256Hex } from '../src/pool/crypto.js';
import type { PoolEnv } from '../src/pool/auth.js';

const AUTH = 'Bearer dev-token';

beforeAll(async () => {
  for (const stmt of migrationSql.split(';').map((s) => s.trim()).filter(Boolean)) {
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
