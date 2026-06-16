import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import groupsSql from '../migrations/0001_groups.sql?raw';
import refreshSql from '../migrations/0004_refresh.sql?raw';
import { defineConnector } from '../scripts/connectors/core/connector.js';
import type { PulledRecord } from '../scripts/connectors/core/types.js';
import { mkRecord, sourceFp } from '../scripts/connectors/core/fingerprint.js';
import { runRefreshSource, type RefreshEnv } from '../src/refresh/run-refresh.js';
import type { EnrichMessage } from '../src/env.js';

async function apply(sql: string) {
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await env.GROUPS.prepare(stmt).run();
}
beforeAll(async () => {
  await apply(groupsSql);
  await apply(refreshSql);
});

// A deterministic fake connector whose records + fingerprint we control per run.
function fakeConnector(records: PulledRecord[], fingerprintValue: string) {
  return defineConnector({
    id: 'fake',
    displayName: 'Fake',
    tier: 'A',
    coverage: 'test',
    plan: { access: 'test', incremental: 'full-only', fingerprint: 'content-hash' },
    async run() {
      return {
        status: 'ok' as const,
        sourceFingerprint: { method: 'content-hash', value: fingerprintValue, capturedAt: '2026-06-16T00:00:00Z' },
        incremental: { method: 'full-only' as const, supported: true, description: 'test' },
        records,
      };
    },
  });
}

const MAPPING = { subject: 'poi', category: 'attraction' as const };
function captureEnrich() {
  const sent: EnrichMessage[] = [];
  const refreshEnv: RefreshEnv = {
    DATA: env.DATA,
    GROUPS: env.GROUPS,
    ENRICH: { async sendBatch(msgs) { for (const m of msgs) sent.push(m.body); } },
  };
  return { sent, refreshEnv };
}
const CTX = { dataVersion: 2, nowIso: '2026-06-16T00:00:00Z', runId: 'run-1' };

describe('runRefreshSource', () => {
  it('first run: all records are new, blob written, enrich enqueued, snapshot saved', async () => {
    const rec = mkRecord('fake', 'P1', { v: 1 }, { name: 'Place 1', lat: 5.42, lng: 100.27, source_url: 'http://x/P1' });
    const { sent, refreshEnv } = captureEnrich();
    const summary = await runRefreshSource(refreshEnv, fakeConnector([rec], 'fp-1'), MAPPING, CTX);

    expect(summary.skipped).toBe(false);
    expect(summary.created).toBe(1);
    expect(summary.enqueued).toBe(1);
    expect(sent[0]!.source).toBe('fake');

    // Blob exists and contains the record.
    const h3_r7 = sent[0]!.h3_r7;
    const blob = await refreshEnv.DATA.get(`groups/r7/${h3_r7}`);
    expect(blob).not.toBeNull();
    const parsed = JSON.parse(await blob!.text());
    expect(parsed.records.some((r: any) => r.source_url === 'http://x/P1')).toBe(true);
  });

  it('second run, unchanged fingerprint: skips entirely (no enqueue)', async () => {
    const rec = mkRecord('fake', 'P1', { v: 1 }, { name: 'Place 1', lat: 5.42, lng: 100.27, source_url: 'http://x/P1' });
    // Prime snapshot with the same fingerprint the connector will report.
    const { refreshEnv } = captureEnrich();
    await runRefreshSource(refreshEnv, fakeConnector([rec], 'fp-stable'), MAPPING, { ...CTX, runId: 'prime' });

    const { sent, refreshEnv: env2 } = captureEnrich();
    const summary = await runRefreshSource(env2, fakeConnector([rec], 'fp-stable'), MAPPING, { ...CTX, runId: 'run-2' });
    expect(summary.skipped).toBe(true);
    expect(summary.enqueued).toBe(0);
    expect(sent.length).toBe(0);
  });

  it('changed record: only the changed record is enqueued, blob preserves the unchanged one', async () => {
    const a1 = mkRecord('fake', 'A', { v: 1 }, { name: 'A', lat: 5.42, lng: 100.27, source_url: 'http://x/A' });
    const b1 = mkRecord('fake', 'B', { v: 1 }, { name: 'B', lat: 5.42, lng: 100.27, source_url: 'http://x/B' });
    const { refreshEnv } = captureEnrich();
    await runRefreshSource(refreshEnv, fakeConnector([a1, b1], 'fp-A'), MAPPING, { ...CTX, runId: 'r1' });

    // B changes content (new hash), A stays; source fingerprint must move too or we'd skip.
    const b2 = mkRecord('fake', 'B', { v: 2 }, { name: 'B2', lat: 5.42, lng: 100.27, source_url: 'http://x/B' });
    const { sent, refreshEnv: env2 } = captureEnrich();
    const summary = await runRefreshSource(env2, fakeConnector([a1, b2], 'fp-B'), MAPPING, { ...CTX, runId: 'r2' });

    expect(summary.changed).toBe(1);
    expect(summary.created).toBe(0);
    expect(summary.enqueued).toBe(1);
    expect(sent.map((m) => m.record_uuid)).toEqual([b2.record_uuid]);

    const blob = await env2.DATA.get(`groups/r7/${sent[0]!.h3_r7}`);
    const parsed = JSON.parse(await blob!.text());
    const names = parsed.records.map((r: any) => r.name).sort();
    expect(names).toEqual(['A', 'B2']); // A preserved, B replaced
  });
});
