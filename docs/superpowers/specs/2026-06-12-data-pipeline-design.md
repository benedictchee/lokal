# Data Pipeline — Design Spec

- **Date:** 2026-06-12 (rev. 2 — reconciled with the final-goal serving architecture)
- **Subsystem:** `apps/data-pipeline/` (Cloudflare Worker + Workflows + Queues + Vectorize + R2)
- **Status:** Approved design, targeting the serving architecture in
  [cloudflare-data-storage-architecture.md](../../../cloudflare-data-storage-architecture.md)
- **Scope:** the cron/ad-hoc pipeline that **produces** serving + analytics
  artifacts. The live read path is the consumer-API's concern (boundary in §10).

## 1. Purpose

Scrape location/POI and transport data, geocode with H3, assign stable IDs, and
produce the artifacts the final-goal architecture serves from:

1. **R2 cold blobs** — the entire dataset as H3-keyed group blobs
   (`groups/r7/{parentH3}`), serve-by-key. The cold serving origin.
2. **D1 hot tier** — precomputed `h3_group_cache` + base records, proactively
   warmed for the **popular** set (low-hit data is hydrated lazily by the
   consumer-API read path).
3. **Vectorize** — the **semantic front door** of the read path: resolves a
   user request to keys (`record_uuid`, `group_uuid`, `h3_r7`) that fetch content
   from R2 cold blobs / D1. Holds vectors + metadata pointers only, never payloads.
4. **Source-of-truth / analytics tier** — normalized records durably in R2
   behind a `LakeWriter` interface (§4.2).

Same core logic runs **locally** (Node/TS CLI) and **deployed** (Worker/Workflow),
writing to the real cloud in both cases.

## 2. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Structured serving tier | **R2 cold H3-blobs → D1 hot `h3_group_cache` → Cache API** (all GA). Per the final-goal doc. |
| D2 | Vectorize role | **Semantic resolver in the read path** — returns keys (`record_uuid`→R2 blob via `h3_r7`; `group_uuid`→D1 group→R2 blobs). Stores vectors + metadata pointers only, never payloads. |
| D3 | Source-of-truth / analytics | **Serving-first, all-GA.** SoT = normalized **NDJSON in R2** behind a `LakeWriter` interface; query with **DuckDB** (zero egress). Managed **Iceberg + R2 SQL** is the drop-in upgrade target when GA. |
| D4 | Push/pull boundary | **Hit-rate-driven.** Pipeline pushes (precompute + warm D1) for popular cells; consumer-API pulls (lazy hydrate + promote-on-repeat) for cold cells. |
| D5 | Google data posture | Scrape Google/other UIs into the lake via external residential-proxy scraper (team owns ToS/legal). Designed-for, **deferred** past v1. |
| D6 | v1 vertical slice | **OSM POIs, one region**, producer flow: scrape → raw → normalize → SoT (NDJSON) + R2 cold blobs + Vectorize. (D1 warming deferred to M2 — no traffic yet.) |
| D7 | v1 fetch mechanism | **Overpass API** (JSON; parses in workerd + Node). Geofabrik `.osm.pbf` bulk deferred. |
| D8 | H3 resolutions | **r5 / r7 / r10** (15-char lowercase hex strings). r7 = blob/zone level; r10 = base; r5 = metro rollup. Derive r7/r5 via `cellToParent` from r10. |
| D9 | Group identity | **Program-minted UUIDv7** in a D1 `groups` registry, assigned by an **entity-resolution** step. Match signals (brand, `brand:wikidata`, name, category) are **aliases**, never the identity. Transport categories are seeded registry entries. |
| D10 | Vectorize granularity | **Record-level vectors only** in v1 (one per `record_uuid`); role 2 derives the group from the matched record's `group_uuid`. Group-level (semantic chain/group) vectors deferred. |

## 3. Cost discipline (adopted from the final-goal doc)

These are first-class constraints, not afterthoughts:

- **D1 bills rows *scanned*, not returned.** Index every filtered/joined/sorted
  column; verify `SEARCH ... USING INDEX` via `EXPLAIN QUERY PLAN`. Precomputed
  group reads are 1-row.
