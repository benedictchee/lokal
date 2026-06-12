import type { MatchSignals } from '../types.js';

/** Lowercase, collapse non-alphanumerics to single dashes, trim edge dashes. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface Alias {
  key: string;
  kind: 'chain' | 'transport_category' | 'standalone';
  name: string;
}

/**
 * Pick the alias that identifies a record's program group (the ER match signal).
 * Precedence (D9 — aliases are signals, never identity):
 *   1. brand:wikidata:<qid>      (chain)
 *   2. brand:slug:<slug>         (chain)
 *   3. transport:<category>      (transport_category)  — only when subject==='transport'
 *   4. standalone:<record_uuid>  (standalone)          — fallback
 * Reads rec.record_uuid (snake_case).
 */
export function aliasFor(
  rec: { subject: string; category: string; name: string; record_uuid: string },
  signals: MatchSignals,
): Alias {
  if (signals.brandWikidata) {
    return { key: `brand:wikidata:${signals.brandWikidata}`, kind: 'chain', name: signals.brand ?? rec.name };
  }
  if (signals.brand) {
    return { key: `brand:slug:${slugify(signals.brand)}`, kind: 'chain', name: signals.brand };
  }
  if (rec.subject === 'transport') {
    return { key: `transport:${rec.category}`, kind: 'transport_category', name: rec.category };
  }
  return { key: `standalone:${rec.record_uuid}`, kind: 'standalone', name: rec.name };
}
