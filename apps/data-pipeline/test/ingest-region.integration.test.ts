import { describe, it, expect, beforeAll, vi } from 'vitest';
import { env } from 'cloudflare:test';
import migrationSql from '../migrations/0001_groups.sql?raw';
import fixtureRaw from './fixtures/overpass-golden.json?raw';
import { IngestRegion } from '../src/workflows/ingest-region.js';
import { runIngest } from '../src/run-ingest.js';
import type { Env, IngestParams, EnrichMessage } from '../src/env.js';

const fixture = fixtureRaw;

// Deterministic in-test WorkflowStep: run callbacks inline, no retries/sleep.
function fakeStep() {
  return {
    do: async (_name: string, a: unknown, b?: unknown) => {
      const cb = (typeof a === 'function' ? a : b) as () => Promise<unknown>;
      return cb();
    },
    sleep: async () => {},
    sleepUntil: async () => {},
  };
}

// Capture ENRICH.send while delegating the rest of the bindings to real ones.
function captureEnv(sink: EnrichMessage[]): Pick<Env, 'DATA' | 'GROUPS' | 'ENRICH'> {
  return {
    DATA: (env as unknown as Env).DATA,
    GROUPS: (env as unknown as Env).GROUPS,
    ENRICH: {
      send: async (msg: EnrichMessage) => { sink.push(msg); },
      sendBatch: async (msgs: { body: EnrichMessage }[]) => {
        for (const m of msgs) sink.push(m.body);
      },
    } as unknown as Env['ENRICH'],
  };
}

async function gunzipToText(body: ReadableStream | ArrayBuffer): Promise<string> {
  const stream =
    body instanceof ArrayBuffer
      ? new Response(body).body!
      : (body as ReadableStream);
  const ds = new DecompressionStream('gzip');
  const out = stream.pipeThrough(ds);
  return new Response(out).text();
}

describe('IngestRegion integration smoke', () => {
  beforeAll(async () => {
    for (const stmt of migrationSql
      .split(';')
      .map((s) => s.trim())
      // Drop blank segments and pure-comment segments.
      .filter((s) => Boolean(s) && !/^(--[^\n]*(\n|$))+$/.test(s))) {
      await env.GROUPS.prepare(stmt).run();
    }
  });

  it('produces raw, lake, group blobs, and queue messages from the golden fixture', async () => {
    // Capture the fetch call so we can assert the Overpass query body.
    let capturedFetchBody: string | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedFetchBody = typeof init?.body === 'string' ? init.body : null;
        return new Response(fixture, { status: 200 });
      }),
    );

    const sent: EnrichMessage[] = [];
    const testEnv = captureEnv(sent);
    // Fix 1: bbox in [south, west, north, east] order; contains golden-fixture
    // coords at ~lat 5.41, lon 100.33.
    const params: IngestParams = {
      source: 'osm',
      region: 'penang',
      bbox: [5.40, 100.30, 5.43, 100.35],
      dataVersion: 7,
    };

    const summary = await runIngest(
      testEnv,
      { payload: params },
      fakeStep(),
    );

    // 2 usable records (bench element dropped: no name).
    expect(summary.recordCount).toBe(2);

    // (0) Assert the Overpass query body sent to fetch has the correctly-ordered bbox.
    // This regression-tests the bbox-order bug class.
    expect(capturedFetchBody).not.toBeNull();
    const decodedQuery = decodeURIComponent(capturedFetchBody!.replace(/^data=/, ''));
    // [south,west,north,east] = (5.4,100.3,5.43,100.35)
    expect(decodedQuery).toContain('(5.4,100.3,5.43,100.35)');

    // (1) raw object written under raw/osm/<hash> before parsing.
    const rawList = await env.DATA.list({ prefix: 'raw/osm/' });
    expect(rawList.objects.length).toBe(1);
    const rawObj0 = rawList.objects[0]!;
    expect(await (await env.DATA.get(rawObj0.key))!.text()).toBe(fixture);

    // (2) lake object at the DETERMINISTIC key (no wall-clock).
    const lakeKey = 'lake/poi/penang/v7.ndjson.gz';
    const lakeObj = await env.DATA.get(lakeKey);
    expect(lakeObj).not.toBeNull();
    const ndjson = await gunzipToText(await lakeObj!.arrayBuffer());
    const lines = ndjson.trim().split('\n');
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]!);
    // snake_case fields present; data_version stamped.
    expect(first.record_uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.data_version).toBe(7);
    expect(first.raw_r2_key.startsWith('raw/osm/')).toBe(true);

    // (3) groups/r7 blob — both records share one r7 parent -> one blob.
    const groupList = await env.DATA.list({ prefix: 'groups/r7/' });
    expect(groupList.objects.length).toBe(1);
    const grpObj0 = groupList.objects[0]!;
    const blob = JSON.parse(await (await env.DATA.get(grpObj0.key))!.text());
    expect(blob.data_version).toBe(7);
    expect(blob.records.length).toBe(2);
    expect(grpObj0.key).toBe(`groups/r7/${(blob.records[0] as { h3_r7: string }).h3_r7}`);

    // (4) one enrich message per record, shape {record_uuid,h3_r7,source}.
    expect(sent.length).toBe(2);
    for (const m of sent) {
      expect(typeof m.record_uuid).toBe('string');
      expect(typeof m.h3_r7).toBe('string');
      expect(m.source).toBe('osm');
    }
    // group_uuid minted + persisted in D1 registry (ER ran).
    const groups = await env.GROUPS.prepare('SELECT COUNT(*) AS n FROM groups').first<{ n: number }>();
    expect(groups!.n).toBeGreaterThanOrEqual(2);

    // Spec §11 — re-run proves no dupes: identical inputs overwrite deterministic keys.
    const summary2 = await runIngest(
      testEnv,
      { payload: params },
      fakeStep(),
    );
    expect(summary2.recordCount).toBe(2);
    expect((await env.DATA.list({ prefix: 'raw/osm/' })).objects.length).toBe(1);
    expect((await env.DATA.list({ prefix: 'lake/poi/penang/' })).objects.length).toBe(1);
    expect((await env.DATA.list({ prefix: 'groups/r7/' })).objects.length).toBe(1);
    const groups2 = await env.GROUPS.prepare('SELECT COUNT(*) AS n FROM groups').first<{ n: number }>();
    expect(groups2!.n).toBe(groups!.n); // ER idempotent — no new groups on re-scrape
  });
});

// Re-export to verify the class is exported from index.ts for wrangler binding.
export { IngestRegion };
