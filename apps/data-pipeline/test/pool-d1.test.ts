import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import migrationSql from '../migrations/0003_pool.sql?raw';

// Apply the pool migration once against the isolated-per-suite D1 (env.GROUPS),
// mirroring reviews-d1.test.ts's ?raw + split-on-';' application pattern.
beforeAll(async () => {
  for (const stmt of migrationSql.split(';').map((s) => s.trim()).filter(Boolean)) {
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
