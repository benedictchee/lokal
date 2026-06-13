# Cloudflare Data Storage Architecture — H3-Indexed Geospatial Serving

**Scope.** A reference for storing and serving H3-indexed geospatial data (bus stops, routes, service territories, event-impact records) on a Cloudflare serverless stack: Flutter clients, Workers (TypeScript), and a Next.js site. It covers which store to use for which job, the cost model that drives those choices, the recommended tiered architecture, the read and refresh paths, and the anti-patterns that quietly inflate bills.

> **Pricing note.** All rates are as of 2026 and are approximate. Cloudflare changes numbers periodically — verify against the official pricing pages before relying on a figure. The *principles* outlast the numbers.

---

## 1. Core principles (read these first)

Everything downstream follows from five ideas.

1. **Three layers, kept separate.** *Data format* (how bytes are encoded — protobuf/JSON/MessagePack), *transport* (how they move — Connect/REST over HTTP/2/3), and *storage* (where they rest — D1/KV/R2). Don't conflate them. This doc is about storage; the transport layer is handled separately (Connect protocol end-to-end, native HTTP stacks on mobile for HTTP/3).

2. **D1 bills on rows *scanned*, not rows *returned*.** A query that returns 1 row out of 100k via a full table scan is billed for 100,000 rows read. Indexing is therefore not just a performance lever — it is *the* cost lever. Every column you filter, join, or sort on must be indexed, and you verify with `EXPLAIN QUERY PLAN` (you want `SEARCH ... USING INDEX`, never `SCAN TABLE`).

3. **Match the store to the access pattern — "cheapest store" is a myth.** There is no universally cheapest store. An indexed D1 read is ~500× cheaper than a KV read; a D1 *scan* is ~300× more expensive than that same KV read. Cost depends entirely on access shape.

4. **Precompute beats runtime grouping.** If users repeatedly ask for the same group of H3 cells, compute the group **once** during data preparation and store the result keyed by the group identifier. Serving then becomes a single indexed row read instead of an `IN (...)` / `GROUP BY` over N rows.

5. **The cost ladder for repeated reads** (cheapest to most expensive):

   ```
   indexed D1 precomputed read  ≪  Cache API (free, per-PoP)  ≈  in-isolate memory (free, ephemeral)  ≪  KV read
   ```

   Caching precomputed groups in KV costs *more per read* than reading them from an indexed D1 table — and KV is eventually consistent. Reach for the free layers (Cache API, in-isolate) before KV, and let D1 be the cheap durable serving tier.

---

## 2. The storage tiers and their cost-by-action

| Store | Role in this architecture | Billed action(s) | Approx. paid rate | Monthly included (Paid) |
|---|---|---|---|---|
| **R2** | Cold durable origin — the full dataset as H3-keyed blobs | Class A (write/list), Class B (read), storage; **no egress** | A $4.50/M · B $0.36/M · $0.015/GB-mo | 1M A · 10M B · 10 GB |
| **D1** | Hot indexed serving tier — working set + precomputed groups | rows read, rows written, storage | read $0.001/M · write $1.00/M · $0.75/GB-mo | 25B read · 50M write · 5 GB |
| **Cache API** | Free edge read cache (per-PoP) in front of D1/R2 | — | **free per operation** | n/a |
| **In-isolate memory** | L1 for hottest keys within a request burst | — | **free** (ephemeral, per-isolate) | n/a |
| **Durable Objects** | Single-flight hydration lock; live per-entity state | requests, duration (GB-s), SQLite storage | req $0.15/M · dur $12.50/M GB-s · $0.20/GB-mo | 1M req · 400K GB-s · 5 GB |
| **Vectorize** | Separate analytics tier — event-embedding semantic search | queried dimensions, stored dimensions | queried $0.01/M · stored $0.05/100M | 50M queried · 10M stored |
| **Hyperdrive → Postgres/PostGIS** | Heavy geospatial (nearest-neighbour at scale, real spatial SQL) | no Cloudflare surcharge (pay your DB provider) | included on Workers plans | — |

Every store is accessed from a Worker. Workers bill ~$0.30/M requests and ~$0.02/M CPU-ms (10M requests + 30M CPU-ms included). **Subrequests are not billed**, so calling D1/R2/KV from a Worker adds no per-call request charge.

### Cost intuition that drives the design

