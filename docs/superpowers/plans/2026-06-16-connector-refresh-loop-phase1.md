# Connector Refresh Loop — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the end-to-end, no-Chrome vertical slice of the connector refresh loop: record `source_url`, persist two-level change-detection state in D1, run an API connector through a refresh cycle that skips unchanged sources and emits only changed records, then merge those records into the existing `groups/r7` blobs and enqueue them onto the existing enrich → Vectorize path.

**Architecture:** A connector-agnostic `runRefreshSource` orchestration on the data-pipeline Worker. It reads a per-source snapshot (last fingerprint) to skip unchanged sources, diffs each pulled record's `content_hash` against a `record_state` table to find what changed, materializes only the changed records into `TravelRecord`s, **merges** them into the per-r7 R2 blobs (read-modify-write, never full rebuild), and enqueues their `record_uuid`s onto the existing `ENRICH` queue. Phase 1 proves the whole path with one API connector and a fake connector in tests; no device pool, no browser connectors, no Chrome.

**Tech Stack:** TypeScript, Cloudflare Workers (D1 + R2 + Queues), Vitest with `@cloudflare/vitest-pool-workers`, `@travel/pipeline-core` (pure TS), `h3-js`, `uuid`.

This plan is **Phase 1 only**. Phase 2 (browser connectors via the device pool + server-side DOM extractor) and Phase 3 (deletions/tombstones, cadence tuning, observability, lake compaction) get their own plans once Phase 1's interfaces are concrete. See spec `docs/superpowers/specs/2026-06-16-connector-refresh-loop-design.md` §13.

---

## File Structure

**Create:**
- `apps/data-pipeline/migrations/0004_refresh.sql` — `source_snapshot` + `record_state` tables.
- `apps/data-pipeline/src/refresh/refresh-d1.ts` — `SourceSnapshotStore`, `RecordStateStore` (mirror the `pool-d1.ts` store pattern).
- `apps/data-pipeline/src/refresh/diff.ts` — `classifyRecords` (pure per-record diff).
- `apps/data-pipeline/src/refresh/run-refresh.ts` — `runRefreshSource` orchestration.
- `packages/pipeline-core/src/normalize/connector.ts` — `pulledToNormalized` (PulledRecord → TravelRecord-minus-derived-fields).
- `packages/pipeline-core/src/serving/blob-merge.ts` — `mergeIntoR7Blob` (read-modify-write merge).
- Tests: `apps/data-pipeline/test/refresh-d1.test.ts`, `apps/data-pipeline/test/refresh-diff.test.ts`, `apps/data-pipeline/test/blob-merge.test.ts`, `apps/data-pipeline/test/normalize-connector.test.ts`, `apps/data-pipeline/test/run-refresh.integration.test.ts`, `apps/data-pipeline/test/refresh-handler.test.ts`.

**Modify:**
- `apps/data-pipeline/scripts/connectors/core/types.ts` — add `source_url?` to `PulledRecord`.
- `apps/data-pipeline/scripts/connectors/core/fingerprint.ts` — let `mkRecord` carry `source_url`.
- `apps/data-pipeline/scripts/connectors/tierA/sparql.ts` — wikidata populates `source_url`.
- `packages/pipeline-core/src/index.ts` — export the two new helpers.
- `apps/data-pipeline/src/index.ts` — add an authenticated `POST /refresh` manual trigger.

**Conventions to follow (verified in the codebase):**
- D1 store classes take `(private readonly db: D1Database)` and use prepared statements (see `src/pool/pool-d1.ts`).
- Tests import `env` from `cloudflare:test`, apply migration SQL with `import sql from '../migrations/NNNN.sql?raw'` then `sql.split(';').map(s=>s.trim()).filter(Boolean)` in `beforeAll` (see `test/pool-d1.test.ts`).
- Run tests with `pnpm --filter @travel/data-pipeline test` from the repo root, or `npx vitest run <file>` inside `apps/data-pipeline`.
- All ISO timestamps are passed in by the caller (never `Date.now()` inside reusable logic) so tests are deterministic — mirror `src/run-ingest.ts`.
- **Never import `scripts/connectors/core/registry.ts` or `ALL_CONNECTORS` into `src/`** — they pull in `browser/strategies.ts` which imports Playwright. Import individual connector modules only.

---

## Task 1: D1 state tables + stores

**Files:**
- Create: `apps/data-pipeline/migrations/0004_refresh.sql`
- Create: `apps/data-pipeline/src/refresh/refresh-d1.ts`
- Test: `apps/data-pipeline/test/refresh-d1.test.ts`

- [ ] **Step 1: Write the migration**

Create `apps/data-pipeline/migrations/0004_refresh.sql`:

```sql
-- Connector refresh loop: per-source snapshot + per-record change-detection state.

-- One row per connector id. Cheap source-level "did anything change?" skip.
CREATE TABLE IF NOT EXISTS source_snapshot (
  source             TEXT PRIMARY KEY,
  fingerprint_method TEXT,
  fingerprint_value  TEXT,
  cursor             TEXT,
  since_ts           TEXT,
  last_run_at        TEXT,
  last_status        TEXT
);

-- One row per record. Per-record content_hash diff (new / changed / unchanged).
CREATE TABLE IF NOT EXISTS record_state (
  record_uuid     TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  source_url      TEXT,
  content_hash    TEXT NOT NULL,
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  last_changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_record_state_source ON record_state (source, last_seen_at);
```

- [ ] **Step 2: Write the failing test**