- **Precompute beats runtime grouping.** Repeated H3-group lookups become a
  single indexed `h3_group_cache` row, not an `IN (...)`/`GROUP BY`.
- **R2 object granularity:** one blob per **coarse r7 parent**, never one per
  fine cell (avoids millions of tiny objects + Class-A `list` in hot paths).
- **Version, don't purge.** Stamp blobs/D1 rows with `data_version`; old Cache
  API entries age out via versioned keys (per-PoP `delete` is not global).
- **Don't query inside R2 serving blobs** — opaque, serve-by-key. Analytics is
  the separate `LakeWriter` tier (DuckDB/Parquet).

## 4. Architecture

### 4.1 Components

| Component | Location | Role |
|-----------|----------|------|
| Shared core | `packages/pipeline-core` | Pure TS: fetch, parse, normalize, H3, UUID, group-blob builder, embed-text. No bindings → identical in CLI + Worker. |
| Fetchers | `pipeline-core/fetchers` | v1: OSM Overpass. Seams for GTFS, Google (external proxy). |
| Raw landing | R2 `raw/<source>/<hash>` | Unmodified payload written *before* parsing → replayable. |
| Normalizer | `pipeline-core/normalize` | Raw → canonical `Record` (minus `group_uuid`). |
| Entity resolution | `pipeline-core/grouping` | Maps each Record to a program group via match signals; looks up or mints `group_uuid` in the registry. |
| Group registry | D1 `groups` + `group_aliases` | Program-owned master: minted `group_uuid` ↔ aliases + members. Read/written at ingest (write-side, **from v1**). |
| **LakeWriter** | `pipeline-core/lake` | Interface for the SoT/analytics tier. v1 impl: NDJSON→R2. Future impl: Iceberg/Pipelines. |
| Blob builder | `pipeline-core/serving` | Buckets Records by r7 parent → `groups/r7/{parent}` blobs, `data_version`-stamped. |
| Enrich consumer | `apps/data-pipeline` (queue) | Embed (`bge-m3`) → Vectorize upsert. |
| Orchestrator | `apps/data-pipeline` (Workflow) | Parent Workflow fans out per region; cron + ad-hoc. |
| Refresh/eviction *(M2)* | `apps/data-pipeline` (scheduled) | Proactive R2→D1 warm for popular cells; D1 eviction. |
| CLI | `apps/data-pipeline/cli` | Runs the core locally against remote R2/Vectorize/AI. |

### 4.2 `LakeWriter` interface (isolates the beta decision)

```ts
interface LakeWriter {
  append(records: Record[], opts: { source: string; region: string; dataVersion: number }): Promise<void>;
}
// v1:  NdjsonR2LakeWriter  — PUT gzipped NDJSON to lake/<subject>/<region>/v<data_version>.ndjson.gz  (GA; deterministic key → retries/re-runs overwrite)
// M4+: IcebergLakeWriter   — Pipelines Stream → R2 Data Catalog (drop-in, when GA)
```

Analytics in v1 = DuckDB reading those NDJSON/Parquet objects from R2 directly
(zero egress) for QA, dedup, backfill, and re-deriving serving blobs.

**Why a SoT tier at all:** the serving artifacts (R2 blobs, D1, Vectorize) are
*derived, denormalized, lossy* views. The lake is the **durable, complete,
queryable** record of every `Record` — so a blob-format change, a new H3
resolution, or a normalize bug is fixed by **re-deriving from the lake**, never
by re-scraping (which is slow, rate-limited, and ToS-risky for Google).
**Why NDJSON+DuckDB now, not Iceberg:** Iceberg/R2 SQL are beta and a Worker
can't write Iceberg directly (needs Pipelines or Python); NDJSON is a trivial
Worker `PUT` and DuckDB gives full SQL over it today. The interface makes the
Iceberg swap a one-line change when it's GA.

### 4.3 The hit-rate-driven serving model (final goal)

