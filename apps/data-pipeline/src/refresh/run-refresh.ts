import {
  pulledToNormalized,
  mergeIntoR7Blob,
  aliasFor,
  type TravelRecord,
  type ConnectorMapping,
} from '@travel/pipeline-core';
import type { SourceConnector } from '../../scripts/connectors/core/types.js';
import { D1GroupRegistry } from '../registry-d1.js';
import { SourceSnapshotStore, RecordStateStore, type ObservedRecord } from './refresh-d1.js';
import { classifyRecords } from './diff.js';
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

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Response(text).body!.pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

export async function runRefreshSource(
  env: RefreshEnv,
  connector: SourceConnector,
  mapping: ConnectorMapping,
  ctx: RefreshContext,
): Promise<RefreshSummary> {
  const snapshots = new SourceSnapshotStore(env.GROUPS);
  const recordState = new RecordStateStore(env.GROUPS);
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

  // (3) Per-record diff against stored hashes.
  const prevHashes = await recordState.hashesForSource(connector.id);
  const diff = classifyRecords(result.records, prevHashes);
  const toMaterialize = [...diff.created, ...diff.changed];

  // (4) Materialize changed records -> TravelRecord (+ entity resolution).
  const registry = new D1GroupRegistry(env.GROUPS);
  const changedRecords: TravelRecord[] = [];
  for (const pr of toMaterialize) {
    const norm = pulledToNormalized(connector.id, pr, mapping);
    if (norm === null) continue; // no coords / no name — cannot place on the map
    const alias = aliasFor(
      { subject: norm.record.subject, category: norm.record.category, name: norm.record.name, record_uuid: norm.record.record_uuid },
      norm.signals,
    );
    const group_uuid = await registry.resolve(alias.key, { subject: norm.record.subject, kind: alias.kind, canonical_name: alias.name });
    changedRecords.push({ ...norm.record, group_uuid, raw_r2_key: '', data_version: ctx.dataVersion });
  }

  // (5) Merge into per-r7 blobs (read-modify-write; unchanged records survive).
  const byR7 = new Map<string, TravelRecord[]>();
  for (const r of changedRecords) {
    const arr = byR7.get(r.h3_r7);
    if (arr) arr.push(r); else byR7.set(r.h3_r7, [r]);
  }
  for (const [h3_r7, recs] of byR7) {
    const key = `groups/r7/${h3_r7}`;
    const existing = await env.DATA.get(key);
    const body = mergeIntoR7Blob(existing ? await existing.text() : null, h3_r7, recs, ctx.dataVersion);
    await env.DATA.put(key, body, { httpMetadata: { contentType: 'application/json' } });
  }

  // (6) Append a replayable lake delta (gzipped NDJSON at a unique key).
  if (changedRecords.length > 0) {
    const subject = changedRecords[0]!.subject;
    const ndjson = changedRecords.map((r) => JSON.stringify(r)).join('\n') + '\n';
    await env.DATA.put(
      `lake/${subject}/${connector.id}/v${ctx.dataVersion}/delta-${ctx.runId}.ndjson.gz`,
      await gzip(ndjson),
      { httpMetadata: { contentEncoding: 'gzip', contentType: 'application/x-ndjson' } },
    );
  }

  // (7) Enqueue ONLY changed records onto the existing enrich queue.
  const messages = changedRecords.map((r) => ({ body: { record_uuid: r.record_uuid, h3_r7: r.h3_r7, source: connector.id } }));
  for (let i = 0; i < messages.length; i += 100) await env.ENRICH.sendBatch(messages.slice(i, i + 100));

  // (8) Persist record_state (all observed) + new snapshot.
  const observed: ObservedRecord[] = result.records.map((pr) => ({
    record_uuid: pr.record_uuid, source: connector.id, source_url: pr.source_url ?? '', content_hash: pr.content_hash,
  }));
  await recordState.upsertObserved(observed, ctx.nowIso);
  await snapshots.save({
    source: connector.id,
    fingerprint_method: result.sourceFingerprint.method,
    fingerprint_value: result.sourceFingerprint.value,
    cursor: result.cursor ?? null,
    since_ts: ctx.nowIso,
    last_run_at: ctx.nowIso,
    last_status: result.status,
  });

  return {
    source: connector.id, skipped: false,
    created: diff.created.length, changed: diff.changed.length, unchanged: diff.unchanged.length,
    enqueued: messages.length,
  };
}
