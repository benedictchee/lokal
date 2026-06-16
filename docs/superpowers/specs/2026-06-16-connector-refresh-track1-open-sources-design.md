# Connector Refresh — Track 1: Open Sources on a Schedule — Design

> Status: **Draft for review** · Date: 2026-06-16 · Subsystem: `apps/data-pipeline`
> Author: brainstormed with Claude Code
> Follows: `2026-06-16-connector-refresh-loop-design.md` (Phase 1 shipped in PR #6)

## 1. Summary

Register the **open, keyless, fetch-based** connectors into the Phase-1 refresh loop and
drive them on a schedule, so free data sources refresh automatically through the existing
`runRefreshSource` → merge → enrich → Vectorize path. This broadens the refresh loop from a
single hand-wired connector (`wikidata`) to the full set of sources that can run on the
Worker today **without credentials and without Chrome**, and adds a cron-driven scheduler
that refreshes each source on its own cadence.

This is **Track 1** of "wire up the connectors." The browser/fallback coverage (the bulk of
the catalog) requires the device pool and is **Track 2 / Phase 2** — its own spec.

## 2. Goals / Non-goals

**Goals**
- Register every **open** (no API key, no license, not bulk-DuckDB) connector into the
  refresh loop with a `{subject, category}` mapping.
- Add a **scheduler**: a cron tick refreshes each registered source when it is **due**
  (per-source cadence), reusing the existing `source_snapshot` state for due-time.
- Keep `POST /refresh {source}` working for every newly-registered source (manual trigger).
- **Zero Playwright / zero DuckDB** in the Worker bundle (verified).

**Non-goals (this spec)**
- **No browser/fallback sources.** Anything whose path is Chrome (browser, browser+proxy, or
  an api-key/api-license source via its browser fallback) is Track 2 / Phase 2.
- **No keyed/licensed connectors** and **no secret-injection** mechanism (Track 2+). A source
  that unexpectedly needs a token degrades to `needs_key` and no-ops; it does not crash.
- **No comprehensive/global pull deepening.** The prototype connector queries are *samples*
  (small limits, narrow queries). Track 1 wires the plumbing + cadence; making any connector
  pull its full corpus (pagination/cursors, production queries) is separate per-connector work.
- **No enabling cron by default.** The scheduler is wired but `"crons": []` stays empty;
  enabling is an explicit one-line opt-in (cost/ToS reasons; matches the ingest convention).

## 3. Decisions captured (from brainstorming)

| Topic | Decision |
|-------|----------|
| Scope of "all" | Open/keyless/fetch-based connectors only; browser + bulk excluded (runtime-impossible) |
| Strategy | Free data: open now; browser/fallback deferred to Track 2 (device pool) |
| Sequencing | Track 1 now, then spec Track 2 |
| Scheduler runtime | Inline-in-cron, sequential, for the ~6 small sources (upgrade to queue/Workflow later) |
| Cron default | Disabled (`"crons": []`); explicit opt-in to enable |
| Keyed connectors | Out of scope; graceful `needs_key` no-op if a source needs a token |

## 4. The open set

Worker-runnable, keyless, fetch-based (classification `open` in `scripts/connectors/FINDINGS.md`):

| Connector id | Module | subject | category |
|--------------|--------|---------|----------|
| `wikidata` | `tierA/sparql.ts` | poi | attraction |
| `dbpedia` | `tierA/sparql.ts` | poi | attraction |
| `wikipedia` | `tierA/mediawiki.ts` | poi | attraction |
| `wikivoyage` | `tierA/mediawiki.ts` | poi | attraction |
| `geonames` | `tierA/geonames.ts` | poi | place |
| `socrata-us` | `tierA/gov-open.ts` | poi | poi |

**Excluded and why:**
- `overture`, `foursquare-os-places`, `osm-planet` — bulk DuckDB/S3/Geofabrik; DuckDB is a
  native module that cannot run in the Worker runtime.
- `datatourisme` — daily full CSV export (dump-diff); heavy, not a per-record fetch.
- `osm-overpass` — already served by the dedicated `IngestRegion` workflow + `POST /ingest`.
- `opentripmap` — needs `OPENTRIPMAP_KEY` (not open).

> Mapping values are best-effort defaults; `subject`/`category` are not encoded in
> `PulledRecord`, so they are assigned per connector here. They can be refined later without
> touching the loop.

**Cadence:** all six use `cadenceHours: 24` in Track 1 (one refresh/day max). Per-source
tuning is a later concern; a single default keeps the first cut simple.

## 5. Components

### 5.1 `src/refresh/sources.ts` (new)
The single registry of refreshable Worker-runnable sources. Imports each open connector
**individually** (never `core/registry.ts` / `ALL_CONNECTORS`, which pull in Playwright via
`browser/strategies.ts`).

```ts
export interface RefreshSourceConfig {
  connector: SourceConnector;
  mapping: ConnectorMapping;   // { subject, category }
  cadenceHours: number;        // minimum hours between refreshes
}
export const REFRESH_SOURCES: Record<string, RefreshSourceConfig> = { /* the 6 above */ };
```

`index.ts` imports `REFRESH_SOURCES` from here (replacing today's inline one-entry object).
`POST /refresh {source}` resolves against this map unchanged.

### 5.2 Due-check helper
A source is **due** when it has no `source_snapshot` row, or its `last_run_at` is older than
`cadenceHours` before now. Pure function over `(snapshot | null, cadenceHours, nowIso)` →
`boolean`, unit-testable with a fixed clock.

### 5.3 `scheduled()` refresh (modify `index.ts`)
On each cron tick the handler:
1. keeps the existing OSM `CRON_REGIONS` ingest (unchanged);
2. for each entry in `REFRESH_SOURCES`, loads its snapshot, checks **due**, and for due
   sources runs `runRefreshSource(...)` **sequentially** inside `ctx.waitUntil`, with
   `dataVersion = env.DATA_VERSION`, `nowIso = new Date().toISOString()`,
   `runId = crypto.randomUUID()`.

Sequential keeps Worker CPU/subrequest use bounded for ~6 small sources. When the source count
grows (or Track 2 lands), this moves to a per-source queue or Workflow — noted, not built now.

### 5.4 `wrangler.jsonc`
`"crons": []` stays. A comment documents the opt-in (e.g. `"0 3 * * *"`) and that enabling
starts real embedding/Vectorize spend.

## 6. Error handling / edge cases

- **Source needs a token unexpectedly** (e.g. geonames/socrata) → connector returns
  `needs_key`/`partial` with `records: []` → `runRefreshSource` diffs an empty set, enqueues
  nothing, still saves a snapshot. No crash. (Verified by the Phase-1 orchestration contract.)
- **A connector throws** → `defineConnector` wraps it to `status:'error'`, `records:[]` → same
  no-op path; the snapshot records `last_status`.
- **Cron overrun** — sequential execution + `waitUntil`; each connector already has an internal
  fetch timeout. If the full set ever risks the cron wall-clock, that is the trigger to move to
  per-source dispatch.
- **Bundle safety** — a test asserts the Worker entry imports cleanly and a build/dry-run
  contains no `playwright`/`chromium`.

## 7. Testing

- **Unit** — `sources.ts`: every entry has a connector + a `{subject, category}` mapping, and
  the module imports with no Playwright in the graph; due-check: due when never-run / stale,
  not-due when fresh; `scheduled()` runs only due sources (inject `REFRESH_SOURCES` subset +
  fixed clock + stubbed `runRefreshSource`, assert call set).
- **Integration** — `POST /refresh {source}` for a second open connector (e.g. `dbpedia`)
  returns a summary and writes/merges a blob (reuses the Phase-1 harness with a fake connector
  to stay offline; real-endpoint pulls are not exercised in CI).
- **Regression** — the existing 93 tests stay green; `tsc -b` clean; `wrangler deploy
  --dry-run` clean with zero Playwright/DuckDB.

## 8. Build order

1. `src/refresh/sources.ts` + move/expand `REFRESH_SOURCES`; wire `index.ts` `POST /refresh`
   to it; tests. (No scheduler yet — every source manually triggerable.)
2. Due-check helper + tests.
3. `scheduled()` refresh iteration + tests; `wrangler.jsonc` doc.
4. Full-suite + dry-run verification.

## 9. Follow-ups (not this spec)

- **Track 2 / Phase 2** — device-pool browser ingest (server-side DOM extractor + route
  browser/fallback sources through `pool_url_registry`). The big free-coverage unlock.
- **Keyed/licensed connectors** — secret-injection into `deps.env` + per-key config.
- **Comprehensive pulls** — deepen individual connector queries (pagination/cursors, real
  global queries) so a refresh ingests a source's full corpus, not a sample.
- **Scheduler scale-out** — per-source queue/Workflow when source count or cadence demands it.