```
                       PIPELINE (push side)                         CONSUMER-API (pull side)
 scrape → raw → normalize → ┌─ LakeWriter (NDJSON→R2)  ── analytics (DuckDB)
                            ├─ R2 cold blobs groups/r7/{parent}  ◄── L3 cold-miss hydrate (single-flight DO)
                            ├─ Vectorize embeds  ─────────────── semantic retrieval (AI worker)
                            └─ [M2] proactive D1 warm (popular) ─► L2 D1 h3_group_cache ◄─ promote-on-repeat
                                        ▲                                   ▲
                                  Analytics Engine popularity signal ───────┘  L0 isolate · L1 Cache API (free)
```

- **Popular cells:** pipeline precomputes + warms D1 (push). **Cold cells:**
  consumer-API hydrates from R2 on demand + promote-on-repeat (pull). Both read
  the R2 cold blobs the pipeline always produces.
- **Vectorize resolves the request to keys, then content is fetched from
  R2/D1:** (role 1) nearest `record_uuid` → R2 cold blob `groups/r7/{h3_r7}`;
  (role 2) `group_uuid` → D1 group row → member R2 cold blobs. Vectorize never
  returns payloads.

## 5. Canonical data model — `travel.data.v1.Record`

Defined once in `proto/` (source of truth per `DataFormat.md`), projected to
NDJSON (lake), R2 blob payloads, D1 rows, and Vectorize metadata.

| Field | Type | Notes |
|-------|------|-------|
| `record_uuid` | string | `uuidv5("${source}\x1f${source_id}", NS_RECORD)` — stable; re-scrape = same id. Separator is ASCII Unit Separator (U+001F, `\x1f`), preventing `("a:b","c")` vs `("a","b:c")` collisions. |
| `group_uuid` | string | POI: `brand:wikidata` \| brand \| `standalone:`+id; transport: `transport:${category}` |
| `subject` | string | `poi` \| `transport` \| (future) |
| `category` | string | `restaurant`/`hotel`/… or `train`/`hsr`/`mrt`/`light_rail`/`bus`/`cable_car` |
| `name`, `lat`, `lng` | string/float64 | |
| `h3_r5`, `h3_r7`, `h3_r10` | string (15-char hex) | r10 = `latLngToCell`; r7/r5 = `cellToParent(r10,…)` |
| `attributes` | string (JSON) | subject-specific; keeps the model extensible without migrations |
| `source`, `source_id`, `source_url`, `raw_r2_key`, `lang`, `content_hash`, `data_version` | string/int | provenance + change detection + versioning |

### 5.1 Serving-store schemas (the final-goal targets)

**R2 cold blob:** key `groups/r7/{h3_r7}` → JSON/bin array of the Records under
that r7 parent, stamped with `data_version`. Built by the blob builder.

**D1 hot tier** (warmed for popular cells in M2; consumer-API reads it):
```sql
CREATE TABLE h3_group_cache (
  group_key TEXT PRIMARY KEY,   -- r7 parent | r5 parent | group_uuid
  res INTEGER, payload TEXT, member_count INTEGER,
  data_version INTEGER, updated_at INTEGER
);
CREATE TABLE records (              -- base working set, base res r10
  record_uuid TEXT PRIMARY KEY, subject TEXT, category TEXT, name TEXT,
  lat REAL, lng REAL, h3_r10 TEXT NOT NULL, h3_r7 TEXT NOT NULL, h3_r5 TEXT NOT NULL,
  group_uuid TEXT, attributes TEXT, data_version INTEGER
);
CREATE INDEX idx_records_h3_r10 ON records(h3_r10);
CREATE INDEX idx_records_h3_r7  ON records(h3_r7);
CREATE INDEX idx_records_group  ON records(group_uuid);
```

**D1 group registry** (program-owned identity; write-side, **from v1**):
```sql
CREATE TABLE groups (             -- the minted group identities
  group_uuid     TEXT PRIMARY KEY,  -- minted UUIDv7 (program-internal, never an external id)
  subject        TEXT, kind TEXT,   -- kind: chain | transport_category | standalone
  canonical_name TEXT, created_at INTEGER
);
CREATE TABLE group_aliases (      -- match signals → group (how ER resolves identity)
  alias_key  TEXT PRIMARY KEY,      -- brand:wikidata:Q123 | brand:slug:<slug> | transport:<cat> | standalone:<record_uuid>
  group_uuid TEXT NOT NULL
);
```

