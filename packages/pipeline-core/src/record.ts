import { create } from '@bufbuild/protobuf';
import { type Record, RecordSchema } from '@travel/proto-ts';

/**
 * The canonical pipeline working type. Plain snake_case TS interface — this is
 * the SINGLE definition of a travel record used by all in-memory/storage
 * processing. It deliberately does NOT use the protobuf-es generated class
 * (which exposes camelCase accessors and `dataVersion: bigint`). The proto
 * `Record` message is the wire/schema source-of-truth; this interface is the
 * pipeline's view of it, bridged via recordToProto/recordFromProto.
 */
export interface TravelRecord {
  record_uuid: string;
  group_uuid: string;
  subject: string;
  category: string;
  name: string;
  lat: number;
  lng: number;
  h3_r5: string;
  h3_r7: string;
  h3_r10: string;
  attributes: string; // JSON string
  source: string;
  source_id: string;
  source_url: string;
  raw_r2_key: string;
  lang: string;
  content_hash: string;
  data_version: number;
}

/**
 * Vectorize metadata: fetch pointers only, never payload. The 6 string fields
 * indexed before any upsert (subject, category, group_uuid, h3_r5, h3_r7,
 * h3_r10). All snake_case to match the Vectorize index names.
 */
export function recordMetadata(r: TravelRecord): {
  subject: string;
  category: string;
  group_uuid: string;
  h3_r5: string;
  h3_r7: string;
  h3_r10: string;
} {
  return {
    subject: r.subject,
    category: r.category,
    group_uuid: r.group_uuid,
    h3_r5: r.h3_r5,
    h3_r7: r.h3_r7,
    h3_r10: r.h3_r10,
  };
}

/** One NDJSON line for the R2 lake tier. Already snake_case — just stringify. */
export function toNdjsonLine(r: TravelRecord): string {
  return JSON.stringify(r);
}

/**
 * Bridge to the proto wire type. Maps snake_case TS fields onto the
 * protobuf-es camelCase accessors; data_version (number) -> dataVersion (bigint).
 */
export function recordToProto(r: TravelRecord): Record {
  return create(RecordSchema, {
    recordUuid: r.record_uuid,
    groupUuid: r.group_uuid,
    subject: r.subject,
    category: r.category,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    h3R5: r.h3_r5,
    h3R7: r.h3_r7,
    h3R10: r.h3_r10,
    attributes: r.attributes,
    source: r.source,
    sourceId: r.source_id,
    sourceUrl: r.source_url,
    rawR2Key: r.raw_r2_key,
    lang: r.lang,
    contentHash: r.content_hash,
    dataVersion: BigInt(r.data_version),
  });
}

/** Reverse bridge: proto wire type -> snake_case TravelRecord. */
export function recordFromProto(m: Record): TravelRecord {
  return {
    record_uuid: m.recordUuid,
    group_uuid: m.groupUuid,
    subject: m.subject,
    category: m.category,
    name: m.name,
    lat: m.lat,
    lng: m.lng,
    h3_r5: m.h3R5,
    h3_r7: m.h3R7,
    h3_r10: m.h3R10,
    attributes: m.attributes,
    source: m.source,
    source_id: m.sourceId,
    source_url: m.sourceUrl,
    raw_r2_key: m.rawR2Key,
    lang: m.lang,
    content_hash: m.contentHash,
    data_version: Number(m.dataVersion),
  };
}
