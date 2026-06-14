import type { PoolEnv } from './auth.js';
import { authenticateDevice } from './auth.js';
import { PoolUrlRegistryStore, PoolLeaseStore } from './pool-d1.js';
import { POOL } from './config.js';

export interface LeaseJob { leaseId: string; url: string; host: string; engine: 'webview'; waitForSelector: string | null; dwellMs: number; }
export interface LeaseReqBody { battery?: { pct?: number; charging?: boolean }; appForeground?: boolean; maxUrls?: number; }

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** POST /pool/lease — hand a device up to N due URLs, one per host (fleet pacing). */
export async function handleLease(request: Request, env: PoolEnv): Promise<Response> {
  const deviceId = await authenticateDevice(request, env);
  if (!deviceId) return new Response('unauthorized', { status: 401 });

  let body: LeaseReqBody;
  try {
    body = (await request.json()) as LeaseReqBody;
  } catch {
    return new Response('bad request: invalid JSON', { status: 400 });
  }

  const requested = Number.isInteger(body.maxUrls) ? (body.maxUrls as number) : POOL.DEFAULT_MAX_URLS;
  const limit = Math.max(0, Math.min(requested, POOL.MAX_URLS_CAP));
  if (limit === 0) return json({ jobs: [] });

  const nowIso = new Date().toISOString();
  const reg = new PoolUrlRegistryStore(env.GROUPS);
  const leases = new PoolLeaseStore(env.GROUPS);

  await leases.reclaimExpired(nowIso); // free dropped leases before selecting
  const pacedHosts = new Set(await leases.openHosts(nowIso)); // hosts already in flight fleet-wide
  const urls = await reg.selectLeasable(nowIso, limit, pacedHosts);
  if (urls.length === 0) return json({ jobs: [] });

  const expiresIso = addSeconds(nowIso, POOL.LEASE_TTL_SEC);
  const jobs: LeaseJob[] = urls.map((u) => ({
    leaseId: crypto.randomUUID(),
    url: u.url,
    host: u.host,
    engine: 'webview',
    waitForSelector: u.waitForSelector,
    dwellMs: u.dwellMs,
  }));
  await leases.create(
    jobs.map((j) => ({ lease_id: j.leaseId, url: j.url, host: j.host, device_id: deviceId })),
    nowIso,
    expiresIso,
  );
  return json({ jobs });
}

/** Dispatch /pool/* routes. Returns null if the path is not a pool route. */
export async function routePool(request: Request, url: URL, env: PoolEnv): Promise<Response | null> {
  if (request.method === 'POST' && url.pathname === '/pool/lease') return handleLease(request, env);
  return null;
}
