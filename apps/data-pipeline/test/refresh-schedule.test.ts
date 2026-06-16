import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import refreshSql from '../migrations/0004_refresh.sql?raw';
import { isDue, runDueRefreshes } from '../src/refresh/schedule.js';
import { SourceSnapshotStore, type SnapshotRow } from '../src/refresh/refresh-d1.js';
import type { RefreshSourceConfig } from '../src/refresh/sources.js';

beforeAll(async () => {
  for (const stmt of refreshSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.GROUPS.prepare(stmt).run();
  }
});

const NOW = '2026-06-16T12:00:00Z';
const snap = (last_run_at: string | null): SnapshotRow => ({
  source: 's', fingerprint_method: null, fingerprint_value: null, cursor: null,
  since_ts: null, last_run_at, last_status: 'ok',
});

describe('isDue', () => {
  it('is due when there is no snapshot', () => {
    expect(isDue(null, 24, NOW)).toBe(true);
  });
  it('is due when last_run_at is older than the cadence', () => {
    expect(isDue(snap('2026-06-15T00:00:00Z'), 24, NOW)).toBe(true); // 36h old, cadence 24h
  });
  it('is not due when last_run_at is within the cadence', () => {
    expect(isDue(snap('2026-06-16T06:00:00Z'), 24, NOW)).toBe(false); // 6h old
  });
});

describe('runDueRefreshes', () => {
  function fakeConnector(id: string): RefreshSourceConfig['connector'] {
    return {
      id, displayName: id, tier: 'A', coverage: '',
      plan: { access: '', incremental: '', fingerprint: '' },
      async pull() { return {} as never; },
    };
  }
  const sources: Record<string, RefreshSourceConfig> = {
    'src-fresh': { connector: fakeConnector('src-fresh'), mapping: { subject: 'poi', category: 'poi' }, cadenceHours: 24 },
    'src-due':   { connector: fakeConnector('src-due'),   mapping: { subject: 'poi', category: 'poi' }, cadenceHours: 24 },
  };

  it('runs only the due sources, sequentially', async () => {
    const snapshots = new SourceSnapshotStore(env.GROUPS);
    // src-fresh ran 1h ago (not due). src-due has no snapshot (due).
    await snapshots.save({ ...snap('2026-06-16T11:00:00Z'), source: 'src-fresh', fingerprint_value: 'x', since_ts: NOW });

    const ran: string[] = [];
    const stubRunner = (async (_env, connector) => {
      ran.push(connector.id);
      return { source: connector.id, skipped: false, created: 0, changed: 0, unchanged: 0, enqueued: 0 };
    }) as typeof import('../src/refresh/run-refresh.js').runRefreshSource;

    const results = await runDueRefreshes(
      { DATA: env.DATA, GROUPS: env.GROUPS, ENRICH: { async sendBatch() {} } },
      sources,
      { dataVersion: 1, nowIso: NOW },
      stubRunner,
    );

    expect(ran).toEqual(['src-due']);
    expect(results.find((r) => r.source === 'src-fresh')?.ran).toBe(false);
    expect(results.find((r) => r.source === 'src-due')?.ran).toBe(true);
  });
});
