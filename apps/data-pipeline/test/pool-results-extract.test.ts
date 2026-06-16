import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import poolSql from '../migrations/0003_pool.sql?raw';
import sourceSql from '../migrations/0005_pool_source.sql?raw';
import { handleResults } from '../src/pool/handlers.js';
import { PoolDeviceStore, PoolUrlRegistryStore, PoolLeaseStore } from '../src/pool/pool-d1.js';
import { sha256Hex } from '../src/pool/crypto.js';

async function apply(sql: string) {
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await env.GROUPS.prepare(stmt).run();
}
async function gz(s: string): Promise<string> {
  const stream = new Response(s).body!.pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = ''; for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin);
}
beforeAll(async () => { await apply(poolSql); await apply(sourceSql); });

function poolEnv(extractSent: any[]) {
  return { GROUPS: env.GROUPS, DATA: env.DATA, EXTRACT: { async send(m: any) { extractSent.push(m); } } } as any;
}
function futureIso(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
async function seed(url: string, host: string, source: string, deviceToken: string) {
  await new PoolDeviceStore(env.GROUPS).provision('dev-1', await sha256Hex(deviceToken), '2026-06-16T00:00:00Z');
  await new PoolUrlRegistryStore(env.GROUPS).upsert({ url, host, waitForSelector: null, dwellMs: null, source });
  const leaseId = 'L-' + host;
  await new PoolLeaseStore(env.GROUPS).create([{ lease_id: leaseId, url, host, device_id: 'dev-1' }], '2026-06-16T00:00:00Z', futureIso(3600));
  return leaseId;
}
function resultReq(leaseId: string, domB64: string, token: string) {
  return new Request('https://x/pool/results', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ leaseId, status: 200, gzippedDomBase64: domB64 }),
  });
}

describe('POST /pool/results content-hash skip + extract enqueue', () => {
  it('enqueues extract on first (changed) DOM and skips on identical DOM', async () => {
    const token = 'tok-1';
    const url = 'https://tabelog.com/en/a/';
    const leaseId = await seed(url, 'tabelog.com', 'tabelog', token);
    const dom = await gz('<html><a class="list-rst__rst-name-target" href="/en/x">X</a></html>');

    const sent1: any[] = [];
    const r1 = await handleResults(resultReq(leaseId, dom, token), poolEnv(sent1));
    expect(r1.status).toBe(200);
    expect(sent1.length).toBe(1);
    expect(sent1[0]).toMatchObject({ url, source: 'tabelog' });
    expect(typeof sent1[0].r2Key).toBe('string');

    // Re-lease the same url, upload identical DOM → content_hash matches → no enqueue.
    const leaseId2 = 'L2';
    await new PoolLeaseStore(env.GROUPS).create([{ lease_id: leaseId2, url, host: 'tabelog.com', device_id: 'dev-1' }], '2026-06-16T00:00:00Z', futureIso(7200));
    const sent2: any[] = [];
    const r2 = await handleResults(resultReq(leaseId2, dom, token), poolEnv(sent2));
    expect(r2.status).toBe(200);
    expect(sent2.length).toBe(0); // unchanged DOM → skipped
  });
});
