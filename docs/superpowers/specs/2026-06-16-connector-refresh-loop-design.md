# Connector Refresh Loop — Design

> Status: **Draft for review** · Date: 2026-06-16 · Subsystem: `apps/data-pipeline`
> Author: brainstormed with Claude Code

## 1. Summary

Turn the prototype connector framework (`apps/data-pipeline/scripts/connectors/`, 97 API +
68 browser connectors) into a **production refresh loop** that re-scrapes earlier data on a
cadence and only ingests what actually changed. A per-source orchestration on the
data-pipeline Worker asks each connector "did you change?" cheaply, pulls only what is new,
diffs it per record, and pushes just the changed records through the **existing**
enrich → Vectorize path so refreshed data reaches search. The 68 browser connectors (which
need a real Chromium + real mobile IP) are serviced by the **already-built device fetch
pool**; API connectors run on the Worker.

The framework already *defines* the change-detection contract — `SourceFingerprint`,
`PullInput.lastSnapshotFingerprint`, `unchangedSinceSnapshot`, and per-record `content_hash`.
It just never **persists** that state across runs (the CLI makes you hand-pass `--last-fp`
/ `--since`, and `out/<id>.json` is gitignored), and `PulledRecord` carries no URL. This
design makes that state durable and threads a URL through it.

## 2. Goals / Non-goals

**Goals**
- **Record the URL** every pulled item came from, end to end (`PulledRecord.source_url` →
  `TravelRecord.source_url`).
- **Detect updates at two levels**: a cheap per-source fingerprint skip, then a per-record
  `content_hash` diff to identify exactly which items changed.
- **Re-scrape on a cadence** and feed only the changed-set through the existing
  lake → `groups/r7` blobs → enrich queue → Vectorize spine so search stays fresh.
- **Reuse, don't duplicate**: lean on `pool_url_registry`, the enrich queue (already
  idempotent, record-granular), `fnv1a`, `recordUuid`, and the framework's `classification`.

**Non-goals (this spec)**
- **No connector rewrites.** Connectors keep their `pull()` interface; we add persistence and
  orchestration around them.
- **No new browser runtime.** Browser connectors run via the device pool, not a new
  container/CI runner. (A container for non-IP-gated `browser` sources is a possible later
  optimization, explicitly out of scope here.)