Create `apps/data-pipeline/test/refresh-d1.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import migrationSql from '../migrations/0004_refresh.sql?raw';
import { SourceSnapshotStore, RecordStateStore } from '../src/refresh/refresh-d1.js';

beforeAll(async () => {
  for (const stmt of migrationSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.GROUPS.prepare(stmt).run();
  }
});

describe('0004_refresh migration', () => {
  it('creates source_snapshot and record_state', async () => {
    const rows = await env.GROUPS
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('source_snapshot','record_state') ORDER BY name")
      .all<{ name: string }>();
    expect(rows.results.map((r) => r.name)).toEqual(['record_state', 'source_snapshot']);
  });
});

describe('SourceSnapshotStore', () => {
  it('returns null for an unknown source, then round-trips a saved snapshot', async () => {
    const store = new SourceSnapshotStore(env.GROUPS);
    expect(await store.get('unknown')).toBeNull();
    await store.save({
      source: 'wikidata', fingerprint_method: 'etag', fingerprint_value: 'abc',
      cursor: null, since_ts: '2026-06-16T00:00:00Z', last_run_at: '2026-06-16T00:00:00Z', last_status: 'ok',
    });
    const got = await store.get('wikidata');
    expect(got?.fingerprint_value).toBe('abc');
    expect(got?.since_ts).toBe('2026-06-16T00:00:00Z');
  });

  it('markUnchanged updates run time and status without touching the fingerprint', async () => {
    const store = new SourceSnapshotStore(env.GROUPS);
    await store.save({
      source: 'dbpedia', fingerprint_method: 'count', fingerprint_value: 'v1',
      cursor: null, since_ts: null, last_run_at: '2026-06-16T00:00:00Z', last_status: 'ok',
    });
    await store.markUnchanged('dbpedia', '2026-06-17T00:00:00Z');
    const got = await store.get('dbpedia');
    expect(got?.fingerprint_value).toBe('v1');
    expect(got?.last_status).toBe('unchanged');
    expect(got?.last_run_at).toBe('2026-06-17T00:00:00Z');
  });
});

describe('RecordStateStore', () => {
  it('upsertObserved inserts new rows, then reports their hashes', async () => {
    const store = new RecordStateStore(env.GROUPS);
    await store.upsertObserved([
      { record_uuid: 'u1', source: 's', source_url: 'http://x/1', content_hash: 'h1' },
      { record_uuid: 'u2', source: 's', source_url: 'http://x/2', content_hash: 'h2' },
    ], '2026-06-16T00:00:00Z');
    const hashes = await store.hashesForSource('s');
    expect(hashes.get('u1')).toBe('h1');
    expect(hashes.get('u2')).toBe('h2');
    expect(hashes.size).toBe(2);
  });

  it('bumps last_changed_at only when the hash actually changes', async () => {
    const store = new RecordStateStore(env.GROUPS);
    await store.upsertObserved([{ record_uuid: 'c1', source: 's2', source_url: 'u', content_hash: 'h1' }], '2026-06-16T00:00:00Z');
    // Same hash -> last_changed_at stays, last_seen_at advances.
    await store.upsertObserved([{ record_uuid: 'c1', source: 's2', source_url: 'u', content_hash: 'h1' }], '2026-06-17T00:00:00Z');
    let row = await env.GROUPS.prepare('SELECT * FROM record_state WHERE record_uuid=?').bind('c1').first<any>();
    expect(row.last_changed_at).toBe('2026-06-16T00:00:00Z');
    expect(row.last_seen_at).toBe('2026-06-17T00:00:00Z');
    // Changed hash -> last_changed_at advances.
    await store.upsertObserved([{ record_uuid: 'c1', source: 's2', source_url: 'u', content_hash: 'h2' }], '2026-06-18T00:00:00Z');
    row = await env.GROUPS.prepare('SELECT * FROM record_state WHERE record_uuid=?').bind('c1').first<any>();
    expect(row.last_changed_at).toBe('2026-06-18T00:00:00Z');
    expect(row.content_hash).toBe('h2');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/data-pipeline && npx vitest run test/refresh-d1.test.ts`
Expected: FAIL — `Cannot find module '../src/refresh/refresh-d1.js'`.

- [ ] **Step 4: Write the stores**

Create `apps/data-pipeline/src/refresh/refresh-d1.ts`:

```ts
/** Per-source snapshot + per-record change-detection state (migration 0004). */

export interface SnapshotRow {
  source: string;
  fingerprint_method: string | null;
  fingerprint_value: string | null;
  cursor: string | null;
  since_ts: string | null;
  last_run_at: string | null;
  last_status: string | null;
}

export interface ObservedRecord {
  record_uuid: string;
  source: string;
  source_url: string;
  content_hash: string;
}

/** One row per connector id — the cheap source-level skip key. */
export class SourceSnapshotStore {
  constructor(private readonly db: D1Database) {}

  async get(source: string): Promise<SnapshotRow | null> {
    return (
      (await this.db.prepare('SELECT * FROM source_snapshot WHERE source = ?').bind(source).first<SnapshotRow>()) ?? null
    );
  }

  async save(row: SnapshotRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO source_snapshot
           (source, fingerprint_method, fingerprint_value, cursor, since_ts, last_run_at, last_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(row.source, row.fingerprint_method, row.fingerprint_value, row.cursor, row.since_ts, row.last_run_at, row.last_status)
      .run();
  }

  /** Record an unchanged run: advance last_run_at, set status, keep the fingerprint. */
  async markUnchanged(source: string, nowIso: string): Promise<void> {
    await this.db
      .prepare("UPDATE source_snapshot SET last_run_at = ?2, last_status = 'unchanged' WHERE source = ?1")
      .bind(source, nowIso)
      .run();
  }
}

/** One row per record — the per-record content_hash diff state. */
export class RecordStateStore {
  constructor(private readonly db: D1Database) {}

  /** record_uuid -> content_hash for every known record of a source. */
  async hashesForSource(source: string): Promise<Map<string, string>> {
    const res = await this.db
      .prepare('SELECT record_uuid, content_hash FROM record_state WHERE source = ?')
      .bind(source)
      .all<{ record_uuid: string; content_hash: string }>();
    return new Map(res.results.map((r) => [r.record_uuid, r.content_hash]));
  }

  /**
   * Upsert every observed record. New rows stamp first/last/changed = now.
   * Existing rows always advance last_seen_at; last_changed_at advances ONLY
   * when content_hash differs (the CASE reads the pre-update row value).
   */
  async upsertObserved(records: ObservedRecord[], nowIso: string): Promise<void> {
    if (records.length === 0) return;
    const stmts = records.map((r) =>
      this.db
        .prepare(
          `INSERT INTO record_state (record_uuid, source, source_url, content_hash, first_seen_at, last_seen_at, last_changed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5)
           ON CONFLICT(record_uuid) DO UPDATE SET
             source_url      = excluded.source_url,
             last_seen_at    = excluded.last_seen_at,
             last_changed_at = CASE WHEN record_state.content_hash <> excluded.content_hash
                                    THEN excluded.last_seen_at ELSE record_state.last_changed_at END,
             content_hash    = excluded.content_hash`,
        )
        .bind(r.record_uuid, r.source, r.source_url, r.content_hash, nowIso),
    );
    await this.db.batch(stmts);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/data-pipeline && npx vitest run test/refresh-d1.test.ts`
