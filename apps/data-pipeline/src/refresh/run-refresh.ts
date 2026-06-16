import {
  type ConnectorMapping,
} from '@travel/pipeline-core';
import type { SourceConnector } from '../../scripts/connectors/core/types.js';
import { SourceSnapshotStore } from './refresh-d1.js';
import { ingestPulledRecords } from './ingest-records.js';
import type { EnrichMessage } from '../env.js';

/** Minimal env so tests can inject a fake ENRICH queue (miniflare has no queue binding). */
export interface RefreshEnv {
  DATA: R2Bucket;
  GROUPS: D1Database;
  // Return type is `unknown` (not `void`) so the real `Queue<EnrichMessage>`
  // binding — whose `sendBatch` resolves to a `QueueSendBatchResponse` — is
  // structurally assignable here, while test fakes resolving to `void` stay valid.
  ENRICH: { sendBatch(msgs: { body: EnrichMessage }[]): Promise<unknown> };
}

export interface RefreshContext {
  dataVersion: number;
  nowIso: string;
  runId: string;
  /** Per-connector timeout passed to deps; default 25s. */
  timeoutMs?: number;
}

export interface RefreshSummary {
  source: string;
  skipped: boolean;
  created: number;
  changed: number;
  unchanged: number;
  enqueued: number;
}

export async function runRefreshSource(
  env: RefreshEnv,
  connector: SourceConnector,
  mapping: ConnectorMapping,
  ctx: RefreshContext,
): Promise<RefreshSummary> {
  const snapshots = new SourceSnapshotStore(env.GROUPS);
  const prior = await snapshots.get(connector.id);

  // (1) Pull — feed prior since/fingerprint/cursor for incremental + skip.
  const result = await connector.pull(
    { sinceTimestamp: prior?.since_ts ?? undefined, lastSnapshotFingerprint: prior?.fingerprint_value ?? undefined, cursor: prior?.cursor ?? undefined },
    { fetch: globalThis.fetch, env: {}, log: () => {}, timeoutMs: ctx.timeoutMs ?? 25_000 },
  );

  // (2) Cheap source-level skip.
  if (result.unchangedSinceSnapshot) {
    await snapshots.markUnchanged(connector.id, ctx.nowIso);
    return { source: connector.id, skipped: true, created: 0, changed: 0, unchanged: result.recordCount, enqueued: 0 };
  }

  // (3-8a) Record-level ingest (shared with the device path).
  const summary = await ingestPulledRecords(env, connector.id, mapping, result.records, ctx);

  // (8b) Persist the source-level snapshot (API path owns this).
  await snapshots.save({
    source: connector.id,
    fingerprint_method: result.sourceFingerprint.method,
    fingerprint_value: result.sourceFingerprint.value,
    cursor: result.cursor ?? null,
    since_ts: ctx.nowIso,
    last_run_at: ctx.nowIso,
    last_status: result.status,
  });
  return summary;
}
