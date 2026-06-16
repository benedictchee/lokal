import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import groupsSql from '../migrations/0001_groups.sql?raw';
import refreshSql from '../migrations/0004_refresh.sql?raw';
import { mkRecord } from '../scripts/connectors/core/fingerprint.js';
import { ingestPulledRecords } from '../src/refresh/ingest-records.js';
import type { EnrichMessage } from '../src/env.js';

async function apply(sql: string) {
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await env.GROUPS.prepare(stmt).run();
}
beforeAll(async () => { await apply(groupsSql); await apply(refreshSql); });

const MAPPING = { subject: 'poi', category: 'attraction' };
const CTX = { dataVersion: 2, nowIso: '2026-06-16T00:00:00Z', runId: 'r1' };

describe('ingestPulledRecords', () => {
  it('materializes new records, merges a blob, enqueues enrich, and records state', async () => {
    const rec = mkRecord('dev-src', 'P1', { v: 1 }, { name: 'Place 1', lat: 5.42, lng: 100.27, source_url: 'http://x/P1' });
    const sent: EnrichMessage[] = [];
    const refreshEnv = { DATA: env.DATA, GROUPS: env.GROUPS, ENRICH: { async sendBatch(m: { body: EnrichMessage }[]) { for (const x of m) sent.push(x.body); } } };

    const summary = await ingestPulledRecords(refreshEnv, 'dev-src', MAPPING, [rec], CTX);
    expect(summary.created).toBe(1);
    expect(summary.enqueued).toBe(1);
    expect(sent[0]!.source).toBe('dev-src');

    const blob = await env.DATA.get(`groups/r7/${sent[0]!.h3_r7}`);
    expect(JSON.parse(await blob!.text()).records.some((r: any) => r.source_url === 'http://x/P1')).toBe(true);

    // No source_snapshot written by ingestPulledRecords (device path owns no snapshot).
    const snap = await env.GROUPS.prepare('SELECT * FROM source_snapshot WHERE source=?').bind('dev-src').first();
    expect(snap).toBeNull();
  });
});