**Vectorize** (dims=1024, cosine, id=`record_uuid`): metadata string indexes
created **before any upsert** — `subject`, `category`, `group_uuid`, `h3_r5`,
`h3_r7`, `h3_r10`. Metadata are **fetch pointers**, not content: `record_uuid`
(=id) + `h3_r7` locate the full record in R2 blob `groups/r7/{h3_r7}` (role 1);
`group_uuid` resolves to the D1 group row (role 2). Vectors carry no payload.
v1 embeds **records only** (one vector per `record_uuid`); role 2 derives the
group from the matched record's `group_uuid`. Dedicated group-level vectors
(semantic chain/group matching) are deferred.

**D1 groups** (role 2): a `h3_group_cache` row keyed by `group_uuid` holds each
group's member set — restaurant chains, transport categories, etc. — precomputed
by the pipeline (member `record_uuid`s + their `h3_r7` blob pointers).

## 6. v1 data flow (OSM POIs, one region — producer slice)

```
CLI:    pnpm --filter data-pipeline ingest --source osm --region <id> --bbox <…>
Worker: cron schedule  /  Workflow.create({ source:'osm', region, bbox })
   │  Workflow IngestRegion (idempotent step.do · exp. backoff · blobs→R2)
   ① Overpass fetch (chunked) ─► raw R2 landing
   ② normalize → Record[]  (record_uuid · r5/r7/r10 · attributes)
   ②a entity-resolution → group_uuid  (lookup/mint in D1 `groups` registry by match signals)
   ③ LakeWriter.append (NDJSON→R2)             ── SoT/analytics
   ④ blob builder: bucket by h3_r7 → groups/r7/{parent}  (data_version)  ── R2 cold serving origin
   ⑤ enqueue 1 msg/record → enrich consumer: embed bge-m3 → Vectorize.upsert  ── semantic
```

The D1 *serving* hot tier (`h3_group_cache`), proactive refresh, eviction, and the
live read path are **not** in v1 — they're M2. (The D1 `groups` **registry** *is*
in v1: it's write-side state for entity resolution, not serving.)

## 7. Identifier & geocode rules

- `record_uuid` = UUIDv5 over `"${source}\x1f${source_id}"` (ASCII Unit Separator, U+001F) → idempotent re-scrape. The `\x1f` separator prevents `("a:b","c")` vs `("a","b:c")` collisions that a colon join would allow.
- `group_uuid` — **program-minted UUIDv7**, assigned by entity resolution: compute
  match signals → look up the D1 `groups` registry by alias (`brand:wikidata:*`,
  `brand:slug:*`, `transport:<category>`, or `standalone:<record_uuid>`) → reuse the
  existing `group_uuid` or **mint a new UUIDv7** and record the alias. External IDs
  are aliases, never the identity. Stable across re-scrapes via the registry.
  Transport categories are seeded as registry entries.
- H3 — `c10 = latLngToCell(lat,lng,10)`; `h3_r7 = cellToParent(c10,7)`;
  `h3_r5 = cellToParent(c10,5)`. Hex strings. (Never independent per-res calls.)

## 8. Error handling & idempotency

- Idempotent steps keyed by `record_uuid`; retries overwrite, never duplicate.
- Vectorize eventually consistent → no read-after-write within a step.
- Raw landing → full replay without re-scraping.
- Enrich queue has a **DLQ** + triage; permanent failures throw `NonRetryableError`.
- Large payloads → R2; only keys travel through steps/messages (1 MiB / 128 KB caps).
- R2 blob writes use deterministic `groups/r7/{parent}` keys → retries overwrite.

## 9. Local ↔ cloud parity

- **CLI:** core → remote R2 (REST/binding), Vectorize (REST), Workers AI (REST),
  D1 `groups` registry (remote binding; or a local D1 for tests).
- **Worker/Workflow:** `wrangler dev` with `remote: true` on R2/Vectorize/D1; deployed
  unchanged. Queues can't be remote — local tests call the consumer fn directly.

