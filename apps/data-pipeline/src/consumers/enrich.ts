import { NonRetryableError } from 'cloudflare:workflows';
import { composeEmbedText, recordMetadata, type TravelRecord } from '@travel/pipeline-core';

export interface EnrichMessage {
  record_uuid: string;
  h3_r7: string;
  source: string;
}

export interface EnrichEnv {
  DATA: R2Bucket;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
}

const BGE_M3 = '@cf/baai/bge-m3';

interface GroupBlob {
  data_version: number;
  records: TravelRecord[];
}

/** groups/r7/<h3_r7> — the ONE deterministic blob key for a record's r7 parent. */
function blobKey(h3_r7: string): string {
  return `groups/r7/${h3_r7}`;
}

async function loadRecord(env: EnrichEnv, msg: EnrichMessage): Promise<TravelRecord> {
  const key = blobKey(msg.h3_r7);
  const obj = await env.DATA.get(key);
  if (obj === null) {
    throw new NonRetryableError(`enrich: blob missing at ${key} for record ${msg.record_uuid}`);
  }
  let blob: GroupBlob;
  try {
    blob = JSON.parse(await obj.text()) as GroupBlob;
  } catch (cause) {
    throw new NonRetryableError(`enrich: unparseable blob at ${key}: ${String(cause)}`);
  }
  const records = blob?.records;
  if (!Array.isArray(records)) {
    throw new NonRetryableError(`enrich: blob at ${key} has no records array`);
  }
  const rec = records.find((r) => r.record_uuid === msg.record_uuid);
  if (rec === undefined) {
    throw new NonRetryableError(`enrich: record ${msg.record_uuid} absent from blob ${key}`);
  }
  return rec;
}

/**
 * Enrich a batch of queue messages: fetch the ONE groups/r7/<h3_r7> blob by
 * key, pick the record by record_uuid, embed with bge-m3, and upsert into
 * Vectorize (id=record_uuid, metadata=recordMetadata). Idempotent: dedupes on
 * record_uuid. Unrecoverable input (missing/unparseable blob, absent record)
 * throws NonRetryableError so the message routes to the DLQ instead of looping.
 */
export async function enrichBatch(msgs: EnrichMessage[], env: EnrichEnv): Promise<void> {
  // Dedupe on record_uuid (retries / fan-in can deliver duplicates).
  const unique = new Map<string, EnrichMessage>();
  for (const m of msgs) {
    if (!unique.has(m.record_uuid)) unique.set(m.record_uuid, m);
  }
  if (unique.size === 0) return;

  const records = await Promise.all([...unique.values()].map((m) => loadRecord(env, m)));

  const texts = records.map(composeEmbedText);
  const embedding = (await env.AI.run(BGE_M3, { text: texts })) as { data: number[][] };
  const values = embedding?.data;
  if (!Array.isArray(values) || values.length !== records.length) {
    throw new Error(
      `enrich: bge-m3 returned ${values?.length ?? 0} vectors for ${records.length} records`,
    );
  }

  const vectors = records.map((rec, i) => {
    // values.length === records.length is asserted above; the undefined branch
    // is unreachable but noUncheckedIndexedAccess requires an explicit guard.
    const vec = values[i];
    if (vec === undefined) {
      throw new Error(`enrich: bge-m3 missing vector at index ${i}`);
    }
    return {
      id: rec.record_uuid,
      values: vec,
      metadata: recordMetadata(rec),
    };
  });

  await env.VECTORIZE.upsert(vectors);
}