- **Indexed D1 read** (~1–3 rows): ~$3×10⁻⁹ per read.
- **KV read**: ~$5×10⁻⁷ per read → ~**167–500× more expensive** than an indexed D1 read.
- **D1 full scan** of 100k rows: ~$1×10⁻⁴ per query → ~**300× more expensive than a KV read**, and ~50,000× more than the indexed read.
- **Storage:** R2 ($0.015/GB-mo) is **50× cheaper than D1** ($0.75/GB-mo).

Conclusion: keep the **bulk dataset in R2** (cheap storage), keep only the **working set in D1** (cheapest reads when indexed), and use the **free edge layers** to absorb repeats. KV is a latency/global-distribution tool, not a cost-saver.

---

## 3. Reference architecture

```
                 ┌─────────────────────────────────────────────┐
   Clients       │  Flutter (iOS/Android) · Next.js · API       │
                 └───────────────────────┬─────────────────────┘
                                         │  Connect protocol over HTTP/2/3
                                         ▼
                 ┌─────────────────────────────────────────────┐
   Edge Worker   │  read path: Cache API → in-isolate → D1 → R2 │
                 └───────┬───────────────┬───────────────┬─────┘
                         │               │               │
              (free)     ▼      (cheap)  ▼     (cold)     ▼
                 ┌──────────────┐ ┌────────────┐ ┌──────────────────┐
                 │  Cache API   │ │     D1     │ │       R2         │
                 │  (per-PoP)   │ │  hot tier  │ │  cold origin     │
                 └──────────────┘ │ + indexes  │ │  H3-keyed blobs  │
                                  │ + group $  │ │  size-efficient  │
                                  └─────┬──────┘ └────────┬─────────┘
                                        │  refresh         │  ingest
                          ┌─────────────┴──────┐  ┌────────┴──────────┐
                          │ Refresh Worker     │  │ Ingestion Workflow│
                          │ R2→D1 (hot cells)  │  │ internet→R2       │
                          │ + eviction         │  │ daily/weekly cron │
                          └────────────────────┘  └───────────────────┘

   Single-flight lock: Durable Object keyed by parent H3 cell (cold-miss hydration)
   Popularity signal:  Analytics Engine (top-N hot cells) → proactive refresh set
   Analytics tier (separate): Vectorize / R2 SQL+DuckDB / Postgres — NOT the serving blobs
```

**The roles, one line each:**

- **R2** — durable, cheap origin of record. Holds the *entire* dataset as H3-keyed blobs (opaque, serve-by-key).
- **D1** — hot serving tier. Holds the *working set* + a precomputed group-cache table. Indexed. Strongly consistent.
- **Cache API** — free per-PoP cache over the serving endpoint. First line of defence against repeat reads.
- **In-isolate `Map`** — free L1 for the few hottest keys within a burst.
- **Durable Object** — single-flight lock to prevent cold-miss stampedes; also the home for genuinely live per-vehicle state.
- **Vectorize / DuckDB+R2 / Postgres** — a *separate* analytical/queryable tier for the event-impact pipeline. Never merged with the H3 serving blobs.
- **Hyperdrive → PostGIS** — for spatial queries D1 can't do cheaply (nearest-vehicle at scale).

---

## 4. The H3 data model

### 4.1 Key representation and resolution

- **Store H3 indices as 15-char lowercase hex `TEXT`.** H3 indices are 64-bit (~2⁶⁰), beyond JS's safe integer range (2⁵³), which is why `h3-js` returns hex strings. Fixed-width lowercase hex sorts identically to the numeric value, so `=`, `IN`, and `BETWEEN` all behave correctly. (Integer storage saves a few bytes but forces BigInt handling — not worth it.)
- **Pick one base resolution and stick to it.** For Singapore-density stop/vehicle work: **res 9 (~174 m edge)** or **res 10 (~66 m)**. Use res 7–8 for zones. The single-resolution rule is what keeps range/join patterns clean.
- **Denormalize coarser parents** as extra indexed columns so zoom-level rollups are pure `GROUP BY` with no per-query parent computation.

### 4.2 Schemas

**Base records** (stops, vehicle pings, events):

```sql
CREATE TABLE stops (
  id    INTEGER PRIMARY KEY,
  name  TEXT,
  lat   REAL, lng REAL,
  h3    TEXT NOT NULL,      -- base res (e.g. r10), 15-char lowercase hex
  h3_r8 TEXT NOT NULL,      -- denormalized parents for zone rollups
  h3_r7 TEXT NOT NULL
);
CREATE INDEX idx_stops_h3    ON stops(h3);
CREATE INDEX idx_stops_h3_r8 ON stops(h3_r8);
```

**Territories / service areas as H3 cell sets** (polyfilled once — replaces point-in-polygon):

