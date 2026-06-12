import type { TravelRecord } from '../record.js';

/**
 * Bucket records by their r7 H3 cell (the blob/zone level).
 * Preserves input order within each bucket so blob bodies are deterministic.
 */
export function bucketByR7(records: TravelRecord[]): Map<string, TravelRecord[]> {
  const buckets = new Map<string, TravelRecord[]>();
  for (const rec of records) {
    const existing = buckets.get(rec.h3_r7);
    if (existing) {
      existing.push(rec);
    } else {
      buckets.set(rec.h3_r7, [rec]);
    }
  }
  return buckets;
}

/**
 * Build one R2 cold-serving blob per r7 parent cell.
 * Key scheme: groups/r7/<h3_r7> (deterministic → Workflow-step retries overwrite,
 * never duplicate). Body is JSON stamped with the passed data_version plus the
 * full snake_case records under that cell.
 */
export function buildGroupBlobs(
  records: TravelRecord[],
  dataVersion: number,
): { key: string; body: string }[] {
  const buckets = bucketByR7(records);
  const blobs: { key: string; body: string }[] = [];
  for (const [h3_r7, members] of buckets) {
    blobs.push({
      key: `groups/r7/${h3_r7}`,
      body: JSON.stringify({ h3_r7, data_version: dataVersion, records: members }),
    });
  }
  return blobs;
}
