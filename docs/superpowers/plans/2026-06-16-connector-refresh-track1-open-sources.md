# Connector Refresh — Track 1 (Open Sources on a Schedule) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the six open/keyless/fetch-based connectors into the Phase-1 refresh loop and drive them on a per-source cadence from the Worker's `scheduled()` handler — with cron left disabled by default.

**Architecture:** A new `src/refresh/sources.ts` registry imports the open connectors individually (never the Playwright/DuckDB-tainted `core/registry.ts`) and maps each to a `{subject, category}` + `cadenceHours`. A new `src/refresh/schedule.ts` adds a pure `isDue` check and a `runDueRefreshes` loop that runs only due sources via the existing `runRefreshSource`. `index.ts` consumes the registry for `POST /refresh` and calls `runDueRefreshes` from `scheduled()`.

**Tech Stack:** TypeScript, Cloudflare Workers (D1 + R2 + Queues + cron), Vitest with `@cloudflare/vitest-pool-workers`, `@travel/pipeline-core`.

Builds on Phase 1 (PR #6). Spec: `docs/superpowers/specs/2026-06-16-connector-refresh-track1-open-sources-design.md`.

---

## File Structure

**Create:**
- `apps/data-pipeline/src/refresh/sources.ts` — `REFRESH_SOURCES` registry + `RefreshSourceConfig`.
- `apps/data-pipeline/src/refresh/schedule.ts` — `isDue` + `runDueRefreshes`.
- Tests: `apps/data-pipeline/test/refresh-sources.test.ts`, `apps/data-pipeline/test/refresh-schedule.test.ts`.

**Modify:**
- `apps/data-pipeline/src/index.ts` — import `REFRESH_SOURCES` from the registry (drop the inline one-entry object + its now-unused imports); call `runDueRefreshes` from `scheduled()`.
- `apps/data-pipeline/tsconfig.json` — add the three new connector files to `include`.
- `apps/data-pipeline/wrangler.jsonc` — document the cron opt-in (keep `"crons": []`).
- `apps/data-pipeline/src/refresh/README.md` — note the open sources + scheduler + how to enable cron.

**Verified facts to rely on:**
- Connector exports: `wikidata`,`dbpedia` (`tierA/sparql.ts`); `wikipedia`,`wikivoyage` (`tierA/mediawiki.ts`); `geonames` (`tierA/geonames.ts`); `socrataUs` (`tierA/gov-open.ts`). Connector `.id`s: `wikidata`,`dbpedia`,`wikipedia`,`wikivoyage`,`geonames`,`socrata-us`.
- None of those four modules import Playwright/DuckDB (they import only `core/connector.ts`, `core/fingerprint.ts`, `core/web.ts`).
- `run-refresh.ts` exports `runRefreshSource` and `RefreshEnv`; `refresh-d1.ts` exports `SourceSnapshotStore` and `SnapshotRow`; `pipeline-core` exports `ConnectorMapping`. (All from Phase 1.)
- Tests run with `cd apps/data-pipeline && npx vitest run <file>`; migrations applied via `import sql from '../migrations/NNNN.sql?raw'` split on `;` in `beforeAll`.

---

## Task 1: Open-connector registry + rewire `POST /refresh`

**Files:**
- Create: `apps/data-pipeline/src/refresh/sources.ts`
- Modify: `apps/data-pipeline/tsconfig.json`
- Modify: `apps/data-pipeline/src/index.ts`
- Test: `apps/data-pipeline/test/refresh-sources.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/data-pipeline/test/refresh-sources.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { REFRESH_SOURCES } from '../src/refresh/sources.js';

describe('REFRESH_SOURCES registry', () => {
  it('registers the six open keyless connectors, keyed by connector.id', () => {
    expect(Object.keys(REFRESH_SOURCES).sort()).toEqual([
      'dbpedia', 'geonames', 'socrata-us', 'wikidata', 'wikipedia', 'wikivoyage',
    ]);
  });

  it('every entry has a matching connector id, a mapping, and a positive cadence', () => {
    for (const [id, cfg] of Object.entries(REFRESH_SOURCES)) {
      expect(cfg.connector.id).toBe(id);
      expect(cfg.mapping.subject).toBeTruthy();
      expect(cfg.mapping.category).toBeTruthy();
      expect(cfg.cadenceHours).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/data-pipeline && npx vitest run test/refresh-sources.test.ts`
Expected: FAIL — `Cannot find module '../src/refresh/sources.js'`.

- [ ] **Step 3: Create the registry**

Create `apps/data-pipeline/src/refresh/sources.ts`:

```ts
import type { SourceConnector } from '../../scripts/connectors/core/types.js';
import type { ConnectorMapping } from '@travel/pipeline-core';
import { wikidata, dbpedia } from '../../scripts/connectors/tierA/sparql.js';
import { wikipedia, wikivoyage } from '../../scripts/connectors/tierA/mediawiki.js';
import { geonames } from '../../scripts/connectors/tierA/geonames.js';
import { socrataUs } from '../../scripts/connectors/tierA/gov-open.js';

export interface RefreshSourceConfig {
  connector: SourceConnector;
  mapping: ConnectorMapping; // { subject, category }
  cadenceHours: number;      // minimum hours between refreshes
}

/**
 * Open, keyless, fetch-based connectors registered into the refresh loop, keyed
 * by connector.id so the registry key always matches the id used for snapshot /
 * record state. Imported INDIVIDUALLY — never via core/registry.ts — so
 * Playwright (browser/strategies.ts) and DuckDB (open-bulk-s3.ts) never enter
 * the Worker bundle. subject/category are best-effort defaults (PulledRecord
 * carries neither). All cadence 24h for the first cut.
 */
export const REFRESH_SOURCES: Record<string, RefreshSourceConfig> = {
  [wikidata.id]:   { connector: wikidata,   mapping: { subject: 'poi', category: 'attraction' }, cadenceHours: 24 },
  [dbpedia.id]:    { connector: dbpedia,    mapping: { subject: 'poi', category: 'attraction' }, cadenceHours: 24 },
  [wikipedia.id]:  { connector: wikipedia,  mapping: { subject: 'poi', category: 'attraction' }, cadenceHours: 24 },
  [wikivoyage.id]: { connector: wikivoyage, mapping: { subject: 'poi', category: 'attraction' }, cadenceHours: 24 },
  [geonames.id]:   { connector: geonames,   mapping: { subject: 'poi', category: 'place' },      cadenceHours: 24 },
  [socrataUs.id]:  { connector: socrataUs,  mapping: { subject: 'poi', category: 'poi' },        cadenceHours: 24 },
};
```

- [ ] **Step 4: Add the new connector files to the Worker tsconfig**

In `apps/data-pipeline/tsconfig.json`, extend the `include` array so the newly-imported connector modules type-check into the Worker build. Replace the current `include` with:

```json
  "include": [
    "src/**/*.ts",
    "test/**/*.ts",
    "scripts/connectors/core/types.ts",
    "scripts/connectors/core/connector.ts",
    "scripts/connectors/core/fingerprint.ts",
    "scripts/connectors/core/web.ts",
    "scripts/connectors/tierA/sparql.ts",
    "scripts/connectors/tierA/mediawiki.ts",
    "scripts/connectors/tierA/geonames.ts",
    "scripts/connectors/tierA/gov-open.ts"
  ]
```

- [ ] **Step 5: Rewire `index.ts` to use the registry**

In `apps/data-pipeline/src/index.ts`:

(a) Remove these three now-unused imports:
```ts
import { wikidata } from '../scripts/connectors/tierA/sparql.js';
import type { SourceConnector } from '../scripts/connectors/core/types.js';
import type { ConnectorMapping } from '@travel/pipeline-core';
```
and add this import alongside the existing `runRefreshSource` import:
```ts
import { REFRESH_SOURCES } from './refresh/sources.js';
```

(b) Delete the inline registry block (the comment + the one-entry `REFRESH_SOURCES`):
```ts
// Phase 1 wires API connectors only, imported individually to keep Playwright
// (browser/strategies.ts) out of the Worker bundle.
const REFRESH_SOURCES: Record<string, { connector: SourceConnector; mapping: ConnectorMapping }> = {
  wikidata: { connector: wikidata, mapping: { subject: 'poi', category: 'attraction' } },
};
```

The `POST /refresh` handler body is unchanged — it already does `REFRESH_SOURCES[body.source]`, which now resolves against the imported registry.

- [ ] **Step 6: Run the registry test + typecheck**

Run: `cd apps/data-pipeline && npx vitest run test/refresh-sources.test.ts && npx tsc -b tsconfig.json`
Expected: registry test PASS (2 tests); `tsc` exits 0 (confirms the four connector modules compile into the Worker).

- [ ] **Step 7: Confirm the existing refresh-handler test still passes**

Run: `cd apps/data-pipeline && npx vitest run test/refresh-handler.test.ts`
Expected: PASS (2 tests) — unknown-source still 400s, auth still enforced.

- [ ] **Step 8: Commit**

```bash
git add apps/data-pipeline/src/refresh/sources.ts apps/data-pipeline/tsconfig.json apps/data-pipeline/src/index.ts apps/data-pipeline/test/refresh-sources.test.ts
git commit -m "feat(data-pipeline): register open keyless connectors in refresh registry"
```

---

## Task 2: Due-check + `runDueRefreshes`

**Files:**
- Create: `apps/data-pipeline/src/refresh/schedule.ts`
- Test: `apps/data-pipeline/test/refresh-schedule.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/data-pipeline/test/refresh-schedule.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import refreshSql from '../migrations/0004_refresh.sql?raw';
import { isDue, runDueRefreshes } from '../src/refresh/schedule.js';
import { SourceSnapshotStore, type SnapshotRow } from '../src/refresh/refresh-d1.js';
import type { RefreshSourceConfig } from '../src/refresh/sources.js';

beforeAll(async () => {
  for (const stmt of refreshSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.GROUPS.prepare(stmt).run();
  }
});

const NOW = '2026-06-16T12:00:00Z';
const snap = (last_run_at: string | null): SnapshotRow => ({
  source: 's', fingerprint_method: null, fingerprint_value: null, cursor: null,
  since_ts: null, last_run_at, last_status: 'ok',
});

describe('isDue', () => {
  it('is due when there is no snapshot', () => {
    expect(isDue(null, 24, NOW)).toBe(true);
  });
  it('is due when last_run_at is older than the cadence', () => {
    expect(isDue(snap('2026-06-15T00:00:00Z'), 24, NOW)).toBe(true); // 36h old, cadence 24h
  });
  it('is not due when last_run_at is within the cadence', () => {
    expect(isDue(snap('2026-06-16T06:00:00Z'), 24, NOW)).toBe(false); // 6h old
  });
});

describe('runDueRefreshes', () => {
  function fakeConnector(id: string): RefreshSourceConfig['connector'] {
    return {
      id, displayName: id, tier: 'A', coverage: '',
      plan: { access: '', incremental: '', fingerprint: '' },
      async pull() { return {} as never; },
    };
  }
  const sources: Record<string, RefreshSourceConfig> = {
    'src-fresh': { connector: fakeConnector('src-fresh'), mapping: { subject: 'poi', category: 'poi' }, cadenceHours: 24 },
    'src-due':   { connector: fakeConnector('src-due'),   mapping: { subject: 'poi', category: 'poi' }, cadenceHours: 24 },
  };

  it('runs only the due sources, sequentially', async () => {
    const snapshots = new SourceSnapshotStore(env.GROUPS);
    // src-fresh ran 1h ago (not due). src-due has no snapshot (due).
    await snapshots.save({ ...snap('2026-06-16T11:00:00Z'), source: 'src-fresh', fingerprint_value: 'x', since_ts: NOW });

    const ran: string[] = [];
    const stubRunner = (async (_env, connector) => {
      ran.push(connector.id);
      return { source: connector.id, skipped: false, created: 0, changed: 0, unchanged: 0, enqueued: 0 };
    }) as typeof import('../src/refresh/run-refresh.js').runRefreshSource;

    const results = await runDueRefreshes(
      { DATA: env.DATA, GROUPS: env.GROUPS, ENRICH: { async sendBatch() {} } },
      sources,
      { dataVersion: 1, nowIso: NOW },
      stubRunner,
    );

    expect(ran).toEqual(['src-due']);
    expect(results.find((r) => r.source === 'src-fresh')?.ran).toBe(false);
    expect(results.find((r) => r.source === 'src-due')?.ran).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/data-pipeline && npx vitest run test/refresh-schedule.test.ts`
Expected: FAIL — `Cannot find module '../src/refresh/schedule.js'`.

- [ ] **Step 3: Write the scheduler logic**

Create `apps/data-pipeline/src/refresh/schedule.ts`:

```ts
import { runRefreshSource, type RefreshEnv } from './run-refresh.js';
import { SourceSnapshotStore, type SnapshotRow } from './refresh-d1.js';
import type { RefreshSourceConfig } from './sources.js';

/**
 * A source is due when it was never run, has no parseable last-run time, or its
 * last run is at least cadenceHours old. Pure — caller supplies nowIso.
 */
export function isDue(snapshot: SnapshotRow | null, cadenceHours: number, nowIso: string): boolean {
  if (!snapshot || !snapshot.last_run_at) return true;
  const last = Date.parse(snapshot.last_run_at);
  if (Number.isNaN(last)) return true;
  const ageHours = (Date.parse(nowIso) - last) / 3_600_000;
  return ageHours >= cadenceHours;
}

export interface DueResult {
  source: string;
  ran: boolean;
}

/**
 * Refresh every due source in `sources`, sequentially, returning one
 * {source, ran} per source. `runRefresh` is injectable so tests can stub it.
 */
export async function runDueRefreshes(
  env: RefreshEnv,
  sources: Record<string, RefreshSourceConfig>,
  opts: { dataVersion: number; nowIso: string },
  runRefresh: typeof runRefreshSource = runRefreshSource,
): Promise<DueResult[]> {
  const snapshots = new SourceSnapshotStore(env.GROUPS);
  const out: DueResult[] = [];
  for (const [id, cfg] of Object.entries(sources)) {
    const snap = await snapshots.get(id);
    if (!isDue(snap, cfg.cadenceHours, opts.nowIso)) {
      out.push({ source: id, ran: false });
      continue;
    }
    await runRefresh(env, cfg.connector, cfg.mapping, {
      dataVersion: opts.dataVersion,
      nowIso: opts.nowIso,
      runId: crypto.randomUUID(),
    });
    out.push({ source: id, ran: true });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/data-pipeline && npx vitest run test/refresh-schedule.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/data-pipeline/src/refresh/schedule.ts apps/data-pipeline/test/refresh-schedule.test.ts
git commit -m "feat(data-pipeline): due-based refresh scheduler (isDue + runDueRefreshes)"
```

---

## Task 3: Wire `scheduled()` + document the cron opt-in

**Files:**
- Modify: `apps/data-pipeline/src/index.ts`
- Modify: `apps/data-pipeline/wrangler.jsonc`

No new test: `scheduled()` is thin glue over `runDueRefreshes` (fully unit-tested in Task 2) and `env.INGEST.create` (the existing OSM path). A direct `scheduled()` test would require mocking the `INGEST` Workflow binding, which miniflare does not provide in this project's test config — it adds brittleness without covering new logic. Verification is `tsc -b` + the full suite + a `wrangler deploy --dry-run` in Task 4.

- [ ] **Step 1: Add the refresh iteration to `scheduled()`**

In `apps/data-pipeline/src/index.ts`, add the import alongside the other `./refresh/*` imports:

```ts
import { runDueRefreshes } from './refresh/schedule.js';
```

Then replace the existing `scheduled` handler:

```ts
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const dataVersion = Number(env.DATA_VERSION);
    ctx.waitUntil(
      Promise.all(
        CRON_REGIONS.map((r) => env.INGEST.create({ params: { ...r, dataVersion } })),
      ).then(() => undefined),
    );
  },
```

with:

```ts
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const dataVersion = Number(env.DATA_VERSION);
    // (1) Existing OSM region re-ingest.
    ctx.waitUntil(
      Promise.all(
        CRON_REGIONS.map((r) => env.INGEST.create({ params: { ...r, dataVersion } })),
      ).then(() => undefined),
    );
    // (2) Refresh every open connector that is due (per-source cadence).
    ctx.waitUntil(
      runDueRefreshes(
        { DATA: env.DATA, GROUPS: env.GROUPS, ENRICH: env.ENRICH },
        REFRESH_SOURCES,
        { dataVersion, nowIso: new Date().toISOString() },
      ).then(() => undefined),
    );
  },
```

- [ ] **Step 2: Document the cron opt-in**

In `apps/data-pipeline/wrangler.jsonc`, replace the cron comment+trigger block:

```jsonc
  // Daily re-ingest of the seeded regions (scheduled handler in index.ts).
  // Disabled during initial testing to avoid surprise daily ingests; re-add "0 3 * * *" for production.
  "triggers": { "crons": [] },
```

with:

```jsonc
  // scheduled() does two things when a cron fires: re-ingest CRON_REGIONS (OSM)
  // and refresh every due open connector (REFRESH_SOURCES, per-source cadence).
  // Kept EMPTY by default: enabling starts real bge-m3 embedding + Vectorize
  // spend. To enable a daily 03:00 UTC run, set: "crons": ["0 3 * * *"].
  "triggers": { "crons": [] },
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/data-pipeline && npx tsc -b tsconfig.json`
Expected: exits 0.

- [ ] **Step 4: Run the full suite (no regressions)**

Run: `cd apps/data-pipeline && npx vitest run`
Expected: all suites PASS (the Phase-1 suites + the two new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/data-pipeline/src/index.ts apps/data-pipeline/wrangler.jsonc
git commit -m "feat(data-pipeline): refresh due open connectors from scheduled() (cron opt-in)"
```

---

## Task 4: Verification + docs

**Files:**
- Modify: `apps/data-pipeline/src/refresh/README.md`

- [ ] **Step 1: Confirm zero Playwright/DuckDB in the Worker bundle**

Run: `cd apps/data-pipeline && npx wrangler deploy --dry-run --outdir /tmp/refresh-track1-bundle`
Expected: build succeeds. Then confirm the bundle is clean:
Run: `grep -ril "playwright\|duckdb\|chromium" /tmp/refresh-track1-bundle || echo "CLEAN: no playwright/duckdb/chromium"`
Expected: `CLEAN: no playwright/duckdb/chromium`. (If the build fails resolving `playwright`/`duckdb`, an import reached `browser/strategies.ts` or `open-bulk-s3.ts` — re-check that `sources.ts` imports only `tierA/{sparql,mediawiki,geonames,gov-open}.ts`.)

- [ ] **Step 2: Update the refresh README**

In `apps/data-pipeline/src/refresh/README.md`, append:

```markdown

## Track 1 — open sources on a schedule

Six open, keyless connectors are registered in `sources.ts` and refresh on a per-source
cadence (24h): `wikidata`, `dbpedia`, `wikipedia`, `wikivoyage`, `geonames`, `socrata-us`.

- Manual: `POST /refresh {"source":"dbpedia"}` (Bearer INGEST_TOKEN) runs one source now.
- Scheduled: when a cron fires, `scheduled()` refreshes every **due** source via
  `runDueRefreshes` (`schedule.ts`). Cron is **disabled by default** (`wrangler.jsonc`
  `"crons": []`); enable a daily run with `"crons": ["0 3 * * *"]` — note this starts real
  embedding + Vectorize spend.

Browser/fallback + keyed/licensed sources are NOT here (they need the device pool / secrets) —
see Track 2 / Phase 2. The connector queries are prototype-grade samples; comprehensive
per-source pulls are a separate follow-up.
```

- [ ] **Step 3: Commit**

```bash
git add apps/data-pipeline/src/refresh/README.md
git commit -m "docs(data-pipeline): document Track 1 open-source refresh + cron opt-in"
```

---

## Self-Review

**1. Spec coverage (against the Track 1 design):**
- "Register every open connector with a `{subject, category}` mapping" → Task 1 (`sources.ts`, 6 connectors). ✓
- "Scheduler: cron tick refreshes due sources by per-source cadence, reusing `source_snapshot`" → Task 2 (`isDue` + `runDueRefreshes`) + Task 3 (`scheduled()` wiring). ✓
- "`POST /refresh {source}` keeps working for every registered source" → Task 1 Step 5 (handler now resolves against the imported registry) + Step 7 (regression test). ✓
- "Zero Playwright / zero DuckDB in the bundle" → Task 1 (individual imports) + Task 4 Step 1 (dry-run grep). ✓
- "Cron disabled by default; one-line opt-in" → Task 3 Step 2 (`"crons": []` + documented enable). ✓
- "Graceful `needs_key`/error no-op" → inherited from Phase-1 `runRefreshSource` (empty `records` ⇒ no enqueue); no new code needed; covered by design §6. ✓
- "Cadence 24h for all six" → Task 1 registry values. ✓

**2. Placeholder scan:** No "TBD/handle errors/etc." — every code step is complete. The decision to omit a direct `scheduled()` test is stated with its rationale (Task 3 header), not left as a vague gap.

**3. Type consistency:**
- `RefreshSourceConfig { connector, mapping, cadenceHours }` defined in Task 1, consumed identically in Task 2 (`schedule.ts`) and the Task 2 test. ✓
- `isDue(snapshot, cadenceHours, nowIso)` and `runDueRefreshes(env, sources, {dataVersion, nowIso}, runRefresh?)` signatures match between `schedule.ts`, its test, and the `scheduled()` call site (Task 3). ✓
- `runDueRefreshes` calls `runRefreshSource(env, connector, mapping, {dataVersion, nowIso, runId})` — matches the Phase-1 `RefreshContext` shape exactly. ✓
- `RefreshEnv {DATA, GROUPS, ENRICH}` (Phase 1) is what both the test and `scheduled()` construct. ✓
- Registry keyed by `[connector.id]` guarantees the Task 1 test's expected id list matches the verified `.id` strings. ✓
