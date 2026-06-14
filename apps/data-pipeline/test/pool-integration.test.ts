import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import handler from '../src/index.js';
import type { Env } from '../src/env.js';
import migrationSql from '../migrations/0003_pool.sql?raw';
import { PoolDeviceStore } from '../src/pool/pool-d1.js';
import { sha256Hex } from '../src/pool/crypto.js';

beforeAll(async () => {
  for (const stmt of migrationSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.GROUPS.prepare(stmt).run();
  }
  await new PoolDeviceStore(env.GROUPS).provision('dev-int', await sha256Hex('int-token'), '2026-06-14T00:00:00Z');
});

describe('Worker fetch → pool routes', () => {
  it('routes POST /pool/lease through the top-level handler', async () => {
    const req = new Request('http://localhost/pool/lease', {
      method: 'POST',
      headers: { Authorization: 'Bearer int-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxUrls: 3 }),
    });
    const res = await handler.fetch(req, env as unknown as Env);
    expect(res.status).toBe(200);
    expect((await res.json()) as { jobs: unknown[] }).toHaveProperty('jobs');
  });

  it('still 404s unknown paths', async () => {
    const res = await handler.fetch(new Request('http://localhost/nope', { method: 'POST' }), env as unknown as Env);
    expect(res.status).toBe(404);
  });

  it('still serves /health', async () => {
    const res = await handler.fetch(new Request('http://localhost/health'), env as unknown as Env);
    expect(await res.text()).toBe('ok');
  });
});