Expected: PASS (3 describe blocks, 5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/data-pipeline/migrations/0004_refresh.sql apps/data-pipeline/src/refresh/refresh-d1.ts apps/data-pipeline/test/refresh-d1.test.ts
git commit -m "feat(data-pipeline): refresh state tables + stores (source_snapshot, record_state)"
```

---

## Task 2: Record the URL — `source_url` on the connector envelope

**Files:**
- Modify: `apps/data-pipeline/scripts/connectors/core/types.ts` (the `PulledRecord` interface)
- Modify: `apps/data-pipeline/scripts/connectors/core/fingerprint.ts` (the `mkRecord` `extra` type)
- Modify: `apps/data-pipeline/scripts/connectors/tierA/sparql.ts` (the `wikidata` connector body)
- Test: `apps/data-pipeline/test/normalize-connector.test.ts` (created in Task 3 also asserts this; here add a focused unit test inline)

- [ ] **Step 1: Write the failing test**

Create `apps/data-pipeline/test/envelope-source-url.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkRecord } from '../scripts/connectors/core/fingerprint.js';

describe('mkRecord carries source_url', () => {
  it('passes source_url through into the PulledRecord', () => {
    const r = mkRecord('wikidata', 'Q42', { a: 1 }, { name: 'Douglas', source_url: 'https://www.wikidata.org/entity/Q42' });
    expect(r.source_url).toBe('https://www.wikidata.org/entity/Q42');
    expect(r.record_uuid).toBeTruthy();
    expect(r.content_hash).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/data-pipeline && npx vitest run test/envelope-source-url.test.ts`
Expected: FAIL — TypeScript/property error: `source_url` not assignable in `mkRecord`'s `extra` arg.

- [ ] **Step 3: Add `source_url` to `PulledRecord`**

In `apps/data-pipeline/scripts/connectors/core/types.ts`, inside `interface PulledRecord`, add the field right after `content_hash`:

```ts
  /** fnv1a hash of the canonical content → per-record delta key (dedup elsewhere). */
  content_hash: string;
  /** API endpoint or page URL this item came from (flows into TravelRecord.source_url). */
  source_url?: string;
  /** Source-reported last-update, if the source exposes one. */
  updated_at?: string;
```

- [ ] **Step 4: Let `mkRecord` accept `source_url`**

In `apps/data-pipeline/scripts/connectors/core/fingerprint.ts`, widen the `extra` parameter Pick:

```ts
export function mkRecord(
  connectorId: string,
  sourceId: string,
  content: unknown,
  extra: Partial<Pick<PulledRecord, 'updated_at' | 'name' | 'lat' | 'lng' | 'raw' | 'source_url'>> = {},
): PulledRecord {
```

(The function body already spreads `...extra`, so no other change is needed.)

- [ ] **Step 5: Populate `source_url` in the wikidata connector**

In `apps/data-pipeline/scripts/connectors/tierA/sparql.ts`, in the `wikidata` connector's `records` map, add `source_url` to the `mkRecord` extra:

```ts
    const records = bindings.map((b) => {
      const qid = b.item!.value.split('/').pop()!;
      const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord?.value ?? '');
      return mkRecord('wikidata', qid, { qid, label: b.itemLabel?.value, modified: b.modified?.value, coord: b.coord?.value }, {
        name: b.itemLabel?.value,
        source_url: b.item!.value, // the canonical Wikidata entity URI
        updated_at: b.modified?.value,
        lng: m ? Number(m[1]) : undefined,
        lat: m ? Number(m[2]) : undefined,
        raw: b,
      });
    });
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/data-pipeline && npx vitest run test/envelope-source-url.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck the connector scripts**

Run: `cd apps/data-pipeline && npx tsc -b tsconfig.json`
Expected: no errors (confirms the `PulledRecord` change is consistent across all connectors).

- [ ] **Step 8: Commit**

```bash
git add apps/data-pipeline/scripts/connectors/core/types.ts apps/data-pipeline/scripts/connectors/core/fingerprint.ts apps/data-pipeline/scripts/connectors/tierA/sparql.ts apps/data-pipeline/test/envelope-source-url.test.ts
git commit -m "feat(data-pipeline): record source_url on the connector envelope"
```

---

## Task 3: Materialize a PulledRecord into a TravelRecord

**Files:**
- Create: `packages/pipeline-core/src/normalize/connector.ts`
- Modify: `packages/pipeline-core/src/index.ts` (export)
- Test: `apps/data-pipeline/test/normalize-connector.test.ts`

Background: `PulledRecord` is thinner than `TravelRecord` (no `subject`/`category`/h3 cells/`group_uuid`). This helper fills the parts derivable from the pull (`record_uuid`, `content_hash`, `source_url`, h3 cells from lat/lng) and takes `subject`/`category`/`lang` from a per-source mapping. `group_uuid`, `data_version`, `raw_r2_key` are added later by the orchestration (exactly like `osmElementToRecord` leaves them out — see `normalize/osm.ts`).

- [ ] **Step 1: Write the failing test**

Create `apps/data-pipeline/test/normalize-connector.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pulledToNormalized } from '@travel/pipeline-core';
import type { PulledRecord } from '../scripts/connectors/core/types.js';

const pr: PulledRecord = {
  source_id: 'Q570116',
  record_uuid: 'ruuid-1',
  content_hash: 'h1',
  source_url: 'https://www.wikidata.org/entity/Q570116',
  name: 'Penang Hill',
  lat: 5.4253,
  lng: 100.2685,
};

describe('pulledToNormalized', () => {
  it('builds a normalized record with derived h3 cells and carried fields', () => {
    const out = pulledToNormalized('wikidata', pr, { subject: 'poi', category: 'attraction' });
    expect(out).not.toBeNull();
    const { record } = out!;
    expect(record.subject).toBe('poi');
    expect(record.category).toBe('attraction');
    expect(record.name).toBe('Penang Hill');
    expect(record.source).toBe('wikidata');
    expect(record.source_id).toBe('Q570116');
    expect(record.source_url).toBe('https://www.wikidata.org/entity/Q570116');
    expect(record.content_hash).toBe('h1');
    expect(record.h3_r10.length).toBe(15);
    expect(record.h3_r7.length).toBe(15);
    expect(record.lang).toBe('en');
  });

  it('returns null when the record has no coordinates', () => {
    const noCoords: PulledRecord = { ...pr, lat: undefined, lng: undefined };
    expect(pulledToNormalized('wikidata', noCoords, { subject: 'poi', category: 'attraction' })).toBeNull();
  });

  it('returns null when the record has no name', () => {
    const noName: PulledRecord = { ...pr, name: undefined };
    expect(pulledToNormalized('wikidata', noName, { subject: 'poi', category: 'attraction' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/data-pipeline && npx vitest run test/normalize-connector.test.ts`
Expected: FAIL — `pulledToNormalized` is not exported from `@travel/pipeline-core`.

- [ ] **Step 3: Write the normalizer**

Create `packages/pipeline-core/src/normalize/connector.ts`:

```ts
import type { TravelRecord } from '../record.js';
import type { MatchSignals } from '../types.js';
import { deriveCells } from '../h3.js';

/** The shape every connector PulledRecord shares (kept local to avoid a scripts/ import). */
export interface PulledRecordLike {
  source_id: string;
  record_uuid: string;
  content_hash: string;
  source_url?: string;
  name?: string;
  lat?: number;
  lng?: number;
}

/** Per-source classification the pull cannot supply itself. */
export interface ConnectorMapping {
  subject: string;
  category: string;
  lang?: string;
  /** Optional ER signals (e.g. brand) when the source exposes them. */
  signals?: MatchSignals;
}

/** Fields a normalizer knows up front — the orchestration adds group_uuid/data_version/raw_r2_key. */
type NormalizedRecord = Omit<TravelRecord, 'group_uuid' | 'data_version' | 'raw_r2_key'>;

/**
 * Convert a connector PulledRecord into a normalized TravelRecord (minus the
 * fields the orchestration owns) plus ER match signals. Returns null when the
 * record lacks coordinates or a name — mirrors osmElementToRecord's contract.
 */
export function pulledToNormalized(
  connectorId: string,
  pr: PulledRecordLike,
  mapping: ConnectorMapping,
): { record: NormalizedRecord; signals: MatchSignals } | null {
  if (!pr.name) return null;
  if (typeof pr.lat !== 'number' || typeof pr.lng !== 'number') return null;

  const cells = deriveCells(pr.lat, pr.lng);
  const record: NormalizedRecord = {
    record_uuid: pr.record_uuid,
    subject: mapping.subject,
    category: mapping.category,
    name: pr.name,
    lat: pr.lat,
    lng: pr.lng,
    h3_r5: cells.h3_r5,
    h3_r7: cells.h3_r7,
    h3_r10: cells.h3_r10,
    attributes: '{}',
    source: connectorId,
    source_id: pr.source_id,
    source_url: pr.source_url ?? '',
    lang: mapping.lang ?? 'en',
    content_hash: pr.content_hash,
  };
  return { record, signals: mapping.signals ?? {} };
}
```

- [ ] **Step 4: Export it**

In `packages/pipeline-core/src/index.ts`, add after the `osmElementToRecord` export line:

```ts
export { osmElementToRecord } from './normalize/osm.js';
export { pulledToNormalized } from './normalize/connector.js';
export type { PulledRecordLike, ConnectorMapping } from './normalize/connector.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/data-pipeline && npx vitest run test/normalize-connector.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline-core/src/normalize/connector.ts packages/pipeline-core/src/index.ts apps/data-pipeline/test/normalize-connector.test.ts
git commit -m "feat(pipeline-core): pulledToNormalized — connector record -> TravelRecord"
```

---

## Task 4: Per-record diff classifier

**Files:**
- Create: `apps/data-pipeline/src/refresh/diff.ts`
- Test: `apps/data-pipeline/test/refresh-diff.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/data-pipeline/test/refresh-diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyRecords } from '../src/refresh/diff.js';

const rec = (uuid: string, hash: string) => ({ source_id: uuid, record_uuid: uuid, content_hash: hash });

describe('classifyRecords', () => {
  it('splits records into created / changed / unchanged by content_hash', () => {
    const prev = new Map([['a', 'h1'], ['b', 'h2']]); // a unchanged, b will change, c is new
    const pulled = [rec('a', 'h1'), rec('b', 'h2-new'), rec('c', 'h3')];
    const out = classifyRecords(pulled, prev);
    expect(out.created.map((r) => r.record_uuid)).toEqual(['c']);
    expect(out.changed.map((r) => r.record_uuid)).toEqual(['b']);
    expect(out.unchanged.map((r) => r.record_uuid)).toEqual(['a']);
  });

  it('treats everything as created when there is no prior state', () => {
    const out = classifyRecords([rec('x', 'h')], new Map());
    expect(out.created.length).toBe(1);
    expect(out.changed.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/data-pipeline && npx vitest run test/refresh-diff.test.ts`
Expected: FAIL — `Cannot find module '../src/refresh/diff.js'`.

- [ ] **Step 3: Write the classifier**

Create `apps/data-pipeline/src/refresh/diff.ts`:

```ts
/** A minimal record shape for diffing — every PulledRecord satisfies it. */
export interface DiffableRecord {
  record_uuid: string;
  content_hash: string;
}

export interface RecordDiff<T extends DiffableRecord> {
  created: T[];
  changed: T[];
  unchanged: T[];
}

/**
 * Classify each pulled record against prior content hashes:
 *  - not in prior         → created
 *  - in prior, hash moved  → changed
 *  - in prior, hash equal   → unchanged
 */
export function classifyRecords<T extends DiffableRecord>(
  pulled: T[],
  prevHashByUuid: Map<string, string>,
): RecordDiff<T> {
  const created: T[] = [];
  const changed: T[] = [];
  const unchanged: T[] = [];
  for (const r of pulled) {
    const prev = prevHashByUuid.get(r.record_uuid);
    if (prev === undefined) created.push(r);
    else if (prev !== r.content_hash) changed.push(r);
    else unchanged.push(r);
  }
  return { created, changed, unchanged };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/data-pipeline && npx vitest run test/refresh-diff.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/data-pipeline/src/refresh/diff.ts apps/data-pipeline/test/refresh-diff.test.ts
git commit -m "feat(data-pipeline): per-record content_hash diff classifier"
```

---

## Task 5: Merge changed records into an r7 blob

**Files:**
- Create: `packages/pipeline-core/src/serving/blob-merge.ts`
- Modify: `packages/pipeline-core/src/index.ts` (export)
- Test: `apps/data-pipeline/test/blob-merge.test.ts`

Background: `buildGroupBlobs` (in `serving/blob-builder.ts`) writes a blob body `{ h3_r7, data_version, records }` and **rebuilds the whole blob**. Incremental refresh must instead read the existing blob and upsert only the changed records by `record_uuid`, so unchanged records survive (enrich's `loadRecord` finds records by `record_uuid` inside this blob).

- [ ] **Step 1: Write the failing test**

Create `apps/data-pipeline/test/blob-merge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeIntoR7Blob, type TravelRecord } from '@travel/pipeline-core';

const rec = (uuid: string, name: string): TravelRecord => ({
  record_uuid: uuid, group_uuid: 'g', subject: 'poi', category: 'attraction', name,
  lat: 5, lng: 100, h3_r5: 'r5', h3_r7: 'R7', h3_r10: 'r10', attributes: '{}',
  source: 'wikidata', source_id: uuid, source_url: 'u', raw_r2_key: '', lang: 'en',
  content_hash: 'h-' + name, data_version: 2,
});

describe('mergeIntoR7Blob', () => {
  it('preserves unchanged, replaces changed, and adds new records', () => {
    const existing = JSON.stringify({ h3_r7: 'R7', data_version: 1, records: [rec('A', 'a'), rec('B', 'b')] });
    const body = mergeIntoR7Blob(existing, 'R7', [rec('B', 'b2'), rec('C', 'c')], 2);
    const parsed = JSON.parse(body) as { h3_r7: string; data_version: number; records: TravelRecord[] };
    expect(parsed.h3_r7).toBe('R7');
    expect(parsed.data_version).toBe(2);
    const byUuid = new Map(parsed.records.map((r) => [r.record_uuid, r.name]));
    expect(byUuid.get('A')).toBe('a');   // preserved
    expect(byUuid.get('B')).toBe('b2');  // replaced
    expect(byUuid.get('C')).toBe('c');   // added
    expect(parsed.records.length).toBe(3);
  });

  it('starts from empty when there is no existing blob', () => {
    const body = mergeIntoR7Blob(null, 'R7', [rec('A', 'a')], 2);
    const parsed = JSON.parse(body) as { records: TravelRecord[] };
    expect(parsed.records.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/data-pipeline && npx vitest run test/blob-merge.test.ts`
Expected: FAIL — `mergeIntoR7Blob` is not exported from `@travel/pipeline-core`.

- [ ] **Step 3: Write the merge function**

Create `packages/pipeline-core/src/serving/blob-merge.ts`:

```ts
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
```

- [ ] **Step 4: Export it**

In `packages/pipeline-core/src/index.ts`, update the blob-builder export line to add the merge:

```ts
export { bucketByR7, buildGroupBlobs } from './serving/blob-builder.js';
export { mergeIntoR7Blob } from './serving/blob-merge.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/data-pipeline && npx vitest run test/blob-merge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline-core/src/serving/blob-merge.ts packages/pipeline-core/src/index.ts apps/data-pipeline/test/blob-merge.test.ts
git commit -m "feat(pipeline-core): mergeIntoR7Blob — incremental read-modify-write blob merge"
```

---

## Task 6: The refresh orchestration

**Files:**
- Create: `apps/data-pipeline/src/refresh/run-refresh.ts`
- Test: `apps/data-pipeline/test/run-refresh.integration.test.ts`

This ties Tasks 1–5 together. It is connector-agnostic: it accepts any `SourceConnector` plus a per-source `ConnectorMapping`, and an injectable env so tests can supply a fake `ENRICH` queue (the vitest miniflare config has D1 `GROUPS` + R2 `DATA` but no queue binding).

- [ ] **Step 1: Write the failing integration test**

Create `apps/data-pipeline/test/run-refresh.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import groupsSql from '../migrations/0001_groups.sql?raw';
import refreshSql from '../migrations/0004_refresh.sql?raw';
import { defineConnector } from '../scripts/connectors/core/connector.js';
import type { PulledRecord } from '../scripts/connectors/core/types.js';
import { mkRecord, sourceFp } from '../scripts/connectors/core/fingerprint.js';
import { runRefreshSource, type RefreshEnv } from '../src/refresh/run-refresh.js';
import type { EnrichMessage } from '../src/env.js';

async function apply(sql: string) {
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await env.GROUPS.prepare(stmt).run();
}
beforeAll(async () => {
  await apply(groupsSql);
  await apply(refreshSql);
});

// A deterministic fake connector whose records + fingerprint we control per run.
function fakeConnector(records: PulledRecord[], fingerprintValue: string) {
  return defineConnector({
    id: 'fake',
    displayName: 'Fake',
    tier: 'A',
    coverage: 'test',
    plan: { access: 'test', incremental: 'full-only', fingerprint: 'content-hash' },
    async run() {
      return {
        status: 'ok' as const,
        sourceFingerprint: { method: 'content-hash', value: fingerprintValue, capturedAt: '2026-06-16T00:00:00Z' },
        incremental: { method: 'full-only' as const, supported: true, description: 'test' },
        records,
      };
    },
  });
}

const MAPPING = { subject: 'poi', category: 'attraction' as const };
function captureEnrich() {
  const sent: EnrichMessage[] = [];
  const refreshEnv: RefreshEnv = {
    DATA: env.DATA,
    GROUPS: env.GROUPS,
    ENRICH: { async sendBatch(msgs) { for (const m of msgs) sent.push(m.body); } },
  };
  return { sent, refreshEnv };
}
const CTX = { dataVersion: 2, nowIso: '2026-06-16T00:00:00Z', runId: 'run-1' };

describe('runRefreshSource', () => {
  it('first run: all records are new, blob written, enrich enqueued, snapshot saved', async () => {
    const rec = mkRecord('fake', 'P1', { v: 1 }, { name: 'Place 1', lat: 5.42, lng: 100.27, source_url: 'http://x/P1' });
    const { sent, refreshEnv } = captureEnrich();
    const summary = await runRefreshSource(refreshEnv, fakeConnector([rec], 'fp-1'), MAPPING, CTX);

    expect(summary.skipped).toBe(false);
    expect(summary.created).toBe(1);
    expect(summary.enqueued).toBe(1);
    expect(sent[0]!.source).toBe('fake');

    // Blob exists and contains the record.
    const h3_r7 = sent[0]!.h3_r7;
    const blob = await refreshEnv.DATA.get(`groups/r7/${h3_r7}`);
    expect(blob).not.toBeNull();
    const parsed = JSON.parse(await blob!.text());
    expect(parsed.records.some((r: any) => r.source_url === 'http://x/P1')).toBe(true);
  });

  it('second run, unchanged fingerprint: skips entirely (no enqueue)', async () => {
    const rec = mkRecord('fake', 'P1', { v: 1 }, { name: 'Place 1', lat: 5.42, lng: 100.27, source_url: 'http://x/P1' });
    // Prime snapshot with the same fingerprint the connector will report.
    const { refreshEnv } = captureEnrich();
    await runRefreshSource(refreshEnv, fakeConnector([rec], 'fp-stable'), MAPPING, { ...CTX, runId: 'prime' });

    const { sent, refreshEnv: env2 } = captureEnrich();
    const summary = await runRefreshSource(env2, fakeConnector([rec], 'fp-stable'), MAPPING, { ...CTX, runId: 'run-2' });
    expect(summary.skipped).toBe(true);
    expect(summary.enqueued).toBe(0);
    expect(sent.length).toBe(0);
  });

  it('changed record: only the changed record is enqueued, blob preserves the unchanged one', async () => {
    const a1 = mkRecord('fake', 'A', { v: 1 }, { name: 'A', lat: 5.42, lng: 100.27, source_url: 'http://x/A' });
    const b1 = mkRecord('fake', 'B', { v: 1 }, { name: 'B', lat: 5.42, lng: 100.27, source_url: 'http://x/B' });
    const { refreshEnv } = captureEnrich();
    await runRefreshSource(refreshEnv, fakeConnector([a1, b1], 'fp-A'), MAPPING, { ...CTX, runId: 'r1' });

    // B changes content (new hash), A stays; source fingerprint must move too or we'd skip.
    const b2 = mkRecord('fake', 'B', { v: 2 }, { name: 'B2', lat: 5.42, lng: 100.27, source_url: 'http://x/B' });
    const { sent, refreshEnv: env2 } = captureEnrich();
    const summary = await runRefreshSource(env2, fakeConnector([a1, b2], 'fp-B'), MAPPING, { ...CTX, runId: 'r2' });

    expect(summary.changed).toBe(1);
    expect(summary.created).toBe(0);
    expect(summary.enqueued).toBe(1);
    expect(sent.map((m) => m.record_uuid)).toEqual([b2.record_uuid]);

    const blob = await env2.DATA.get(`groups/r7/${sent[0]!.h3_r7}`);
    const parsed = JSON.parse(await blob!.text());
    const names = parsed.records.map((r: any) => r.name).sort();
    expect(names).toEqual(['A', 'B2']); // A preserved, B replaced
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/data-pipeline && npx vitest run test/run-refresh.integration.test.ts`
Expected: FAIL — `Cannot find module '../src/refresh/run-refresh.js'`.

- [ ] **Step 3: Write the orchestration**

Create `apps/data-pipeline/src/refresh/run-refresh.ts`:

```ts
import {
  pulledToNormalized,
  mergeIntoR7Blob,
  aliasFor,
  type TravelRecord,
  type ConnectorMapping,
} from '@travel/pipeline-core';
import type { SourceConnector } from '../../scripts/connectors/core/types.js';
import { D1GroupRegistry } from '../registry-d1.js';
import { SourceSnapshotStore, RecordStateStore, type ObservedRecord } from './refresh-d1.js';
import { classifyRecords } from './diff.js';
import type { EnrichMessage } from '../env.js';

/** Minimal env so tests can inject a fake ENRICH queue (miniflare has no queue binding). */
export interface RefreshEnv {
  DATA: R2Bucket;
  GROUPS: D1Database;
  ENRICH: { sendBatch(msgs: { body: EnrichMessage }[]): Promise<void> };
}

export interface RefreshContext {
  dataVersion: number;
  nowIso: string;
  runId: string;
  /** Per-connector timeout passed to deps; default 25s. */
  timeoutMs?: number;
}

export interface RefreshSummary {
  source: string;
  skipped: boolean;
  created: number;
  changed: number;
  unchanged: number;
  enqueued: number;
}

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Response(text).body!.pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

export async function runRefreshSource(
  env: RefreshEnv,
  connector: SourceConnector,
  mapping: ConnectorMapping,
  ctx: RefreshContext,
): Promise<RefreshSummary> {
  const snapshots = new SourceSnapshotStore(env.GROUPS);
  const recordState = new RecordStateStore(env.GROUPS);
  const prior = await snapshots.get(connector.id);

  // (1) Pull — feed prior since/fingerprint/cursor for incremental + skip.
  const result = await connector.pull(
    { sinceTimestamp: prior?.since_ts ?? undefined, lastSnapshotFingerprint: prior?.fingerprint_value ?? undefined, cursor: prior?.cursor ?? undefined },
    { fetch: globalThis.fetch, env: {}, log: () => {}, timeoutMs: ctx.timeoutMs ?? 25_000 },
  );

  // (2) Cheap source-level skip.
  if (result.unchangedSinceSnapshot) {
    await snapshots.markUnchanged(connector.id, ctx.nowIso);
    return { source: connector.id, skipped: true, created: 0, changed: 0, unchanged: result.recordCount, enqueued: 0 };
  }

  // (3) Per-record diff against stored hashes.
  const prevHashes = await recordState.hashesForSource(connector.id);
  const diff = classifyRecords(result.records, prevHashes);
  const toMaterialize = [...diff.created, ...diff.changed];

  // (4) Materialize changed records -> TravelRecord (+ entity resolution).
  const registry = new D1GroupRegistry(env.GROUPS);
  const changedRecords: TravelRecord[] = [];
  for (const pr of toMaterialize) {
    const norm = pulledToNormalized(connector.id, pr, mapping);
    if (norm === null) continue; // no coords / no name — cannot place on the map
    const alias = aliasFor(
      { subject: norm.record.subject, category: norm.record.category, name: norm.record.name, record_uuid: norm.record.record_uuid },
      norm.signals,
    );
    const group_uuid = await registry.resolve(alias.key, { subject: norm.record.subject, kind: alias.kind, canonical_name: alias.name });
    changedRecords.push({ ...norm.record, group_uuid, raw_r2_key: '', data_version: ctx.dataVersion });
  }

  // (5) Merge into per-r7 blobs (read-modify-write; unchanged records survive).
  const byR7 = new Map<string, TravelRecord[]>();
  for (const r of changedRecords) {
    const arr = byR7.get(r.h3_r7);
    if (arr) arr.push(r); else byR7.set(r.h3_r7, [r]);
  }
  for (const [h3_r7, recs] of byR7) {
    const key = `groups/r7/${h3_r7}`;
    const existing = await env.DATA.get(key);
    const body = mergeIntoR7Blob(existing ? await existing.text() : null, h3_r7, recs, ctx.dataVersion);
    await env.DATA.put(key, body, { httpMetadata: { contentType: 'application/json' } });
  }

  // (6) Append a replayable lake delta (gzipped NDJSON at a unique key).
  if (changedRecords.length > 0) {
    const subject = changedRecords[0]!.subject;
    const ndjson = changedRecords.map((r) => JSON.stringify(r)).join('\n') + '\n';
    await env.DATA.put(
      `lake/${subject}/${connector.id}/v${ctx.dataVersion}/delta-${ctx.runId}.ndjson.gz`,
      await gzip(ndjson),
      { httpMetadata: { contentEncoding: 'gzip', contentType: 'application/x-ndjson' } },
    );
  }

  // (7) Enqueue ONLY changed records onto the existing enrich queue.
  const messages = changedRecords.map((r) => ({ body: { record_uuid: r.record_uuid, h3_r7: r.h3_r7, source: connector.id } }));
  for (let i = 0; i < messages.length; i += 100) await env.ENRICH.sendBatch(messages.slice(i, i + 100));

  // (8) Persist record_state (all observed) + new snapshot.
  const observed: ObservedRecord[] = result.records.map((pr) => ({
    record_uuid: pr.record_uuid, source: connector.id, source_url: pr.source_url ?? '', content_hash: pr.content_hash,
  }));
  await recordState.upsertObserved(observed, ctx.nowIso);
  await snapshots.save({
    source: connector.id,
    fingerprint_method: result.sourceFingerprint.method,
    fingerprint_value: result.sourceFingerprint.value,
    cursor: result.cursor ?? null,
    since_ts: ctx.nowIso,
    last_run_at: ctx.nowIso,
    last_status: result.status,
  });

  return {
    source: connector.id, skipped: false,
    created: diff.created.length, changed: diff.changed.length, unchanged: diff.unchanged.length,
    enqueued: messages.length,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/data-pipeline && npx vitest run test/run-refresh.integration.test.ts`
Expected: PASS (3 tests).

> If the import of `aliasFor` / `ConnectorMapping` fails typecheck, confirm they are exported from `@travel/pipeline-core` (Task 3 added `ConnectorMapping`; `aliasFor` is exported via `grouping/alias.js` in `index.ts`).

- [ ] **Step 5: Commit**

```bash
git add apps/data-pipeline/src/refresh/run-refresh.ts apps/data-pipeline/test/run-refresh.integration.test.ts
git commit -m "feat(data-pipeline): runRefreshSource — fingerprint skip + per-record diff -> merge -> enrich"
```

---

## Task 7: Manual `POST /refresh` trigger

**Files:**
- Modify: `apps/data-pipeline/src/index.ts`
- Test: `apps/data-pipeline/test/refresh-handler.test.ts`

We expose an authenticated `POST /refresh` so the loop is runnable end-to-end via `curl` without enabling cron (consistent with the existing `POST /ingest` + intentionally-empty `"crons": []` convention noted in `wrangler.jsonc`). Phase 1 wires exactly one real connector: `wikidata`.

- [ ] **Step 1: Write the failing handler test**

Create `apps/data-pipeline/test/refresh-handler.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';

const baseEnv = {
  INGEST_TOKEN: 'secret-token',
} as any;

describe('POST /refresh auth', () => {
  it('401s without a valid bearer token', async () => {
    const res = await worker.fetch(new Request('https://x/refresh', { method: 'POST', body: '{}' }), baseEnv);
    expect(res.status).toBe(401);
  });

  it('400s on an unknown source', async () => {
    const res = await worker.fetch(
      new Request('https://x/refresh', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret-token', 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'not-a-real-connector' }),
      }),
      baseEnv,
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/data-pipeline && npx vitest run test/refresh-handler.test.ts`
Expected: FAIL — `POST /refresh` currently returns 404, so the 401/400 assertions fail.

- [ ] **Step 3: Add the route**

In `apps/data-pipeline/src/index.ts`:

(a) Add imports near the top (after the existing imports):

```ts
import { runRefreshSource } from './refresh/run-refresh.js';
import { wikidata } from '../scripts/connectors/tierA/sparql.js';
import type { SourceConnector } from '../scripts/connectors/core/types.js';
import type { ConnectorMapping } from '@travel/pipeline-core';
```

(b) Add a Phase-1 connector registry above `export default` (NEVER import `ALL_CONNECTORS` — it pulls in Playwright):

```ts
// Phase 1 wires API connectors only, imported individually to keep Playwright
// (browser/strategies.ts) out of the Worker bundle.
const REFRESH_SOURCES: Record<string, { connector: SourceConnector; mapping: ConnectorMapping }> = {
  wikidata: { connector: wikidata, mapping: { subject: 'poi', category: 'attraction' } },
};
```

(c) Inside `fetch`, after the `/ingest` block and before the final `return new Response('not found', …)`, add:

```ts
    if (request.method === 'POST' && url.pathname === '/refresh') {
      const ingestToken = env.INGEST_TOKEN;
      if (!ingestToken) return new Response('unauthorized', { status: 401 });
      const authHeader = request.headers.get('Authorization') ?? '';
      if (!authHeader.startsWith('Bearer ')) return new Response('unauthorized', { status: 401 });
      if (!(await timingSafeEqual(authHeader.slice('Bearer '.length), ingestToken))) {
        return new Response('unauthorized', { status: 401 });
      }

      const body = (await request.json().catch(() => ({}))) as { source?: string };
      const entry = body.source ? REFRESH_SOURCES[body.source] : undefined;
      if (!entry) return new Response('bad request: unknown source', { status: 400 });

      const summary = await runRefreshSource(
        { DATA: env.DATA, GROUPS: env.GROUPS, ENRICH: env.ENRICH },
        entry.connector,
        entry.mapping,
        { dataVersion: Number(env.DATA_VERSION), nowIso: new Date().toISOString(), runId: crypto.randomUUID() },
      );
      return Response.json(summary, { status: 200 });
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/data-pipeline && npx vitest run test/refresh-handler.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify no Playwright leaked into the Worker bundle**

Run: `cd apps/data-pipeline && npx tsc -b tsconfig.json`
Expected: no errors. Then dry-run the bundle:
Run: `cd apps/data-pipeline && npx wrangler deploy --dry-run --outdir /tmp/refresh-bundle`
Expected: build succeeds with no `playwright` resolution errors. If it fails resolving `playwright`, an import path reached `browser/strategies.ts` — check that only `tierA/sparql.js` (and its `core/*` deps) are imported, never `core/registry.js` or `core/fallback.js`.

- [ ] **Step 6: Commit**

```bash
git add apps/data-pipeline/src/index.ts apps/data-pipeline/test/refresh-handler.test.ts
git commit -m "feat(data-pipeline): authenticated POST /refresh manual trigger (wikidata)"
```

---

## Task 8: Full-suite verification + docs

**Files:**
- Modify: `apps/data-pipeline/src/pool/README.md` (or create `apps/data-pipeline/src/refresh/README.md`)

- [ ] **Step 1: Run the entire data-pipeline test suite**

Run: `cd apps/data-pipeline && npx vitest run`
Expected: all suites PASS, including the pre-existing pool/ingest/enrich tests (no regressions).

- [ ] **Step 2: Typecheck the whole workspace**

Run (from repo root): `pnpm -r typecheck` (or `cd apps/data-pipeline && npx tsc -b tsconfig.json`)
Expected: no errors.

- [ ] **Step 3: Write a short refresh README**

Create `apps/data-pipeline/src/refresh/README.md`:

```markdown
# Connector refresh loop (Phase 1)

Re-scrapes earlier data on demand and ingests only what changed.

- `POST /refresh` `{ "source": "wikidata" }` (Bearer INGEST_TOKEN) runs one source.
- Two-level change detection: `source_snapshot` (per-source fingerprint skip) +
  `record_state` (per-record content_hash diff). See migration `0004_refresh.sql`.
- Only changed records are merged into `groups/r7/<h3_r7>` blobs (read-modify-write,
  via `mergeIntoR7Blob`) and enqueued onto the existing `ENRICH` queue → Vectorize.
- Cron stays disabled (`wrangler.jsonc` `"crons": []`) during prototyping, matching
  the ingest convention; trigger manually via `POST /refresh`.

Phase 2 (browser connectors via the device pool + server-side DOM extractor) and
Phase 3 (deletions/tombstones, cadence, observability, lake compaction) are separate.
See `docs/superpowers/specs/2026-06-16-connector-refresh-loop-design.md`.
```

- [ ] **Step 4: Commit**

```bash
git add apps/data-pipeline/src/refresh/README.md
git commit -m "docs(data-pipeline): connector refresh loop Phase 1 README"
```

---

## Self-Review

**1. Spec coverage (Phase 1 rows of spec §13):**
- "`source_url` on the envelope" → Task 2. ✓
- "two D1 tables" → Task 1 (`source_snapshot`, `record_state`). ✓
- "refresh cycle for API connectors only" → Task 6 (`runRefreshSource`) + Task 7 (wired to `wikidata`). ✓
- "downstream merge" → Task 5 (`mergeIntoR7Blob`) + Task 6 step (5). ✓
- "enrich wiring" → Task 6 step (7) enqueues onto the existing `ENRICH` queue; `enrichBatch` is unchanged. ✓
- "cron" → intentionally left disabled (Task 7/8) per the established `wrangler.jsonc` convention + project memory; manual `POST /refresh` is the Phase-1 trigger. This is a deliberate scoping decision, documented in the README. ✓
- Record-the-URL flows end to end: `PulledRecord.source_url` (Task 2) → `pulledToNormalized` sets `TravelRecord.source_url` (Task 3) → persisted in `record_state` and in the r7 blob (Task 6). ✓
- Two-level detection: source fingerprint skip (Task 6 step 2) + per-record diff (Task 4 + Task 6 step 3). ✓

**2. Placeholder scan:** No "TBD/handle errors/etc." — every code step is complete. The lake-delta `gzip` helper is inlined (copied from `NdjsonR2LakeWriter`) rather than referenced abstractly.

**3. Type consistency:**
- `PulledRecord` gains `source_url?: string` (Task 2); `pulledToNormalized` reads it via the local `PulledRecordLike` (Task 3); `runRefreshSource` reads `pr.source_url` (Task 6). ✓
- Blob body shape `{ h3_r7, data_version, records }` is identical in `buildGroupBlobs` (existing), `mergeIntoR7Blob` (Task 5), and the test fixtures. ✓
- `EnrichMessage { record_uuid, h3_r7, source }` matches `src/env.ts` and what `runRefreshSource` enqueues. ✓
- `ConnectorMapping` is defined and exported in Task 3 and consumed in Tasks 6 & 7. ✓
- Store method names (`get`/`save`/`markUnchanged`/`hashesForSource`/`upsertObserved`) are identical across Task 1 definitions, tests, and Task 6 usage. ✓

**Known risk flagged for the implementer (not a gap):** Task 7 step 5 explicitly verifies the Worker bundle does not pull in Playwright via a connector import. If `tierA/sparql.ts`'s transitive imports (`core/web.js`, `core/fingerprint.js` → `node:crypto`) cause a bundling issue under `nodejs_compat`, isolate the wikidata pull behind a thin Worker-safe wrapper. This is the one integration-time unknown; everything else is unit-proven.
