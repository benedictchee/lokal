# Review → Critical-Information Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine raw place reviews into cross-validated, denoised *critical information*, embed it into Vectorize for search, and store it in D1 for fast read access — incrementally and idempotently.

**Architecture:** Pure logic (fingerprint hashing, critical-info types/serialization/prompt/parse) lives in `packages/pipeline-core` (no Worker bindings). Worker-binding glue (D1 stores, the Workers-AI extraction call) lives in `apps/data-pipeline/src`. A `refine-reviews.ts` script orchestrates: D1 `INSERT OR IGNORE` fingerprint dedup → cold-store new raw reviews in R2 → LLM extraction over new reviews (+ prior critical info) → store critical info in D1 → embed + upsert to Vectorize. Reads the existing Google scrape for the MVP.

**Tech Stack:** TypeScript, pnpm workspace, vitest (+ `@cloudflare/vitest-pool-workers` for D1 tests), Cloudflare D1 / R2 / Vectorize / Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast` for extraction, `@cf/baai/bge-m3` for embedding), `getPlatformProxy` for local runs.

**Spec:** `docs/superpowers/specs/2026-06-13-review-critical-info-pipeline-design.md`

---

## File Structure

- Create `packages/pipeline-core/src/reviews/fingerprint.ts` — normalize + FNV-1a fingerprint (reuses `hash.ts`).
- Create `packages/pipeline-core/src/reviews/critical-info.ts` — `CriticalInfo` type, serialization, embed-text, extraction prompt builder, response parser.
- Modify `packages/pipeline-core/src/index.ts` — export the two new modules.
- Create `packages/pipeline-core/test/reviews/fingerprint.test.ts` and `.../critical-info.test.ts`.
- Create `apps/data-pipeline/migrations/0002_reviews.sql` — `review_fingerprints` + `place_critical_info`.
- Create `apps/data-pipeline/src/reviews-d1.ts` — `D1ReviewFingerprintStore`, `D1CriticalInfoStore`.
- Create `apps/data-pipeline/test/reviews-d1.test.ts` — D1 store tests (vitest-pool-workers).
- Create `apps/data-pipeline/src/extract-critical-info.ts` — Workers-AI extraction wrapper (+ retry).
- Create `apps/data-pipeline/test/extract-critical-info.test.ts` — extractor with a fake AI runner.
- Create `apps/data-pipeline/scripts/refine-reviews.ts` — orchestrator.
- Modify `apps/data-pipeline/wrangler.sim.jsonc` — add the `GROUPS` D1 binding.

Everything is additive; no existing migration or generated code is edited.

---

## Task 1: Review fingerprint (pure)

**Files:**
- Create: `packages/pipeline-core/src/reviews/fingerprint.ts`
- Test: `packages/pipeline-core/test/reviews/fingerprint.test.ts`
- Modify: `packages/pipeline-core/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pipeline-core/test/reviews/fingerprint.test.ts
import { describe, it, expect } from 'vitest';
import { reviewFingerprint } from '../../src/reviews/fingerprint.js';

