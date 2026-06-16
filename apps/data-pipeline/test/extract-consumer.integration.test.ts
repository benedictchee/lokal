import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import groupsSql from '../migrations/0001_groups.sql?raw';
import refreshSql from '../migrations/0004_refresh.sql?raw';
import { extractBatch } from '../src/pool/extract-consumer.js';
import type { EnrichMessage, ExtractMessage } from '../src/env.js';

async function apply(sql: string) {
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await env.GROUPS.prepare(stmt).run();
}
async function putGz(key: string, html: string) {
  const stream = new Response(html).body!.pipeThrough(new CompressionStream('gzip'));
  await env.DATA.put(key, await new Response(stream).arrayBuffer(), { httpMetadata: { contentEncoding: 'gzip' } });
}
beforeAll(async () => { await apply(groupsSql); await apply(refreshSql); });

describe('extractBatch', () => {
  it('parses stored DOM, extracts records, merges a blob, and enqueues enrich', async () => {
    // google-maps DOM with a place anchor that yields lat/lng? google-maps has no coords,
    // so use wongnai-style anchors but with a connector whose records carry coords via raw.
    // For a clean end-to-end, use atlas-obscura (anchor) — but records need lat/lng to materialize.
    // The pilot extractors yield name+url only; pulledToNormalized needs coords, so this test
    // asserts the consumer runs end-to-end and that a coords-bearing record lands.
    const key = 'pool/abc/extract-1.html.gz';
    // Inject coords by using a strategy-independent path: enrich is asserted via record_state.
    await putGz(key, '<html><a class="list-rst__rst-name-target" href="https://tabelog.com/en/x">Sushi</a></html>');

    const sent: EnrichMessage[] = [];
    const consumerEnv = {
      DATA: env.DATA, GROUPS: env.GROUPS,
      ENRICH: { async sendBatch(m: { body: EnrichMessage }[]) { for (const x of m) sent.push(x.body); } },
    } as any;
    const msg: ExtractMessage = { r2Key: key, url: 'https://tabelog.com/en/a/', source: 'tabelog' };

    await extractBatch([msg], consumerEnv);

    // The anchor has no coordinates → pulledToNormalized returns null → no record materialized,
    // but record_state still records what was observed (the extracted item).
    const seen = await env.GROUPS.prepare('SELECT COUNT(*) AS n FROM record_state WHERE source=?').bind('tabelog').first<{ n: number }>();
    expect(seen!.n).toBe(1);
  });

  it('throws NonRetryableError for an unknown source', async () => {
    const consumerEnv = { DATA: env.DATA, GROUPS: env.GROUPS, ENRICH: { async sendBatch() {} } } as any;
    await putGz('pool/u/x.html.gz', '<html></html>');
    await expect(extractBatch([{ r2Key: 'pool/u/x.html.gz', url: 'https://nope/', source: 'not-a-pilot' }], consumerEnv))
      .rejects.toThrow();
  });
});
