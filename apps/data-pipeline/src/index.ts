import { IngestRegion } from './workflows/ingest-region.js';
import { enrichBatch } from './consumers/enrich.js';
import type { Env, IngestParams, EnrichMessage } from './env.js';
import { routePool } from './pool/handlers.js';
import { runRefreshSource } from './refresh/run-refresh.js';
import { REFRESH_SOURCES } from './refresh/sources.js';

// Default region seeded for cron re-ingest; ad-hoc runs override via POST body.
// Convention: bbox = [south, west, north, east] (Overpass order).
// dataVersion is intentionally omitted — the scheduled handler always injects env.DATA_VERSION.
const CRON_REGIONS: Omit<IngestParams, 'dataVersion'>[] = [
  { source: 'osm', region: 'penang', bbox: [5.2, 100.2, 5.5, 100.5] },
];

/** Constant-time string comparison via SubtleCrypto to resist timing attacks. */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  if (a.length !== b.length) return false;
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');

    const poolRes = await routePool(request, url, env);
    if (poolRes) return poolRes;

    if (request.method === 'POST' && url.pathname === '/ingest') {
      // Fix 2: Authenticate — fail closed if token unset or header missing/wrong.
      const ingestToken = env.INGEST_TOKEN;
      if (!ingestToken) {
        return new Response('unauthorized', { status: 401 });
      }
      const authHeader = request.headers.get('Authorization') ?? '';
      const prefix = 'Bearer ';
      if (!authHeader.startsWith(prefix)) {
        return new Response('unauthorized', { status: 401 });
      }
      const provided = authHeader.slice(prefix.length);
      const ok = await timingSafeEqual(provided, ingestToken);
      if (!ok) {
        return new Response('unauthorized', { status: 401 });
      }

      const body = (await request.json()) as Partial<IngestParams>;

      // Fix 3: Validate bbox — must be array of 4 finite numbers in valid [s,w,n,e] ranges.
      const { bbox } = body;
      if (
        !Array.isArray(bbox) ||
        bbox.length !== 4 ||
        !bbox.every((n) => typeof n === 'number' && Number.isFinite(n))
      ) {
        return new Response('bad request: bbox must be [south, west, north, east] with 4 finite numbers', { status: 400 });
      }
      const [s, w, n, e] = bbox as [number, number, number, number];
      if (!(s >= -90 && n <= 90 && s < n && w >= -180 && e <= 180 && w < e)) {
        return new Response('bad request: bbox out of range or inverted (require s<n, w<e)', { status: 400 });
      }

      // Fix 4: Validate region + source names.
      const regionName = body.region ?? '';
      if (!/^[a-z0-9_-]{1,32}$/.test(regionName)) {
        return new Response('bad request: region must match /^[a-z0-9_-]{1,32}$/', { status: 400 });
      }
      const sourceName = body.source ?? 'osm';
      if (!/^[a-z0-9_-]{1,32}$/.test(sourceName)) {
        return new Response('bad request: source must match /^[a-z0-9_-]{1,32}$/', { status: 400 });
      }

      // Fix 4: Validate + clamp dataVersion.
      const dv = body.dataVersion ?? Number(env.DATA_VERSION);
      if (!Number.isInteger(dv) || dv < 0 || dv >= 1e9) {
        return new Response('bad request: dataVersion must be a non-negative integer < 1e9', { status: 400 });
      }

      const params: IngestParams = {
        source: sourceName,
        region: regionName,
        bbox: [s, w, n, e],
        dataVersion: dv,
      };
      const instance = await env.INGEST.create({ params });
      return Response.json({ id: instance.id, params }, { status: 202 });
    }

    if (request.method === 'POST' && url.pathname === '/refresh') {
      const ingestToken = env.INGEST_TOKEN;
      if (!ingestToken) return new Response('unauthorized', { status: 401 });
      const authHeader = request.headers.get('Authorization') ?? '';
      if (!authHeader.startsWith('Bearer ')) return new Response('unauthorized', { status: 401 });
      if (!(await timingSafeEqual(authHeader.slice('Bearer '.length), ingestToken))) {
        return new Response('unauthorized', { status: 401 });
      }

      const body = (await request.json().catch(() => ({}))) as { source?: string };
      const entry = body.source ? REFRESH_SOURCES[body.source] : undefined;
      if (!entry) return new Response('bad request: unknown source', { status: 400 });

      const summary = await runRefreshSource(
        { DATA: env.DATA, GROUPS: env.GROUPS, ENRICH: env.ENRICH },
        entry.connector,
        entry.mapping,
        { dataVersion: Number(env.DATA_VERSION), nowIso: new Date().toISOString(), runId: crypto.randomUUID() },
      );
      return Response.json(summary, { status: 200 });
    }

    return new Response('not found', { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const dataVersion = Number(env.DATA_VERSION);
    ctx.waitUntil(
      Promise.all(
        CRON_REGIONS.map((r) => env.INGEST.create({ params: { ...r, dataVersion } })),
      ).then(() => undefined),
    );
  },

  async queue(batch: MessageBatch<EnrichMessage>, env: Env): Promise<void> {
    // DLQ is triage-only: log the dead messages and ack them so they do NOT
    // re-run enrichBatch (which would just throw NonRetryableError again).
    if (batch.queue === 'travel-enrich-dlq') {
      for (const m of batch.messages) console.error('enrich DLQ', m.body);
      batch.ackAll();
      return;
    }
    await enrichBatch(batch.messages.map((m) => m.body), env);
  },
};

export { IngestRegion };
