import { fnv1a } from '../hash.js';

/** Lowercase, strip punctuation/symbols (keep letters/numbers/space), collapse whitespace. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Best-effort dedup key for one review, scoped per place. FNV-1a (sync, no async
 * crypto — stable across Node and workerd, matching the rest of pipeline-core).
 * 32-bit collisions are negligible within a single place's reviews; a collision
 * only ever costs one missed new review, which the design accepts.
 */
export function reviewFingerprint(author: string, text: string): string {
  return fnv1a(`${normalize(author)}\x1f${normalize(text)}`);
}
