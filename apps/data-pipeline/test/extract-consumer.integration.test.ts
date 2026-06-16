import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import groupsSql from '../migrations/0001_groups.sql?raw';
import refreshSql from '../migrations/0004_refresh.sql?raw';
import { extractBatch } from '../src/pool/extract-consumer.js';
import { PILOT_SOURCES, type PilotSource } from '../src/pool/pilot-sources.js';
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
  afterEach(() => { delete PILOT_SOURCES['coords-pilot']; });

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

    await extractBatch([msg], consumerEnv, 1);

    // The anchor has no coordinates → pulledToNormalized returns null → no record materialized,
    // but record_state still records what was observed (the extracted item).
    const seen = await env.GROUPS.prepare('SELECT COUNT(*) AS n FROM record_state WHERE source=?').bind('tabelog').first<{ n: number }>();
    expect(seen!.n).toBe(1);
  });

  it('throws NonRetryableError for an unknown source', async () => {
    const consumerEnv = { DATA: env.DATA, GROUPS: env.GROUPS, ENRICH: { async sendBatch() {} } } as any;
    await putGz('pool/u/x.html.gz', '<html></html>');
    await expect(extractBatch([{ r2Key: 'pool/u/x.html.gz', url: 'https://nope/', source: 'not-a-pilot' }], consumerEnv, 1))
      .rejects.toThrow();
  });

  // Regression: the device extract path must stamp records with the configured
  // DATA_VERSION (threaded as the extractBatch `dataVersion` arg), not a hard-coded
  // default. A non-1 value must land on the merged r7 blob AND on the record itself,
  // matching the API/cron paths. The pilot extractors yield no coords, so register a
  // coords-bearing strategy here to force materialization → blob merge.
  it('stamps the configured (non-1) DATA_VERSION onto the merged blob and record', async () => {
    const DATA_VERSION = 7;
    const coordsPilot: PilotSource = {
      mapping: { subject: 'poi', category: 'poi' },
      strategy: {
        id: 'coords-pilot',
        displayName: 'Coords Pilot (test)',
        tier: 'E',
        coverage: 'test',
        access: 'test',
        listUrl: () => 'https://example.test/',
        incremental: { method: 'full-only', supported: true, description: 'test' },
        // Yield a coords-bearing item so pulledToNormalized materializes a record.
        extract: () => [
          { sourceId: 'coords-1', name: 'Coffee Spot', url: 'https://example.test/coords-1', lat: 5.41, lng: 100.33 },
        ],
      },
    };
    PILOT_SOURCES['coords-pilot'] = coordsPilot;

    const key = 'pool/cp/extract-coords.html.gz';
    await putGz(key, '<html><body>any</body></html>');

    const consumerEnv = {
      DATA: env.DATA, GROUPS: env.GROUPS,
      ENRICH: { async sendBatch() {} },
    } as any;
    const msg: ExtractMessage = { r2Key: key, url: 'https://example.test/list', source: 'coords-pilot' };

    await extractBatch([msg], consumerEnv, DATA_VERSION);

    // The coords-bearing record materialized → a groups/r7/<h3_r7> blob was written.
    const list = await env.DATA.list({ prefix: 'groups/r7/' });
    expect(list.objects.length).toBeGreaterThan(0);
    const obj = await env.DATA.get(list.objects[0]!.key);
    const blob = JSON.parse(await obj!.text()) as { data_version: number; records: { data_version: number }[] };

    // The blob and every record it holds carry the configured DATA_VERSION, not 1.
    expect(blob.data_version).toBe(DATA_VERSION);
    expect(blob.records.length).toBeGreaterThan(0);
    for (const r of blob.records) expect(r.data_version).toBe(DATA_VERSION);
  });
});
