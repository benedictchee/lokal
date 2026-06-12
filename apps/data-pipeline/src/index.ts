import { IngestRegion } from './workflows/ingest-region.js';
import { enrichBatch } from './consumers/enrich.js';
import type { Env, IngestParams, EnrichMessage } from './env.js';

// Default region seeded for cron re-ingest; ad-hoc runs override via POST body.
const CRON_REGIONS: IngestParams[] = [
  { source: 'osm', region: 'penang', bbox: [100.0, 5.2, 100.6, 5.6], dataVersion: 0 },
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');

    if (request.method === 'POST' && url.pathname === '/ingest') {
      const body = (await request.json()) as Partial<IngestParams>;
      if (!body.region || !Array.isArray(body.bbox) || body.bbox.length !== 4) {
        return new Response('bad request: require {region, bbox:[4]}', { status: 400 });
      }
      const params: IngestParams = {
        source: body.source ?? 'osm',
        region: body.region,
        bbox: body.bbox as [number, number, number, number],
        dataVersion: body.dataVersion ?? Number(env.DATA_VERSION),
      };
      const instance = await env.INGEST.create({ params });
      return Response.json({ id: instance.id, params });
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