describe('reviewFingerprint', () => {
  it('is stable across case, punctuation, and whitespace variants', () => {
    const a = reviewFingerprint('Jane Doe', 'Great laksa!  Best in town.');
    const b = reviewFingerprint('jane   doe', 'great laksa best in town');
    expect(a).toBe(b);
  });

  it('differs when the text differs', () => {
    expect(reviewFingerprint('Jane', 'great laksa')).not.toBe(
      reviewFingerprint('Jane', 'terrible laksa'),
    );
  });

  it('differs when the author differs (same text)', () => {
    expect(reviewFingerprint('Jane', 'great laksa')).not.toBe(
      reviewFingerprint('John', 'great laksa'),
    );
  });

  it('returns 8 lowercase hex chars', () => {
    expect(reviewFingerprint('a', 'b')).toMatch(/^[0-9a-f]{8}$/);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @travel/pipeline-core test -- fingerprint`
Expected: FAIL — `reviewFingerprint` not found.

- [ ] **Step 3: Implement**

```ts
// packages/pipeline-core/src/reviews/fingerprint.ts
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
```

- [ ] **Step 4: Add the export**

In `packages/pipeline-core/src/index.ts`, after the existing exports add:
```ts
export { reviewFingerprint } from './reviews/fingerprint.js';
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm --filter @travel/pipeline-core test -- fingerprint`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline-core/src/reviews/fingerprint.ts packages/pipeline-core/test/reviews/fingerprint.test.ts packages/pipeline-core/src/index.ts
git commit -m "feat(pipeline-core): per-place review fingerprint for dedup"
```

---

## Task 2: Critical-information types, serialization, prompt, parse (pure)

**Files:**
- Create: `packages/pipeline-core/src/reviews/critical-info.ts`
- Test: `packages/pipeline-core/test/reviews/critical-info.test.ts`
- Modify: `packages/pipeline-core/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pipeline-core/test/reviews/critical-info.test.ts
import { describe, it, expect } from 'vitest';
import {
  EMPTY_CRITICAL_INFO,
  serializeCriticalInfo,
  criticalInfoEmbedText,
  buildExtractionMessages,
  parseCriticalInfo,
  type CriticalInfo,
} from '../../src/reviews/critical-info.js';

const ci: CriticalInfo = {
  specialties: ['double-roasted pork belly', 'zi char'],
  atmosphere: ['buzzy', 'cramped at peak'],
  good_for: ['groups'],
  consistent_praise: ['great value'],
  consistent_complaints: ['long queues'],
  practical: ['cash only'],
};

describe('serializeCriticalInfo', () => {
  it('is deterministic and includes facet content', () => {
    expect(serializeCriticalInfo(ci)).toBe(serializeCriticalInfo(ci));
    expect(serializeCriticalInfo(ci)).toContain('double-roasted pork belly');
  });
  it('omits empty facets entirely', () => {
    const out = serializeCriticalInfo({ ...EMPTY_CRITICAL_INFO, specialties: ['laksa'] });
    expect(out).toContain('laksa');
    expect(out.toLowerCase()).not.toContain('atmosphere');
  });
});

describe('criticalInfoEmbedText', () => {
  it('anchors with name and category', () => {
    const t = criticalInfoEmbedText('Tek Sen', 'Chinese restaurant', ci);
    expect(t).toContain('Tek Sen');
    expect(t).toContain('Chinese restaurant');
    expect(t).toContain('zi char');
  });
});

describe('buildExtractionMessages', () => {
  it('produces system+user messages mentioning the reviews and the JSON contract', () => {
    const msgs = buildExtractionMessages({
      name: 'Tek Sen', category: 'Chinese restaurant', rating: 4.5,
      reviews: [{ stars: 5, text: 'amazing pork belly' }],
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].content).toContain('amazing pork belly');
    expect(msgs[0].content.toLowerCase()).toContain('json');
  });
});

describe('parseCriticalInfo', () => {
  it('parses a clean JSON object', () => {
    const out = parseCriticalInfo(JSON.stringify(ci));
    expect(out?.specialties).toContain('zi char');
  });
  it('strips ```json code fences', () => {
    const out = parseCriticalInfo('```json\n' + JSON.stringify(ci) + '\n```');
    expect(out?.good_for).toEqual(['groups']);
  });
  it('coerces missing facets to [] and caps array length', () => {
    const out = parseCriticalInfo(JSON.stringify({ specialties: Array(20).fill('x') }));
    expect(out?.atmosphere).toEqual([]);
    expect(out!.specialties.length).toBeLessThanOrEqual(8);
  });
  it('drops empty/whitespace strings', () => {
    const out = parseCriticalInfo(JSON.stringify({ specialties: ['  ', 'laksa', ''] }));
    expect(out?.specialties).toEqual(['laksa']);
  });
  it('returns null on non-JSON', () => {
    expect(parseCriticalInfo('the model refused to answer')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @travel/pipeline-core test -- critical-info`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/pipeline-core/src/reviews/critical-info.ts

/** Extracted, cross-validated facets about a place. Each is a list of short phrases. */
export interface CriticalInfo {
  specialties: string[];
  atmosphere: string[];
  good_for: string[];
  consistent_praise: string[];
  consistent_complaints: string[];
  practical: string[];
}

export const CRITICAL_INFO_KEYS: (keyof CriticalInfo)[] = [
  'specialties', 'atmosphere', 'good_for',
  'consistent_praise', 'consistent_complaints', 'practical',
];

const MAX_ITEMS_PER_FACET = 8;

export const EMPTY_CRITICAL_INFO: CriticalInfo = {
  specialties: [], atmosphere: [], good_for: [],
  consistent_praise: [], consistent_complaints: [], practical: [],
};

const LABELS: Record<keyof CriticalInfo, string> = {
  specialties: 'Specialties',
  atmosphere: 'Atmosphere',
  good_for: 'Good for',
  consistent_praise: 'Praised for',
  consistent_complaints: 'Complaints',
  practical: 'Practical',
};

/** Deterministic dense serialization for embedding; empty facets are omitted. */
export function serializeCriticalInfo(ci: CriticalInfo): string {
  return CRITICAL_INFO_KEYS
    .filter((k) => ci[k] && ci[k].length > 0)
    .map((k) => `${LABELS[k]}: ${ci[k].join(', ')}.`)
    .join(' ');
}

/** Embedding input for a reviewed place: name + category anchor + serialized facets. */
export function criticalInfoEmbedText(name: string, category: string, ci: CriticalInfo): string {
  return [name, category, serializeCriticalInfo(ci)].map((s) => s.trim()).filter(Boolean).join(' ');
}

export interface ExtractionInput {
  name: string;
  category: string;
  rating: number | null;
  existing?: CriticalInfo;
  reviews: { stars: number | null; text: string }[];
}

export interface ChatMessage { role: 'system' | 'user'; content: string; }

const SYSTEM = `You distill noisy place reviews into trustworthy CRITICAL INFORMATION for a travel search index.
Rules:
- EXTRACT facts/attributes; do NOT write prose or a summary.
- CROSS-VALIDATE: keep a point only if multiple reviews corroborate it, OR it is already in the prior critical information and is not contradicted by the new reviews.
- DENOISE: drop one-off opinions, transient complaints (e.g. "slow today"), generic filler ("nice place"), personal anecdotes, off-topic remarks, and contradicted claims.
- Output ONLY a JSON object with exactly these keys, each an array of short phrases (omit a point rather than guess; use [] when nothing qualifies):
  {"specialties":[],"atmosphere":[],"good_for":[],"consistent_praise":[],"consistent_complaints":[],"practical":[]}`;

export function buildExtractionMessages(input: ExtractionInput): ChatMessage[] {
  const priorLine = input.existing
    ? `Prior critical information (carry forward what new reviews still support):\n${JSON.stringify(input.existing)}\n\n`
    : '';
  const reviewsBlock = input.reviews
    .map((r, i) => `#${i + 1} [${r.stars ?? '?'}★] ${r.text}`)
    .join('\n');
  const user =
    `Place: ${input.name}\nCategory: ${input.category}\nOverall rating: ${input.rating ?? 'n/a'}\n\n` +
    priorLine +
    `New reviews:\n${reviewsBlock}\n\nReturn the JSON object only.`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}

function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, MAX_ITEMS_PER_FACET);
}

/** Parse a model response into CriticalInfo. Tolerates code fences/surrounding prose. Null if no JSON object. */
export function parseCriticalInfo(raw: string): CriticalInfo | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const out = { ...EMPTY_CRITICAL_INFO };
  for (const k of CRITICAL_INFO_KEYS) out[k] = cleanList(obj[k]);
  return out;
}
```

- [ ] **Step 4: Add the exports**

In `packages/pipeline-core/src/index.ts` add:
```ts
export * from './reviews/critical-info.js';
```
(and keep the `fingerprint` export from Task 1).

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm --filter @travel/pipeline-core test -- critical-info`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline-core/src/reviews/critical-info.ts packages/pipeline-core/test/reviews/critical-info.test.ts packages/pipeline-core/src/index.ts
git commit -m "feat(pipeline-core): critical-info type, serialization, extraction prompt + parser"
```

---

## Task 3: D1 migration for reviews

**Files:**
- Create: `apps/data-pipeline/migrations/0002_reviews.sql`

- [ ] **Step 1: Write the migration**

```sql
-- apps/data-pipeline/migrations/0002_reviews.sql
-- Review dedup index + extracted critical-information store (read-side serving + watermark).

CREATE TABLE IF NOT EXISTS review_fingerprints (
  place_id    TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  first_seen  TEXT NOT NULL,            -- ISO timestamp
  PRIMARY KEY (place_id, fingerprint)   -- unique index = the dedup
);

CREATE TABLE IF NOT EXISTS place_critical_info (
  place_id          TEXT PRIMARY KEY,
  record_uuid       TEXT NOT NULL,      -- == Vectorize vector id
  critical_json     TEXT NOT NULL,      -- the facets JSON
  embed_text        TEXT NOT NULL,      -- serialized facets used for embedding
  review_count      INTEGER NOT NULL,   -- cumulative reviews seen
  updated_at        TEXT NOT NULL,
  last_processed_at TEXT NOT NULL       -- time watermark for the next delta
);
```

- [ ] **Step 2: Apply to the local D1 and verify**

Run:
```bash
cd apps/data-pipeline
pnpm exec wrangler d1 migrations apply travel-groups --local
pnpm exec wrangler d1 execute travel-groups --local --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('review_fingerprints','place_critical_info');"
```
Expected: both table names listed.

- [ ] **Step 3: Commit**

```bash
git add apps/data-pipeline/migrations/0002_reviews.sql
git commit -m "feat(data-pipeline): D1 migration for review fingerprints + critical info"
```

---

## Task 4: D1 stores (fingerprint dedup + critical info)

**Files:**
- Create: `apps/data-pipeline/src/reviews-d1.ts`
- Test: `apps/data-pipeline/test/reviews-d1.test.ts`

> The test mirrors the existing `apps/data-pipeline/test/registry-d1.test.ts` setup: it imports `env` and `applyD1Migrations` from `cloudflare:test` and applies migrations in `beforeAll`. `applyD1Migrations` applies ALL files in `migrations/`, so `0002_reviews.sql` is picked up automatically. Read `registry-d1.test.ts` for the exact boilerplate.

- [ ] **Step 1: Write the failing test**

```ts
// apps/data-pipeline/test/reviews-d1.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { env, applyD1Migrations } from 'cloudflare:test';
import { D1ReviewFingerprintStore, D1CriticalInfoStore } from '../src/reviews-d1.js';
import { EMPTY_CRITICAL_INFO } from '@travel/pipeline-core';

// Mirror registry-d1.test.ts: apply migrations to the test D1 before the suite.
beforeAll(async () => {
  // @ts-expect-error TEST_MIGRATIONS is provided by the vitest-pool-workers config
  await applyD1Migrations(env.GROUPS, env.TEST_MIGRATIONS);
});

describe('D1ReviewFingerprintStore.markSeen', () => {
  it('returns all fps as new on first insert, none on repeat', async () => {
    const store = new D1ReviewFingerprintStore(env.GROUPS);
    const fps = [{ fp: 'aaaa1111', firstSeen: 't' }, { fp: 'bbbb2222', firstSeen: 't' }];
    const first = await store.markSeen('placeX', fps);
    expect(first.size).toBe(2);
    const second = await store.markSeen('placeX', fps);
    expect(second.size).toBe(0);
  });

  it('scopes dedup per place', async () => {
    const store = new D1ReviewFingerprintStore(env.GROUPS);
    await store.markSeen('placeA', [{ fp: 'shared00', firstSeen: 't' }]);
    const other = await store.markSeen('placeB', [{ fp: 'shared00', firstSeen: 't' }]);
    expect(other.size).toBe(1); // same fp, different place => still new
  });
});

describe('D1CriticalInfoStore', () => {
  it('round-trips put -> get', async () => {
    const store = new D1CriticalInfoStore(env.GROUPS);
    await store.put({
      place_id: 'p1', record_uuid: 'r1',
      critical_json: JSON.stringify(EMPTY_CRITICAL_INFO),
      embed_text: 'Foo cafe', review_count: 3,
      updated_at: 't', last_processed_at: 't',
    });
    const got = await store.get('p1');
    expect(got?.record_uuid).toBe('r1');
    expect(got?.review_count).toBe(3);
    expect(await store.get('missing')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @travel/data-pipeline test -- reviews-d1`
Expected: FAIL — `../src/reviews-d1.js` not found.

- [ ] **Step 3: Implement**

```ts
// apps/data-pipeline/src/reviews-d1.ts

export interface FingerprintRow { fp: string; firstSeen: string; }

/** Per-place review dedup backed by the review_fingerprints unique index. */
export class D1ReviewFingerprintStore {
  constructor(private readonly db: D1Database) {}

  /** Batch INSERT OR IGNORE; returns the set of fps that were NEWLY inserted. */
  async markSeen(placeId: string, rows: FingerprintRow[]): Promise<Set<string>> {
    if (rows.length === 0) return new Set();
    const stmts = rows.map((r) =>
      this.db
        .prepare('INSERT OR IGNORE INTO review_fingerprints (place_id, fingerprint, first_seen) VALUES (?, ?, ?)')
        .bind(placeId, r.fp, r.firstSeen),
    );
    const results = await this.db.batch(stmts);
    const fresh = new Set<string>();
    results.forEach((res, i) => {
      if ((res.meta?.changes ?? 0) > 0) fresh.add(rows[i]!.fp);
    });
    return fresh;
  }
}

export interface CriticalInfoRow {
  place_id: string;
  record_uuid: string;
  critical_json: string;
  embed_text: string;
  review_count: number;
  updated_at: string;
  last_processed_at: string;
}

/** Read/write the extracted critical information per place (easy-access store). */
export class D1CriticalInfoStore {
  constructor(private readonly db: D1Database) {}

  async get(placeId: string): Promise<CriticalInfoRow | null> {
    return (
      (await this.db
        .prepare('SELECT * FROM place_critical_info WHERE place_id = ?')
        .bind(placeId)
        .first<CriticalInfoRow>()) ?? null
    );
  }

  async put(row: CriticalInfoRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO place_critical_info
         (place_id, record_uuid, critical_json, embed_text, review_count, updated_at, last_processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.place_id, row.record_uuid, row.critical_json, row.embed_text,
        row.review_count, row.updated_at, row.last_processed_at,
      )
      .run();
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @travel/data-pipeline test -- reviews-d1`
Expected: PASS. If `env.GROUPS`/`TEST_MIGRATIONS` is unavailable, copy the exact `beforeAll`/config wiring from `test/registry-d1.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/data-pipeline/src/reviews-d1.ts apps/data-pipeline/test/reviews-d1.test.ts
git commit -m "feat(data-pipeline): D1 stores for review dedup + critical info"
```

---

## Task 5: Workers-AI extraction wrapper

**Files:**
- Create: `apps/data-pipeline/src/extract-critical-info.ts`
- Test: `apps/data-pipeline/test/extract-critical-info.test.ts`

- [ ] **Step 1: Write the failing test (fake AI runner — no network)**

```ts
// apps/data-pipeline/test/extract-critical-info.test.ts
import { describe, it, expect } from 'vitest';
import { extractCriticalInfo } from '../src/extract-critical-info.js';

const input = {
  name: 'Tek Sen', category: 'Chinese restaurant', rating: 4.5,
  reviews: [{ stars: 5, text: 'pork belly amazing' }, { stars: 5, text: 'great pork belly, long queue' }],
};

describe('extractCriticalInfo', () => {
  it('parses a good JSON response', async () => {
    const ai = { run: async () => ({ response: '{"specialties":["pork belly"]}' }) };
    const ci = await extractCriticalInfo(ai as any, input);
    expect(ci?.specialties).toEqual(['pork belly']);
  });

  it('retries once on unparseable output, then succeeds', async () => {
    let n = 0;
    const ai = { run: async () => { n++; return { response: n === 1 ? 'sorry' : '{"good_for":["groups"]}' }; } };
    const ci = await extractCriticalInfo(ai as any, input);
    expect(n).toBe(2);
    expect(ci?.good_for).toEqual(['groups']);
  });

  it('returns null if it never parses', async () => {
    const ai = { run: async () => ({ response: 'no json here' }) };
    expect(await extractCriticalInfo(ai as any, input)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @travel/data-pipeline test -- extract-critical-info`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/data-pipeline/src/extract-critical-info.ts
import {
  buildExtractionMessages, parseCriticalInfo,
  type CriticalInfo, type ExtractionInput,
} from '@travel/pipeline-core';

export const EXTRACT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Minimal shape of the Workers AI binding we use (keeps the fn testable with a fake). */
interface AiRunner { run(model: string, opts: unknown): Promise<{ response?: string }>; }

/** Extract critical info via the LLM; one stricter retry on parse failure, else null. */
export async function extractCriticalInfo(ai: AiRunner, input: ExtractionInput): Promise<CriticalInfo | null> {
  const messages = buildExtractionMessages(input);
  for (let attempt = 0; attempt < 2; attempt++) {
    const msgs = attempt === 0
      ? messages
      : [...messages, { role: 'user' as const, content: 'Output ONLY the JSON object, nothing else.' }];
    const res = await ai.run(EXTRACT_MODEL, { messages: msgs, max_tokens: 700, temperature: 0.1 });
    const parsed = parseCriticalInfo(res.response ?? '');
    if (parsed) return parsed;
  }
  return null;
}
```

> Note: `ExtractionInput` is exported from pipeline-core via Task 2's `export * from './reviews/critical-info.js'`.

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @travel/data-pipeline test -- extract-critical-info`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/data-pipeline/src/extract-critical-info.ts apps/data-pipeline/test/extract-critical-info.test.ts
git commit -m "feat(data-pipeline): Workers-AI critical-info extraction wrapper with retry"
```

---

## Task 6: Orchestrator script + wiring + live verification

**Files:**
- Modify: `apps/data-pipeline/wrangler.sim.jsonc`
- Create: `apps/data-pipeline/scripts/refine-reviews.ts`

- [ ] **Step 1: Add the D1 binding to the sim config**

Edit `apps/data-pipeline/wrangler.sim.jsonc` — add the `GROUPS` D1 binding alongside the existing R2/Vectorize/AI bindings (so the script gets a local D1 with the migrations applied):
```jsonc
  "d1_databases": [
    { "binding": "GROUPS", "database_name": "travel-groups", "database_id": "1b9cbcb6-4a04-44a1-9f56-2fb458b1fa89", "migrations_dir": "migrations" }
  ],
```

- [ ] **Step 2: Write the orchestrator**

```ts
// apps/data-pipeline/scripts/refine-reviews.ts
// Refine raw Google reviews into critical information: dedup (D1) -> cold-store
// new raw (R2) -> LLM extract -> store critical info (D1) -> embed + upsert (Vectorize).
//   CLOUDFLARE_ACCOUNT_ID=... pnpm exec tsx scripts/refine-reviews.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import {
  reviewFingerprint, criticalInfoEmbedText, EMPTY_CRITICAL_INFO,
  googlePlaceToRecord, aliasFor, recordMetadata,
  type CriticalInfo, type GoogleRawPlace,
} from '@travel/pipeline-core';
import { D1GroupRegistry } from '../src/registry-d1.js';
import { D1ReviewFingerprintStore, D1CriticalInfoStore } from '../src/reviews-d1.js';
import { extractCriticalInfo } from '../src/extract-critical-info.js';
import type { Env } from '../src/env.js';

const BGE = '@cf/baai/bge-m3';
const NOW = new Date().toISOString();

async function main() {
  const { env, dispose } = await getPlatformProxy<Env>({ configPath: 'wrangler.sim.jsonc' });
  const fpStore = new D1ReviewFingerprintStore(env.GROUPS);
  const ciStore = new D1CriticalInfoStore(env.GROUPS);
  const groups = new D1GroupRegistry(env.GROUPS);
  try {
    const gj = JSON.parse(readFileSync(join(import.meta.dirname, 'out/google-georgetown.json'), 'utf8'));
    const places: GoogleRawPlace[] = gj.places ?? [];
    let processed = 0, embedded = 0, skipped = 0;

    for (const place of places) {
      const reviews = place.reviews ?? [];
      if (reviews.length === 0) { skipped++; continue; }

      // 1) dedup: which reviews are new for this place?
      const fps = reviews.map((r) => ({ fp: reviewFingerprint(r.author, r.text), firstSeen: NOW, review: r }));
      const fresh = await fpStore.markSeen(place.place_id, fps.map(({ fp, firstSeen }) => ({ fp, firstSeen })));
      const newReviews = fps.filter((x) => fresh.has(x.fp)).map((x) => x.review);
      if (newReviews.length === 0) { skipped++; continue; }

      // 2) cold-store the new raw reviews (R2), append-only NDJSON per place
      const coldKey = `raw/reviews/google/${place.place_id}.ndjson`;
      const prior = await env.DATA.get(coldKey);
      const priorText = prior ? await prior.text() : '';
      const appended = priorText + newReviews.map((r) => JSON.stringify({ ...r, scraped_at: place.scraped_at })).join('\n') + '\n';
      await env.DATA.put(coldKey, appended);

      // 3) normalize -> record_uuid + metadata (for the Vectorize id)
      const norm = googlePlaceToRecord(place);
      if (!norm) { skipped++; continue; }
      const { record, signals } = norm;
      const alias = aliasFor({ subject: record.subject, category: record.category, name: record.name, record_uuid: record.record_uuid }, signals);
      const group_uuid = await groups.resolve(alias.key, { subject: record.subject, kind: alias.kind, canonical_name: alias.name });
      const full = { ...record, group_uuid } as typeof record & { group_uuid: string };

      // 4) extract critical info (prior + new reviews)
      const existingRow = await ciStore.get(place.place_id);
      const existing: CriticalInfo | undefined = existingRow ? JSON.parse(existingRow.critical_json) : undefined;
      const ci = await extractCriticalInfo(env.AI, {
        name: record.name, category: record.category, rating: place.panel?.rating ?? null,
        existing, reviews: newReviews.map((r) => ({ stars: r.stars, text: r.text })),
      });
      if (!ci) { console.log(`  [skip] extraction failed: ${record.name}`); skipped++; continue; }

      // 5) embed the critical info -> upsert Vectorize
      const embedText = criticalInfoEmbedText(record.name, record.category, ci);
      const emb = (await env.AI.run(BGE, { text: [embedText] })) as { data: number[][] };
      await env.VECTORIZE.upsert([{ id: record.record_uuid, values: emb.data[0]!, metadata: recordMetadata(full) as Record<string, string> }]);
      embedded++;

      // 6) store critical info (D1)
      const reviewCount = (existingRow?.review_count ?? 0) + newReviews.length;
      await ciStore.put({
        place_id: place.place_id, record_uuid: record.record_uuid,
        critical_json: JSON.stringify(ci), embed_text: embedText,
        review_count: reviewCount, updated_at: NOW, last_processed_at: NOW,
      });
      processed++;
      console.log(`  ✓ ${record.name}: +${newReviews.length} new reviews -> ${Object.values(ci).flat().length} facts`);
    }
    console.log(`\nprocessed=${processed} embedded=${embedded} skipped=${skipped} / ${places.length} places`);
  } finally {
    await dispose();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

> If `aliasFor` is not yet exported from pipeline-core's index, add `export { aliasFor } from './grouping/alias.js';` (it is used by `bulk-enrich.ts`, so it should already be available — verify the import resolves).

- [ ] **Step 3: Typecheck**

Run: `CI=1 pnpm run typecheck`
Expected: CLEAN. Fix any binding/type mismatches before running.

- [ ] **Step 4: Apply migrations to the sim's local D1, then run (first run = all reviews are new)**

```bash
cd apps/data-pipeline
pnpm exec wrangler d1 migrations apply travel-groups --local
export CLOUDFLARE_ACCOUNT_ID=c49d1729c285b0b32b7acd957cc31742
CI=1 pnpm exec tsx scripts/refine-reviews.ts
```
Expected: ~90 places processed/embedded, skipped only the ones without reviews. (Workers AI + Vectorize hit the cloud; D1 + R2 are local.)

- [ ] **Step 5: Verify idempotency — run it again**

Run the same `tsx scripts/refine-reviews.ts` again.
Expected: `processed=0 ... skipped=<all>` — every review's fingerprint already exists, so no new extraction or embedding. This proves the time/delta-independent dedup safety net.

- [ ] **Step 6: Verify critical info is searchable on review-derived language**

Run a query that only matches *review content*, not the name/category:
```bash
CI=1 pnpm exec tsx scripts/search-sim.ts "old-school spot, cash only, famous for smoky wok-fried noodles"
```
Expected: a relevant reviewed place ranks at/near the top — confirming the embedded critical information (not just name+category+address) is driving the match. Also confirm D1 rows:
```bash
pnpm exec wrangler d1 execute travel-groups --local --command \
  "SELECT COUNT(*) AS fps FROM review_fingerprints; SELECT COUNT(*) AS places FROM place_critical_info;"
```

- [ ] **Step 7: Commit**

```bash
git add apps/data-pipeline/scripts/refine-reviews.ts apps/data-pipeline/wrangler.sim.jsonc
git commit -m "feat(data-pipeline): refine-reviews orchestrator — dedup + extract + embed critical info"
```

---

## Task 7: Final verification + push

- [ ] **Step 1: Full test + typecheck**

Run: `CI=1 pnpm run typecheck && pnpm -r test`
Expected: all green.

- [ ] **Step 2: Push**

```bash
git push origin main
```

- [ ] **Step 3: Update memory**

Append a line to `MEMORY.md` and a project memory noting the review→critical-info pipeline exists, the new D1 tables (`review_fingerprints`, `place_critical_info`), the extraction model, and that `refine-reviews.ts` is the entry point.

---

## Self-Review

- **Spec coverage:** raw→cold R2 (Task 6 step 2) ✓; D1 fingerprint dedup (Tasks 3,4) ✓; time/delta + best-effort dedup (Task 6 — first run all-new, dedup is the safety net) ✓; extract-not-summarise + cross-validate + denoise (Task 2 prompt, Task 5) ✓; embed critical info (Task 6 step 5) ✓; store for easy access (Task 4, Task 6 step 6) ✓; raw never user-facing (no rendering task) ✓; model choice (Task 5) ✓; idempotency (Task 6 step 5) ✓.
- **Placeholders:** none — every code step is complete.
- **Type consistency:** `CriticalInfo`, `ExtractionInput`, `ChatMessage` defined in Task 2 and consumed in Tasks 5–6; `FingerprintRow`/`CriticalInfoRow` defined in Task 4 and used in Task 6; `record_uuid` is the single Vectorize id throughout.
- **Open verification (not a blocker):** the `applyD1Migrations(env.GROUPS, env.TEST_MIGRATIONS)` wiring (Task 4) and `aliasFor` export (Task 6) must match the existing repo — both have an explicit "mirror/verify" note.