- **No discovery/crawling** of new URLs. We refresh a known/curated set (consistent with the
  device-pool spec's "refresh a known URL set, no discovery").
- **No re-modelling of `TravelRecord`** or the Vectorize schema.

## 3. Decisions captured (from brainstorming)

| Topic | Decision |
|-------|----------|
| Target path | **Connector framework** (97 API + 68 browser), not the OSM `/ingest` path |
| Granularity | **Two-level** — per-source fingerprint skip **and** per-record `content_hash` diff |
| Scope | **End-to-end** — record URL + detect updates + scheduler + wire changed records to search |
| Browser runtime | **Device fetch pool** (real mobile IPs); API connectors run on the Worker |
| Routing | By the framework's existing `classification` (`open`/`api-key`/`browser`/…) |
| Downstream | Reuse the existing enrich queue + Vectorize; the new mechanic is **blob merge** |

## 4. Architecture

```
                       ┌──────────────────────────────────────────────┐
   cron (per-source    │   refresh-source orchestration (Worker)        │
   cadence) ─────────► │   1. load source_snapshot                      │
                       │   2. fingerprint → unchanged? STOP (skip)      │
                       │   3. pull (incremental: since + cursor)        │
                       │        ├─ API conn  → pull() inline on Worker   │
                       │        └─ browser   → enrol URL in pool_url_registry
                       │   4. per-record content_hash diff → new/changed │
                       │   5. persist record_state + source_snapshot     │
                       │   6. emit changed-set ──────────┐               │
                       └──────────────────────────────────┼──────────────┘
   device fetch pool ──renders DOM──► R2 ──► extractor    │  (browser path rejoins at step 4)
   (existing)                          (NEW queue consumer)│
                                                           ▼
              materialize TravelRecord (normalize + ER via D1 group registry)
                                                           │
                       ┌───────────────────────────────────┼───────────────────────┐
                       ▼                                   ▼                         ▼
            MERGE groups/r7/<h3_r7>            append lake delta          enqueue changed
            (read-modify-write,                (replayable)               record_uuids →
             NOT full rebuild)                                            ENRICH queue (existing)
                                                                              │
                                                          enrichBatch → bge-m3 → Vectorize upsert
                                                          (existing, idempotent, id=record_uuid)
```

Three new components — the **refresh orchestration**, the **two D1 state tables**, and the
**server-side DOM extractor** (browser path). Everything from `materializeRecords` onward is
the existing spine, made incremental by the blob merge.

## 5. Record the URL

`PulledRecord` ([`scripts/connectors/core/types.ts`](../../../apps/data-pipeline/scripts/connectors/core/types.ts))
gains one field:

```ts
export interface PulledRecord {
  source_id: string;
  record_uuid: string;
  content_hash: string;
  source_url: string;   // NEW — API endpoint or page URL this item came from
  updated_at?: string;
  name?: string; lat?: number; lng?: number;
  raw?: unknown;
}
```

Connectors populate `source_url`; it flows unchanged into the existing `TravelRecord.source_url`
([`packages/pipeline-core/src/record.ts`](../../../packages/pipeline-core/src/record.ts)). No
downstream shape changes. Identity remains `record_uuid = recordUuid(connectorId, source_id)`.

## 6. Two-level state model (D1, `travel-groups`)

Two new tables, alongside the existing `pool_url_registry` (which stays as the page-fetch
*transport* layer for browser sources; `record_state` is the semantic *record* layer).

**`source_snapshot`** — one row per connector; the cheap source-level skip:

| column | type | meaning |
|--------|------|---------|
| `source` | TEXT PK | connector id (e.g. `wikidata`) |
| `fingerprint_method` | TEXT | e.g. `etag`, `last-modified`, `sitemap-lastmod-max`, `content-hash` |
| `fingerprint_value` | TEXT | compared to the new run's `sourceFingerprint.value` |
| `cursor` | TEXT NULL | opaque resume cursor for the next run |
| `since_ts` | TEXT NULL | `last_snapshot_timestamp` — fed to next run as `sinceTimestamp` |
| `last_run_at` | TEXT | ISO 8601 |
| `last_status` | TEXT | `ok` / `unchanged` / `partial` / `error` |

**`record_state`** — one row per record; the fine per-record diff:

| column | type | meaning |
|--------|------|---------|
| `record_uuid` | TEXT PK | `recordUuid(connectorId, source_id)` |
| `source` | TEXT | connector id |
| `source_url` | TEXT | where it came from |
| `content_hash` | TEXT | `fnv1a` of canonical content; the diff key |
| `first_seen_at` | TEXT | ISO 8601 |
| `last_seen_at` | TEXT | ISO 8601 (every run that observed it) |
| `last_changed_at` | TEXT | ISO 8601 (only when `content_hash` changed) |

Index `record_state(source, last_seen_at)` for per-source reconcile/deletion sweeps.

## 7. Refresh cycle (per source)

One `refresh-source` run per connector:

1. **Load** `source_snapshot` (prior fingerprint, cursor, `since_ts`).
2. **Fingerprint**: compute the current `sourceFingerprint`. If `value` equals the stored value
   → update `last_run_at`/`last_status='unchanged'` and **STOP** (source-level skip).
3. **Pull**: call `pull({ sinceTimestamp: since_ts, lastSnapshotFingerprint, cursor })`.
   Incremental where the source supports it (`api-since-param` › `changes-feed` › `dump-diff`
   › `sort-by-updated`/`sitemap-lastmod` › `etag-conditional` › `full-only`).
4. **Diff**: for each `PulledRecord`, compare `content_hash` to `record_state` →
   classify `new` / `changed` / `unchanged`.
5. **Persist**: upsert `record_state` (bump `last_seen_at`; set `last_changed_at` when changed);
   write the new `source_snapshot` (fingerprint, cursor, `since_ts = now`).
6. **Emit** the changed-set (`new ∪ changed`) downstream (§9).

### Routing at step 3 (by `classification`)

| classification | runtime |
|----------------|---------|
| `open` / `api-key` / `api-license` | `pull()` runs inline on the **Worker** (fetch-only) |
| `browser` / `browser+proxy` | URL enrolled in `pool_url_registry`; **device pool** renders DOM |
| `no-public-source` | **skip** |

## 8. Browser path — server-side DOM extractor (NEW)

Today the device pool renders the post-JS DOM and parks it in R2 (`pool/<urlHash16>/…html.gz`);
the "DOM → PulledRecord" hop is an explicit TODO
([`src/pool/handlers.ts`](../../../apps/data-pipeline/src/pool/handlers.ts) note). This design
fills it:

- A **queue-driven extractor** consumes pool results. For each stored DOM it runs the matching
  connector's parse logic (moved server-side from `browser/strategies.ts`) to produce
  `PulledRecord[]`.
- Those records **rejoin the refresh cycle at step 4** (per-record diff) — identical downstream
  to the API path. One changed-set logic, two acquisition runtimes.
- Browser-source cadence is paced by the device pool's own self-scheduling; the orchestration
  only keeps `pool_url_registry` topped up with due URLs — it never pushes devices.

## 9. Downstream — pushing the changed-set to search

For the changed-set only, reuse the existing spine made incremental:

1. **Materialize** `TravelRecord`s — normalize + entity-resolution via the existing D1 group
   registry (generalize the `materializeRecords` logic in
   [`src/run-ingest.ts`](../../../apps/data-pipeline/src/run-ingest.ts) beyond OSM).
2. **Merge** changed records into `groups/r7/<h3_r7>` blobs — **read-modify-write**, upsert by
   `record_uuid`, write back. This replaces today's full-blob rebuild; without it an incremental
   run would drop every unchanged record from the blob and break enrich's `loadRecord`.
3. **Append** a lake delta `lake/poi/<region>/v<dv>/delta-<ts>.ndjson.gz` (replayable; the
   deterministic full-snapshot key is left for periodic compaction).
4. **Enqueue** one `EnrichMessage` per changed `record_uuid` onto the existing `ENRICH` queue →
   `enrichBatch` embeds (bge-m3) + upserts Vectorize. Already idempotent (`id = record_uuid`),
   so only changed records are re-embedded. No enrich changes.

## 10. Error & resilience / edge cases

- **Blob-merge concurrency** — two sources can touch the same `groups/r7/<h3_r7>` blob at once;
  naive read-modify-write loses writes. Funnel all merges through a **dedicated `merge` queue**
  keyed so one r7 blob is never merged in parallel (serialized per r7 key; or R2 conditional
  `onlyIf`/etag with retry). The merge consumer is idempotent (last-writer-wins per
  `record_uuid`).
- **Deletions / tombstones** — for **full-pull** sources, a `record_uuid` in `record_state` but
  absent from this pull = removed → tombstone (drop from blob, delete the Vectorize id, mark
  removed). For **incremental** sources deletes are usually unobservable: documented limitation,
  with a **periodic full reconcile** as the escape hatch (Phase 3).
- **Fingerprint unavailable** — fall back down the framework's ladder to `full-only` ("pull all,
  diff by per-record `content_hash`") — still correct, just not cheap.
- **Browser challenges** — reuse the pool's existing `consecutive_challenges` + exponential
  backoff; a challenged fetch is never recorded as "unchanged".
- **Idempotency** — enrich is already idempotent; the merge consumer must be too.

## 11. Scheduling

Re-enable the Worker cron (currently `"triggers": { "crons": [] }` in
[`wrangler.jsonc`](../../../apps/data-pipeline/wrangler.jsonc)). API sources refresh on a
per-source `refresh_cadence` (default daily). Browser sources are paced by the device pool;
the orchestration just keeps `pool_url_registry` populated with due URLs.

## 12. Testing

- **Unit** — fingerprint-compare skip; record classification (`new`/`changed`/`unchanged`);
  blob merge preserves unchanged records; changed-only enqueue; deletion sweep for full-pull
  sources.
- **Integration** — run a connector twice against a fixture: assert run 2 **skips** the unchanged
  source (no pull) **and**, when records change, emits only the changed subset and Vectorize sees
  only those upserts.
- **Browser path** — a captured-DOM fixture through the extractor yields the right
  `PulledRecord` + `content_hash` (Phase 2).
- All Worker-side tests use the existing Vitest harness — no device needed.

## 13. Build order

End-to-end is large; Phase 1 is an independently shippable vertical slice that proves the whole
path on the no-Chrome route.

| Phase | Scope | Why |
|-------|-------|-----|
| **1** | `source_url` on the envelope + the two D1 tables + refresh cycle for **API connectors only** + downstream merge + enrich wiring + cron | Entire vertical, **no Chrome** — testable end-to-end on the Worker. De-risks the merge + state model. |
| **2** | Browser path: server-side DOM extractor consuming pool R2 results → same changed-set | Adds the 68 browser sources once Phase 1's downstream is proven. Finishes the pool's extractor TODO. |
| **3** | Deletions/tombstones, per-source cadence tuning, observability (counts: skipped / changed / embedded), periodic full-snapshot compaction | Hardening once data is flowing. |

## 14. Open questions / risks

- **Merge throughput**: a single serialized merge consumer is the safe default; if r7 blob
  contention becomes a bottleneck, shard by r7 prefix.
- **Server-side parse parity**: moving browser-connector parse logic server-side (§8) must match
  what the on-device render produces; validate with captured-DOM fixtures.
- **`step.do` return cap**: the existing ingest notes a ~1 MB step-return limit; the refresh
  cycle should pass record sets by R2 reference, not inline, for large changed-sets.
- **Catalog/cadence governance**: who sets per-source `refresh_cadence` and curates the browser
  URL set in `pool_url_registry`.
