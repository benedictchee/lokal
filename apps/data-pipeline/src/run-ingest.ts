import {
  putRaw,
  osmElementToRecord,
  aliasFor,
  NdjsonR2LakeWriter,
  buildGroupBlobs,
  type TravelRecord,
  type OverpassElement,
} from '@travel/pipeline-core';
import { D1GroupRegistry } from './registry-d1.js';
import type { Env, IngestParams, EnrichMessage } from './env.js';

// Single source of truth for the Overpass endpoint and user-agent.
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'travel-data-pipeline/1.0 (+management@rushowl.app)';

/** Build the Overpass-QL POI query for a given bbox.
 *  bbox convention: [south, west, north, east] */
export function buildOverpassQuery(bbox: [number, number, number, number]): string {
  const [south, west, north, east] = bbox;
  // Defence-in-depth — reject non-finite coordinates before building query.
  if (![south, west, north, east].every(Number.isFinite)) throw new Error('invalid bbox');
  const box = `(${south},${west},${north},${east})`;
  return [
    '[out:json][timeout:180];',
    '(',
    `  nwr["amenity"]${box};`,
    `  nwr["shop"]${box};`,
    `  nwr["tourism"]${box};`,
    ');',
    'out center;',
  ].join('\n');
}

export interface IngestSummary {
  rawKey: string;
  lakeKey: string;
  /** Number of group blobs written (not an unbounded keys array). */
  blobCount: number;
  recordCount: number;
}

/**
 * Deterministic normalize + ER. Re-reads the raw blob so each step can rebuild
 * identical records without passing big arrays through step return values.
 */
async function materializeRecords(
  env: Pick<Env, 'DATA' | 'GROUPS'>,
  rawKey: string,
  source: string,
  dataVersion: number,
): Promise<TravelRecord[]> {
  const rawObj = await env.DATA.get(rawKey);
  if (rawObj === null) throw new Error(`raw object missing at ${rawKey}`);
  const { elements } = JSON.parse(await rawObj.text()) as { elements: OverpassElement[] };

  const registry = new D1GroupRegistry(env.GROUPS);
  const out: TravelRecord[] = [];
  for (const el of elements) {
    const normalized = osmElementToRecord(el);
    if (normalized === null) continue;
    const { record, signals } = normalized;
    const alias = aliasFor(
      { subject: record.subject, category: record.category, name: record.name, record_uuid: record.record_uuid },
      signals,
    );
    const group_uuid = await registry.resolve(alias.key, {
      subject: record.subject,
      kind: alias.kind,
      canonical_name: alias.name,
    });
    out.push({ ...record, group_uuid, raw_r2_key: rawKey, data_version: dataVersion });
  }
  return out;
}

/**
 * Minimal step interface used by runIngest — compatible with both the real
 * WorkflowStep (passed from the WorkflowEntrypoint) and the lightweight test
 * stub (which passes callbacks without the WorkflowStepContext argument).
 */
export interface StepLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  do(name: string, a: any, b?: any): Promise<any>;
  sleep(name: string, duration: string | number): Promise<void>;
  sleepUntil(name: string, date: Date | number): Promise<void>;
}

/**
 * Core ingest logic extracted so tests and the CLI can call it directly without
 * needing a real WorkflowEntrypoint constructor (which requires a native
 * ExecutionContext and imports from cloudflare:workers).
 */
export async function runIngest(
  env: Pick<Env, 'DATA' | 'GROUPS' | 'ENRICH'>,
  event: { payload: IngestParams },
  step: StepLike,
): Promise<IngestSummary> {
  const { source, region, bbox, dataVersion } = event.payload;
  const stepCfg = { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' as const }, timeout: '5 minutes' };

  // (1) Fetch Overpass -> land raw payload in R2 BEFORE parsing (replayable).
  // Store the exact response text so re-plays are byte-identical.
  const rawKey = (await step.do('fetch-and-land-raw', stepCfg, async () => {
    const res = await globalThis.fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: `data=${encodeURIComponent(buildOverpassQuery(bbox))}`,
    });
    if (!res.ok) throw new Error(`Overpass request failed: ${res.status} ${res.statusText}`);
    const payload = await res.text();
    return putRaw(env.DATA, source, payload);
  })) as string;

  // (2) Normalize + entity-resolution -> group_uuid, data_version, raw_r2_key.
  // Wrapped in step.do so it is retry-checkpointed and replay-safe.
  // NOTE: returning the resolved records array is fine for v1's small counts,
  // but the ~1 MB step-return cap is a scale limit to revisit on the bulk path.
  const records = (await step.do('normalize-and-resolve', stepCfg, async () => {
    return materializeRecords(env, rawKey, source, dataVersion);
  })) as TravelRecord[];

  const recordCount = records.length;

  // (3) LakeWriter.append -> NDJSON->R2 at the DETERMINISTIC key.
  const lakeKey = (await step.do('lake-append', stepCfg, async () => {
    const writer = new NdjsonR2LakeWriter(env.DATA);
    await writer.append(records, { source, region, dataVersion });
    return `lake/${records[0]?.subject ?? 'poi'}/${region}/v${dataVersion}.ndjson.gz`;
  })) as string;

  // (4) Build r7 group blobs -> R2 (deterministic groups/r7/<h3_r7> keys; retries overwrite).
  // Return count (not unbounded keys array) to stay well within step-return cap.
  const blobCount = (await step.do('build-group-blobs', stepCfg, async () => {
    const blobs = buildGroupBlobs(records, dataVersion);
    await Promise.all(
      blobs.map((b) => env.DATA.put(b.key, b.body, { httpMetadata: { contentType: 'application/json' } })),
    );
    return blobs.length;
  })) as number;

  // (5) Enqueue one enrich message per record {record_uuid,h3_r7,source}.
  await step.do('enqueue-enrich', stepCfg, async () => {
    const messages: { body: EnrichMessage }[] = records.map((r) => ({
      body: { record_uuid: r.record_uuid, h3_r7: r.h3_r7, source },
    }));
    // sendBatch caps at 100/batch; chunk defensively.
    for (let i = 0; i < messages.length; i += 100) {
      await env.ENRICH.sendBatch(messages.slice(i, i + 100));
    }
    return messages.length;
  });

  return { rawKey, lakeKey, blobCount, recordCount };
}
