import { fnv1a } from '../hash.js';

/**
 * Land an unmodified source payload in R2 before any parsing → replayable ingest.
 *
 * Key is deterministic: `raw/<source>/<fnv1a-hex>`. Same bytes from the same
 * source always map to the same key, so a Workflow step retry overwrites the
 * blob instead of duplicating it. `fnv1a` is the repo's sync, deterministic
 * content hash (hash.ts) — no async crypto on the ingest hot path.
 *
 * @param bucket  the single R2 bucket binding (env.DATA)
 * @param source  provenance namespace, e.g. 'osm'
 * @param payload the raw response text exactly as received
 * @returns the R2 key the payload was stored under
 */
export async function putRaw(
  bucket: R2Bucket,
  source: string,
  payload: string,
): Promise<string> {
  const key = `raw/${source}/${fnv1a(payload)}`;
  await bucket.put(key, payload);
  return key;
}