```sql
CREATE TABLE territory_cells (
  territory_id INTEGER NOT NULL,
  h3           TEXT NOT NULL,   -- SAME base res as stops.h3, uncompacted
  PRIMARY KEY (territory_id, h3)
);
CREATE INDEX idx_territory_cells_h3 ON territory_cells(h3);
```

> Keep `territory_cells` **uncompacted** at the base resolution. `compactCells` mixes resolutions and breaks the equal-resolution equality join.

**Precomputed group cache** (the core cost optimization):

```sql
CREATE TABLE h3_group_cache (
  group_key    TEXT PRIMARY KEY,  -- parent H3 cell, territory_id, or `${centerCell}:${k}`
  res          INTEGER,
  payload      TEXT,              -- serialized result: the N records or the aggregate
  member_count INTEGER,
  data_version INTEGER,           -- bump on refresh; used in Cache API keys
  updated_at   INTEGER
);
```

### 4.3 Query patterns (all index-tight; do the H3 math in the Worker with `h3-js` v4)

```
latLngToCell(lat, lng, res)   → cell index
gridDisk(cell, k)             → k-ring neighbours  (k=2 → 19 cells, k=3 → 37)
polygonToCells(polygon, res)  → cells covering a polygon (for territory polyfill)
cellToParent(cell, res)       → coarser parent
cellToChildren(cell, res)     → finer children (ordered; first/last bound a range)
```

| Need | Query | Cost |
|---|---|---|
| Exact cell | `WHERE h3 = ?1` | ~1 row |
| Near a point | Worker computes `gridDisk`, then `WHERE h3 IN (...)` (small k) | bounded |
| Point-in-territory / geofence | `JOIN territory_cells t ON s.h3 = t.h3 WHERE t.territory_id = ?` | index seeks |
| Zone rollup / heatmap | `GROUP BY h3_r8` | index scan on parent |
| Coarse region (avoid huge IN) | `WHERE h3 BETWEEN ?lo AND ?hi` (from `cellToChildren` first/last) | range scan |
| **Repeated group lookup** | `SELECT payload FROM h3_group_cache WHERE group_key = ?1` | **1 row — cheapest** |

> **Bound-parameter cap:** D1 limits bound parameters to ~100 per statement. A polyfill of a city-sized territory is thousands of cells — never `IN` that; use the `territory_cells` **JOIN** or a `BETWEEN` range. `IN` is only for small k-rings.

---

## 5. The read path (serving a user search)

Order of resolution, each falling through only on a miss:

```ts
async function getGroup(env, groupKey, ctx) {
  // L0 — in-isolate (free, ephemeral, per-isolate)
  const local = ISOLATE_CACHE.get(groupKey);
  if (local && !isStale(local)) return local;

  // L1 — Cache API (free, per-PoP). Key includes data_version so refreshes age out old entries.
  const cacheKey = new Request(`https://cache/group/${groupKey}?v=${env.DATA_VERSION}`);
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const val = await cached.json();
    ISOLATE_CACHE.set(groupKey, val);
    return val;
  }

  // L2 — D1 hot serving tier (indexed, ~1 row, strongly consistent)
  const row = await env.DB
    .prepare("SELECT payload, data_version FROM h3_group_cache WHERE group_key = ?1")
    .bind(groupKey).first();
  if (row) {
    const val = JSON.parse(row.payload);
    ctx.waitUntil(caches.default.put(cacheKey, jsonResponse(val))); // warm edge async
    ISOLATE_CACHE.set(groupKey, val);
    return val;
  }

  // L3 — cold miss: hydrate from R2, single-flighted by a Durable Object
  return hydrateFromR2(env, groupKey, ctx);
}
```

**Cold-miss hydration (single-flight via Durable Object):**

```ts
async function hydrateFromR2(env, groupKey, ctx) {
  // One DO per parent cell serializes hydration so a sudden-hot cell doesn't stampede R2/D1.
  const id   = env.HYDRATOR.idFromName(parentOf(groupKey));
  const stub = env.HYDRATOR.get(id);

  // The DO: checks if hydration already done, else reads R2, processes, returns payload.
  const payload = await stub.hydrate(groupKey);  // RPC; concurrent callers await the same run

  // Serve immediately; persist to D1 only after repeated misses (promote-on-repeat).
  ctx.waitUntil(maybePromoteToD1(env, groupKey, payload));
  return payload;
}
```

**Key behaviours:**

- **Stale-while-revalidate.** Always return the current value immediately; refresh in the background with `ctx.waitUntil(...)`. Users don't block on hydration.
- **Single-flight.** A Durable Object keyed by the parent cell ensures one hydration runs per cold cell while the rest await its result — no thundering herd against R2/D1.
- **Promote-on-repeat.** Serve one-off cold reads straight from R2; only **persist to D1 after a cell is missed ≥ N times**. This stops D1 from becoming a full copy of R2.

---

## 6. The write / refresh paths

Three independent workloads, decoupled from the read path.

### 6.1 Ingestion: internet → R2 (daily/weekly)

- **Use Cloudflare Workflows, not a bare Cron Worker**, for anything multi-step (your embedding/impact ETL qualifies). Workflows are durable, resumable, retried, and survive mid-run failure — a plain Cron Worker is fragile for long multi-stage ETL and runs into the CPU ceiling.
- Fetch source data, clean it, **bucket by a coarse parent cell**, and write **one blob per coarse parent** (see object-granularity rule below). Stamp each blob with a `data_version`.
- Path scheme: `groups/r7/{parentH3}.json` (or `.bin`/Parquet for size efficiency). The H3 hierarchy *is* the path.

```
groups/r7/8728347ffffffff.json     ← all fine cells under this r7 parent
groups/r7/872830828ffffff.json
meta/data_version                  ← current version pointer
```

### 6.2 Proactive refresh: R2 → D1 for hot cells (no user request needed)

- A scheduled Worker reads the **top-N hot cells** (from the popularity signal, §7) and refreshes their `h3_group_cache` rows from the latest R2 blobs.
- Upsert with the new `data_version`. This keeps popular data warm and current in D1 before users ask.

```sql
INSERT INTO h3_group_cache (group_key, res, payload, member_count, data_version, updated_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6)
ON CONFLICT(group_key) DO UPDATE SET
  payload=excluded.payload, member_count=excluded.member_count,
  data_version=excluded.data_version, updated_at=excluded.updated_at;
