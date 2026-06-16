import type { PoolEnv } from './auth.js';
import { authenticateDevice } from './auth.js';
import { PoolUrlRegistryStore, PoolLeaseStore } from './pool-d1.js';
import { POOL } from './config.js';
import { fnv1a } from '@travel/pipeline-core';
import { gunzipToString, base64ToBytes } from './gzip.js';
import { sha256Hex } from './crypto.js';

export interface LeaseJob { leaseId: string; url: string; host: string; engine: 'webview'; waitForSelector: string | null; dwellMs: number; }
export interface LeaseReqBody { battery?: { pct?: number; charging?: boolean }; appForeground?: boolean; maxUrls?: number; }
export interface ResultReqBody {
  leaseId: string; status: number; finalUrl?: string; title?: string;
  challenge: string | null; gzippedDomBase64: string; timings?: { loadMs?: number; totalMs?: number };
}

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

/** POST /pool/results — store the rendered DOM, update registry state, close the lease. */
export async function handleResults(request: Request, env: PoolEnv): Promise<Response> {
  const deviceId = await authenticateDevice(request, env);
  if (!deviceId) return new Response('unauthorized', { status: 401 });

  let body: ResultReqBody;
  try {
    body = (await request.json()) as ResultReqBody;
  } catch {
    return new Response('bad request: invalid JSON', { status: 400 });
  }
  if (typeof body.leaseId !== 'string' || typeof body.gzippedDomBase64 !== 'string') {
    return new Response('bad request: leaseId and gzippedDomBase64 required', { status: 400 });
  }
  if (body.gzippedDomBase64.length > POOL.MAX_RESULT_B64_LEN) {
    return new Response('payload too large', { status: 413 });
  }

  const nowIso = new Date().toISOString();
  const leases = new PoolLeaseStore(env.GROUPS);
  const lease = await leases.getOpen(body.leaseId, nowIso);
  if (!lease) {
    const known = await env.GROUPS
      .prepare("SELECT state, device_id FROM pool_lease WHERE lease_id = ?")
      .bind(body.leaseId)
      .first<{ state: string; device_id: string }>();
    if (known && known.state === 'done' && known.device_id === deviceId) return json({ ok: true, duplicate: true });
    return new Response('not found: no open lease for id', { status: 404 });
  }
  if (lease.device_id !== deviceId) return new Response('forbidden: lease belongs to another device', { status: 403 });

  const reg = new PoolUrlRegistryStore(env.GROUPS);

  if (body.challenge) {
    const row = await reg.get(lease.url);
    const n = (row?.consecutive_challenges ?? 0) + 1;
    const backoffSec = Math.min(POOL.BACKOFF_BASE_SEC * 2 ** (n - 1), POOL.BACKOFF_MAX_SEC);
    await reg.markChallenge(lease.url, addSeconds(nowIso, backoffSec));
    await leases.markDone(body.leaseId);
    return json({ ok: true, challenge: body.challenge });
  }

  let bytes: Uint8Array;
  let dom: string;
  try {
    bytes = base64ToBytes(body.gzippedDomBase64);
    dom = await gunzipToString(bytes, POOL.MAX_DOM_BYTES);
  } catch (e) {
    const tooBig = e instanceof Error && e.message.includes('exceeds cap');
    return new Response(tooBig ? 'payload too large' : 'bad request: invalid gzip payload', { status: tooBig ? 413 : 400 });
  }
  const contentHash = fnv1a(dom);
  const prior = await reg.get(lease.url);
  const key = `pool/${(await sha256Hex(lease.url)).slice(0, 16)}/${Date.parse(nowIso)}-${body.leaseId}.html.gz`;
  await env.DATA.put(key, bytes, {
    httpMetadata: { contentType: 'text/html; charset=utf-8', contentEncoding: 'gzip' },
    customMetadata: { url: lease.url, deviceId, leaseId: body.leaseId, contentHash, fetchedAt: nowIso },
  });
  await reg.markFetched(lease.url, contentHash, nowIso, addSeconds(nowIso, POOL.REFRESH_INTERVAL_SEC));
  await leases.markDone(body.leaseId);
  // Content-hash skip: extract only when the DOM changed AND the URL is owned by a
  // pilot connector. Unchanged DOM (same content_hash) is parked in R2, not re-extracted.
  if (prior?.source && prior.content_hash !== contentHash) {
    await env.EXTRACT.send({ r2Key: key, url: lease.url, source: prior.source });
  }
  return json({ ok: true, contentHash, stored: key });
}

/** POST /pool/heartbeat — liveness; 200 if the device authenticates. */
export async function handleHeartbeat(request: Request, env: PoolEnv): Promise<Response> {
  const deviceId = await authenticateDevice(request, env);
  if (!deviceId) return new Response('unauthorized', { status: 401 });
  return json({ ok: true, deviceId });
}

/** Dispatch /pool/* routes. Returns null if the path is not a pool route. */
export async function routePool(request: Request, url: URL, env: PoolEnv): Promise<Response | null> {
  if (request.method === 'POST' && url.pathname === '/pool/lease') return handleLease(request, env);
  if (request.method === 'POST' && url.pathname === '/pool/results') return handleResults(request, env);
  if (request.method === 'POST' && url.pathname === '/pool/heartbeat') return handleHeartbeat(request, env);
  return null;
}
