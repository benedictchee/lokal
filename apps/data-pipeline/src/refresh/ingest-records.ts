import {
  pulledToNormalized,
  mergeIntoR7Blob,
  aliasFor,
  type TravelRecord,
  type ConnectorMapping,
} from '@travel/pipeline-core';
import type { PulledRecord } from '../../scripts/connectors/core/types.js';
import { D1GroupRegistry } from '../registry-d1.js';
import { RecordStateStore, type ObservedRecord } from './refresh-d1.js';
import { classifyRecords } from './diff.js';
import type { RefreshEnv, RefreshContext, RefreshSummary } from './run-refresh.js';

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Response(text).body!.pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

/**
 * Record-level ingest shared by the API path (runRefreshSource) and the device
 * path (extract consumer): diff vs record_state → materialize → merge groups/r7
 * → lake delta → enqueue ENRICH → upsert record_state. Does NOT touch
 * source_snapshot (the API caller owns that; the device path uses pool_url_registry).
 */
export async function ingestPulledRecords(
  env: RefreshEnv,
  source: string,
  mapping: ConnectorMapping,
  records: PulledRecord[],
  ctx: RefreshContext,
): Promise<RefreshSummary> {
  const recordState = new RecordStateStore(env.GROUPS);

  const prevHashes = await recordState.hashesForSource(source);
  const diff = classifyRecords(records, prevHashes);
  const toMaterialize = [...diff.created, ...diff.changed];

  const registry = new D1GroupRegistry(env.GROUPS);
  const changedRecords: TravelRecord[] = [];
  for (const pr of toMaterialize) {
    const norm = pulledToNormalized(source, pr, mapping);
    if (norm === null) continue;
    const alias = aliasFor(
      { subject: norm.record.subject, category: norm.record.category, name: norm.record.name, record_uuid: norm.record.record_uuid },
      norm.signals,
    );
    const group_uuid = await registry.resolve(alias.key, { subject: norm.record.subject, kind: alias.kind, canonical_name: alias.name });
    changedRecords.push({ ...norm.record, group_uuid, raw_r2_key: '', data_version: ctx.dataVersion });
  }

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

  if (changedRecords.length > 0) {
    const subject = changedRecords[0]!.subject;
    const ndjson = changedRecords.map((r) => JSON.stringify(r)).join('\n') + '\n';
    await env.DATA.put(
      `lake/${subject}/${source}/v${ctx.dataVersion}/delta-${ctx.runId}.ndjson.gz`,
      await gzip(ndjson),
      { httpMetadata: { contentEncoding: 'gzip', contentType: 'application/x-ndjson' } },
    );
  }

  const messages = changedRecords.map((r) => ({ body: { record_uuid: r.record_uuid, h3_r7: r.h3_r7, source } }));
  for (let i = 0; i < messages.length; i += 100) await env.ENRICH.sendBatch(messages.slice(i, i + 100));

  const observed: ObservedRecord[] = records.map((pr) => ({
    record_uuid: pr.record_uuid, source, source_url: pr.source_url ?? '', content_hash: pr.content_hash,
  }));
  await recordState.upsertObserved(observed, ctx.nowIso);

  return {
    source, skipped: false,
    created: diff.created.length, changed: diff.changed.length, unchanged: diff.unchanged.length,
    enqueued: messages.length,
  };
}