```

### 6.3 Eviction: D1 → R2-only (keep the working set small)

- A scheduled job **drops stale/cold rows** from `h3_group_cache` (e.g. not requested in X days and below the popularity threshold). Their data still lives in R2; only the hot copy in D1 is removed.
- Without eviction, lazy hydration slowly turns D1 into a full copy of R2 and you lose the storage + index-cost benefit. Eviction is what keeps D1 = *working set*, not *everything*.

---

## 7. Popularity signal (what to proactively warm)

You need to know which cells are hot — **but don't increment a counter on every read** (that's a D1 write per read at $1/M and destroys your read-cheapness).

- **Use Analytics Engine** for cheap, high-cardinality event logging: write one data point per request tagged with the cell key, then query top-N cells on a schedule.
- Alternative: a **sampled or batched** counter (e.g. count 1-in-K, or aggregate in a Durable Object and flush periodically).
- Feed the top-N into the **proactive-refresh set** (§6.2) and use the same ranking to decide eviction (§6.3).

---

## 8. Consistency and versioning

Staleness compounds across tiers: R2 update → D1 stale until refreshed → Cache stale until TTL. Manage it with **versioning, not purging**:

- Maintain a **`data_version`** (or per-group `updated_at`). Put it in the **Cache API key** (`?v=${version}`). A refresh produces new keys; old entries age out naturally. This avoids fighting per-PoP invalidation — `caches.default.delete()` is **per-colo, not global**.
- Stamp **D1 payloads** with the same version so the refresh job knows what's current and clients can detect staleness.
- D1 is your **strongly consistent** source for the working set; R2 is the **durable** source of record. KV (if used at all) is **eventually consistent** (~up to 60s propagation) — never your source of truth.

---

## 9. Cost guardrails — the things that bite

| Pitfall | Why it hurts | Guard |
|---|---|---|
| Unindexed filter/join in a hot route | D1 scans → rows-read explosion (the $134-bill failure mode) | Index every queried column; verify `SEARCH USING INDEX` via `EXPLAIN QUERY PLAN`; run `ANALYZE` |
| One R2 object per fine H3 cell | Millions of tiny objects, millions of Class A writes ($4.50/M), slow cold reads, `list` in hot path (Class A) | Bucket by coarse parent; one blob per `r7` cell; never `list` on the hot path |
| Cold-miss stampede | Many requests miss D1 at once → duplicate R2 reads + D1 write contention | Single-flight with a Durable Object keyed by parent cell |
| Lazy-hydrating every cold cell forever | D1 becomes a full copy of R2 → lost storage/index benefit | Promote-on-repeat (≥ N misses) + scheduled eviction |
| Counting reads via D1 writes | $1/M write per read; kills read-cheapness | Analytics Engine or sampled/batched counters |
| Caching precomputed groups in KV | KV read ~500× an indexed D1 read; eventually consistent | Serve from indexed D1 + free Cache API instead |
| KV reads of missing keys | Even null/404 reads are billed | Avoid KV as a probe; check existence in D1 |
| Vectorize on a large index | Query cost = (queries + **all stored vectors**) × dims → scales with index size | Keep dimensions small, prune the index, or use pgvector if the cost curve fits better |
| Bare Cron for heavy ETL | No resumability/retry; CPU ceiling | Cloudflare Workflows |
| Bound-parameter cap (~100) | Large `IN (...)` over polyfilled cells fails/blows up | JOIN against `territory_cells`, or `BETWEEN` range |

---

## 10. Decision rules (the summary you'll actually reference)

- **Total data ≫ hot working set?** → Use the R2-cold / D1-hot tiering below. **Otherwise** (whole dataset fits in a few hundred MB) → just keep everything in indexed D1; the R2 tier is over-engineering.
- **Slowly-changing groups** (stop sets, territories, routes) → **precompute into `h3_group_cache`** during data prep; front with free Cache API. Refresh on data change.
- **Fast-changing data** → skip precompute (it thrashes); serve live indexed D1 reads with a **short-TTL Cache API**.
- **Repeated identical group lookups** → cost ladder: **indexed D1 precomputed read** first, then **Cache API / in-isolate** (free), **KV last** (latency/global only, not cost).
- **Pure key→value, global, eventual-consistency-tolerant, latency-critical** → KV. **Anything relational, or where you want cheap + strongly consistent** → D1.
- **Large blobs / size-efficient cold storage / media** → R2 (no egress).
- **Cross-cell analytical queries** (event-impact, "all events matching X across territories") → a **separate queryable tier** (R2 SQL + Parquet/DuckDB, Postgres, or Vectorize for embeddings) — **never** the H3-keyed serving blobs.
- **Real spatial SQL / nearest-neighbour at scale** → Postgres + PostGIS via Hyperdrive (no Cloudflare surcharge).
- **Live per-entity coordination/state** (live vehicle session, rate limiting) → Durable Objects.

---

## 11. Anti-patterns (do NOT do)

- **Don't avoid joins.** Joins on indexed keys are cheap (`SEARCH USING INDEX`). Avoiding them breeds N+1 (more total rows read + more round-trips) or over-denormalization. The enemy is *scans* and *row multiplication*, not `JOIN`.
- **Don't flatten everything into one mega-table** to dodge joins. It causes duplication, update anomalies (more write cost + consistency bugs), and often *more* rows scanned. Model relationally with indexes.
- **Don't use KV as a cost-saving cache** over indexed D1. It's more expensive per read and eventually consistent. Use it for global low-latency / scan-proofing only.
- **Don't `list` R2 in the hot path.** It's a Class A operation. Address objects by deterministic H3-derived key.
- **Don't query *inside* R2 blobs.** They're opaque — serve-by-key only. Analytical queries need a separate queryable store.
- **Don't invalidate Cache API globally** expecting a single purge to clear all PoPs. Version the key instead.
- **Don't count popularity with per-read D1 writes.** Use Analytics Engine or sampling.

---

## Appendix — quick reference rates (2026, verify)

```
D1:         read $0.001/M rows · write $1.00/M rows · storage $0.75/GB-mo
            incl: 25B read · 50M write · 5 GB
KV:         read $0.50/M · write/delete/list $5.00/M · storage $0.50/GB-mo
            incl: 10M read · 1M write/delete/list · 1 GB   (eventually consistent; null reads billed)
R2:         Class A $4.50/M · Class B $0.36/M · storage $0.015/GB-mo · egress $0
            incl: 1M A · 10M B · 10 GB
Durable Obj:req $0.15/M · duration $12.50/M GB-s · SQLite storage $0.20/GB-mo (rows = D1 rates)
            incl: 1M req · 400K GB-s · 5 GB
Vectorize:  queried $0.01/M dims · stored $0.05/100M dims
            incl: 50M queried · 10M stored   (query cost scales with index size)
Cache API:  free per operation (per-PoP, evictable)
In-isolate: free (ephemeral, per-isolate)
Hyperdrive: no Cloudflare surcharge (pay external Postgres)
Workers:    $0.30/M requests · $0.02/M CPU-ms · subrequests NOT billed
            incl: 10M req · 30M CPU-ms
```
