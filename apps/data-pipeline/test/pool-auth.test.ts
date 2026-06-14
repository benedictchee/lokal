import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import migrationSql from '../migrations/0003_pool.sql?raw';
import { authenticateDevice } from '../src/pool/auth.js';
import { PoolDeviceStore } from '../src/pool/pool-d1.js';
import { sha256Hex } from '../src/pool/crypto.js';

beforeAll(async () => {
  for (const stmt of migrationSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.GROUPS.prepare(stmt).run();
  }
  const store = new PoolDeviceStore(env.GROUPS);
  await store.provision('dev-auth', await sha256Hex('good-token'), '2026-06-14T00:00:00Z');
});

function req(auth?: string): Request {
  const headers: Record<string, string> = {};
  if (auth !== undefined) headers['Authorization'] = auth;
  return new Request('http://localhost/pool/lease', { method: 'POST', headers });
}

describe('authenticateDevice', () => {
  it('returns the deviceId for a valid Bearer token', async () => {
    expect(await authenticateDevice(req('Bearer good-token'), env)).toBe('dev-auth');
  });
  it('returns null when the header is missing', async () => {
    expect(await authenticateDevice(req(undefined), env)).toBeNull();
  });
  it('returns null when the scheme is not Bearer', async () => {
    expect(await authenticateDevice(req('Token good-token'), env)).toBeNull();
  });
  it('returns null for an unknown token', async () => {
    expect(await authenticateDevice(req('Bearer nope'), env)).toBeNull();
  });
});
