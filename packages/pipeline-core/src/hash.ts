/**
 * FNV-1a 32-bit hash, rendered as a lowercase, zero-padded 8-char hex string.
 * Synchronous and deterministic — no async crypto. Used for `content_hash`
 * (change detection) and raw-blob keying. Stable across Node and workerd.
 */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5; // FNV offset basis (2166136261)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // FNV prime 0x01000193; Math.imul keeps the 32-bit multiply exact.
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
