import { v5 as uuidv5 } from 'uuid';

/**
 * Pinned namespace UUID for travel `record_uuid` minting. NEVER change this —
 * altering it would re-key every record. record_uuid = uuidv5(`${source}:${source_id}`, NS_RECORD).
 */
export const NS_RECORD = '1b671a64-40d5-491e-99b0-da01ff1f3341';

/**
 * Stable, idempotent record identity (spec §7). A re-scrape of the same source
 * object yields the same id, so Workflow steps keyed by record_uuid overwrite
 * rather than duplicate.
 */
export function recordUuid(source: string, sourceId: string): string {
  return uuidv5(`${source}:${sourceId}`, NS_RECORD);
}