## 10. Boundary with consumer-API (read-path contract)

The pipeline **produces**; the consumer-API **serves**. The contract:

- The consumer-API read path is the final-goal doc's L0→L3 fallthrough
  (in-isolate → Cache API → D1 `h3_group_cache` → R2 cold-miss hydrate via
  single-flight DO), with SWR and promote-on-repeat.
- Shared contracts the pipeline guarantees: R2 blob key scheme
  `groups/r7/{h3_r7}`, the `data_version` stamp, the `Record` shape, and the
  Vectorize index name + metadata fields.
- **Vectorize-as-resolver:** the read path embeds the user request, queries
  Vectorize (optionally H3/subject/category-filtered), and uses the returned
  keys to fetch — `record_uuid`+`h3_r7` → R2 cold blob (role 1), or `group_uuid`
  → D1 group row → member R2 blobs (role 2). Vectorize returns keys, not content.
- Popularity (Analytics Engine) is written by the read path; **read** by the
  pipeline's M2 proactive-refresh job.
- **Pre-flight sampling (M6):** before a broad query fans docs into the AI step,
  the read path estimates result magnitude from **exact** signals
  (`member_count`, metadata counts, Vectorize `topK`); over a tunable threshold
  it **samples top-K** rather than select-all, capping AI cost.

## 11. Testing strategy (TDD)

- **Unit:** H3 nesting rule, UUID determinism, OSM-tag→Record normalizer,
  group-UUID assignment, blob bucketing (records → `groups/r7/{parent}`),
  embed-text composition.
- **Integration:** golden Overpass fixture → expected Records + expected blob
  set; against throwaway dev R2 + dev Vectorize; re-run proves no dupes.
- **Analytics smoke:** DuckDB query over the written NDJSON returns expected
  counts per category/region.

## 12. Milestones (serving-first)

1. **M1 (v1):** OSM POIs, one region — producer flow: scrape → raw → normalize →
   NDJSON SoT + R2 cold blobs + Vectorize. Local + deployed. *(this spec)*
2. **M2:** D1 hot tier + proactive R2→D1 refresh + eviction + Analytics Engine
   popularity (needs consumer-API read path to exist).
3. **M3:** Transport subject via GTFS; transport group UUIDs.
4. **M4:** Google + external-proxy scraper (the Playwright/browser path).
5. **M5:** `IcebergLakeWriter` upgrade (R2 Data Catalog + R2 SQL) when GA;
   Geofabrik `.osm.pbf` bulk; compacted analytical tables.
6. **M6 (cost-control):** **result sampling.** A read-path pre-flight magnitude
   check (exact `member_count` / metadata counts / Vectorize `topK`) caps how
   many docs reach the AI step — when a query is too broad, sample top-K
   (by relevance/rating/recency) instead of select-all. Order of preference:
   exact `member_count` → metadata counts → Vectorize `topK` → sample.
   (Approximate-cardinality sketches were considered and deliberately **not**
   adopted — exact precomputed counts cover our rollup needs.)

## 13. Compliance flags (team to own)

- **OSM ODbL share-alike** may attach to the derived lake DB.
- **Google no-cache ToS** + shared-Worker-IP blocking when that connector is
  built → external egress / residential proxy required.
- **robots.txt / politeness** policy per source (rate limits, jittered delays).

## 14. Open questions / risks

- Confirm `bge-m3` output dimension empirically before fixing the immutable
  Vectorize index dimension.
- NDJSON→Parquet compaction cadence for efficient DuckDB analytics (M1 can defer
  to NDJSON-only; add a scheduled compaction when query volume grows).
- M2 trigger threshold: how many misses/popularity rank promotes a cell into D1
  (tune against real traffic).
- Group registry scale: every standalone POI mints a one-member group → one
  registry row each. Fine at v1/region scale; revisit before national scale
  (e.g. lazy registry entry, or a null-group for true singletons).
- Entity-resolution matching for v1 is signal-based (brand/`brand:wikidata` →
  chain; else standalone). Fuzzy name+geo and cross-source merge are deferred.
