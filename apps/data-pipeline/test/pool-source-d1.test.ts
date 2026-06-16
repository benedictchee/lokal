import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import poolSql from '../migrations/0003_pool.sql?raw';
import sourceSql from '../migrations/0005_pool_source.sql?raw';
import { PoolUrlRegistryStore } from '../src/pool/pool-d1.js';

async function apply(sql: string) {
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await env.GROUPS.prepare(stmt).run();
}
beforeAll(async () => { await apply(poolSql); await apply(sourceSql); });

describe('pool_url_registry.source', () => {
  it('upsert sets source and get returns it', async () => {
    const reg = new PoolUrlRegistryStore(env.GROUPS);
    await reg.upsert({ url: 'https://tabelog.com/en/kanagawa/', host: 'tabelog.com', waitForSelector: 'a.list-rst__rst-name-target', dwellMs: 4000, tier: 'E', source: 'tabelog' });
    const row = await reg.get('https://tabelog.com/en/kanagawa/');
    expect(row?.source).toBe('tabelog');
  });
});
