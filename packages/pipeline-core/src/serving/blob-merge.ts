import type { TravelRecord } from '../record.js';

interface GroupBlob {
  h3_r7: string;
  data_version: number;
  records: TravelRecord[];
}

/**
 * Read-modify-write merge of changed records into ONE r7 blob body. Upserts by
 * record_uuid: unchanged records survive, changed records are replaced, new
 * records are appended. Returns the new JSON body (same shape as buildGroupBlobs).
 * `existingBody` is the current blob text, or null if the blob does not exist yet.
 */
export function mergeIntoR7Blob(
  existingBody: string | null,
  h3_r7: string,
  changed: TravelRecord[],
  dataVersion: number,
): string {
  const prev: TravelRecord[] = existingBody ? ((JSON.parse(existingBody) as GroupBlob).records ?? []) : [];
  const byUuid = new Map<string, TravelRecord>();
  for (const r of prev) byUuid.set(r.record_uuid, r);
  for (const r of changed) byUuid.set(r.record_uuid, r); // upsert
  return JSON.stringify({ h3_r7, data_version: dataVersion, records: [...byUuid.values()] });
}
