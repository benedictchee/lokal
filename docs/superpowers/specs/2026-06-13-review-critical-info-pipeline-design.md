# Review → Critical-Information Pipeline — Design

**Status:** Approved (design dialogue 2026-06-13)
**Subsystem:** #4 Data pipeline (`apps/data-pipeline`, `packages/pipeline-core`)
**Goal:** Turn raw, noisy place reviews into cross-validated, denoised **critical
information** that is embedded into Vectorize for semantic search and stored in
D1 for fast read access. Raw reviews are never shown to the user — they are
input signal only.

---

## 1. Principles (settled in design)

1. **Raw reviews are internal.** Scrape and keep **as many as possible** (no
   review cap in production; any cap is an MVP throttle only). Raw reviews land
   in **R2 cold storage** for replay/audit.
2. **Extract, don't summarise.** The pipeline extracts *critical information*
   (validated facts/attributes), not a prose summary. Cross-validate across
   reviews (a point corroborated by multiple reviewers is signal; a one-off is
   noise), dampen noise (transient complaints, filler, off-topic, contradicted).
3. **One derived artifact, two homes.** The critical information is **embedded
   into Vectorize** (search) **and** stored in **D1** (easy access / serving).
4. **Incremental, time-based delta.** Each run processes reviews **new since the
   last snapshot**, decided by **time** (per-source loose date/period filtering).
   Re-including or missing some reviews across the gap is acceptable.
5. **Best-effort dedup, no global in-memory set.** Fingerprint dedup is
   **partitioned by place** and backed by **D1** (`INSERT OR IGNORE` on a unique
   index). Nothing holds the global fingerprint set in memory.

## 2. Why D1 for dedup (cost, verified 2026-06-13)

Dedup is operation-bound, not storage-bound. D1 row read `$0.001/M` vs R2
HeadObject (Class B) `$0.36/M` → **360× cheaper** to check; D1 row write
`$1.00/M` vs R2 PutObject (Class A) `$4.50/M` → **4.5× cheaper** to store. D1
free tier (25B reads / 50M writes per month) dwarfs R2's (10M B / 1M A). R2's
only edge — `$0.015/GB-mo` storage — is irrelevant for tiny fingerprints /
0-byte markers. **R2 keeps the raw review payloads** (cheap storage, zero
egress); **D1 keeps the fingerprint index + critical information.**

## 3. Data flow (per place, per run)

```
scrape reviews (loose time/period filter)
  → fingerprint each (sha256(normalize(author+text)), truncated)
  → D1 INSERT OR IGNORE into review_fingerprints (place_id, fingerprint)
       newly-inserted rows (meta.changes) = genuinely new reviews
  → append new raw reviews to R2 cold (raw/reviews/<source>/<place_id>.ndjson)
  → if new reviews exist:
       load existing critical_info from D1 (if any)
       LLM extract: (existing critical_info + new reviews)
                    → updated critical_info  [denoise + cross-validate + extract]
       store critical_info to D1 (place_critical_info), set last_processed_at
       embed (name + category + serialize(critical_info)) → Vectorize upsert
```

Cross-validation accumulates without re-reading the full raw corpus: the LLM is
fed the **prior critical_info plus the new reviews**, and returns the merged,
re-validated critical_info. This keeps each run bounded even as total reviews
grow unbounded.

## 4. Critical information representation

Structured facets (JSON) — *extracted*, each containing only cross-validated
items (corroborated by ≥2 reviews, or stated by the model as consensus):

```jsonc
{
  "specialties":          ["double-roasted pork belly", "zi char"],
  "atmosphere":           ["buzzy", "cramped at peak"],
  "good_for":             ["groups", "local food"],
  "consistent_praise":    ["bold smoky flavour", "great value"],
  "consistent_complaints":["long queues", "cash only"],
  "practical":            ["cash preferred", "go early"]
}
```

- **Vectorize input:** deterministic dense serialization of the facets, prefixed
  with `name + category` for entity anchoring (replaces the bare address line in
  `composeEmbedText` for places that have critical_info).
- **Easy-access store (D1):** the JSON itself + the serialized text +
  `updated_at`. This is the single artifact (the separate "summary" step folds
  into this per principle 3).

Empty/insufficient evidence → omit the facet. A place with no usable reviews
keeps the existing `name + category + address` embedding.

## 5. Schema & storage

**D1 (new tables; additive — never edit existing migrations):**

```sql
CREATE TABLE review_fingerprints (
  place_id    TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  first_seen  TEXT NOT NULL,           -- ISO timestamp
  PRIMARY KEY (place_id, fingerprint)  -- unique index = the dedup
);

CREATE TABLE place_critical_info (
  place_id        TEXT PRIMARY KEY,
  record_uuid     TEXT NOT NULL,       -- ties to the TravelRecord / Vectorize id
  critical_json   TEXT NOT NULL,       -- the facets JSON
  embed_text      TEXT NOT NULL,       -- serialized facets used for embedding
  review_count    INTEGER NOT NULL,    -- reviews seen so far (cumulative)
  updated_at      TEXT NOT NULL,
  last_processed_at TEXT NOT NULL      -- time watermark for the next delta
);
```

**R2 cold (raw):** `raw/reviews/<source>/<place_id>.ndjson` — append-only raw
review lines (author, stars, date, text, scraped_at). Source of truth for replay.

**Vectorize:** unchanged shape (1024-dim bge-m3, metadata pointers). For places
with critical_info, the vector is the embedding of the serialized facets.

## 6. Fingerprint

`fingerprint = base16(sha256(normalize(author + "" + text)))[0:16]`
(8 bytes / 16 hex chars; collisions negligible at these volumes). `normalize`
= lowercase, collapse whitespace, strip punctuation — so trivial variants
collapse. Scoped per `place_id`, so identical text at different places never
collides.

## 7. Model

Extraction is a reasoning task (validate + denoise), not phrasing. Use
`@cf/meta/llama-3.3-70b-instruct-fp8-fast` (Workers AI). Swappable via a constant.
The prompt instructs: read all provided reviews + prior critical_info; keep only
points corroborated by multiple reviewers or already established; drop transient,
one-off, generic, off-topic, or contradicted claims; output the facets JSON only.
At 92 places the cost is trivial; the quality gain over an 8B model is worth it.

## 8. Scope

**MVP (this build):** the 92 Google places already scraped (~8 reviews each).
First run = all current reviews (no prior snapshot); proves extract → validate →
embed → store → search end-to-end. Local D1 + local R2 lake via
`getPlatformProxy`; AI + Vectorize hit cloud (matches existing tooling).

**Production (designed-for, not built now):** uncapped review scraping;
incremental time-delta runs; cloud D1 serving tier; cron-driven refresh.

## 9. Components / files

- `packages/pipeline-core/src/reviews/fingerprint.ts` — normalize + hash.
- `packages/pipeline-core/src/reviews/critical-info.ts` — facets type, JSON↔text
  serialization, the LLM extraction prompt + a pure parse/validate of the model
  output (LLM call injected, so it's unit-testable without the network).
- `packages/pipeline-core/src/normalize/embed.ts` (existing `composeEmbedText`)
  — extend to prefer `critical_info` embed text when present.
- `apps/data-pipeline/migrations/` — D1 migration for the two tables.
- `apps/data-pipeline/scripts/refine-reviews.ts` — orchestrator: fingerprint
  dedup (D1) → cold-store new raw (R2) → extract (AI) → store (D1) → embed +
  upsert (Vectorize). Reads the Google scrape for the MVP.
- `apps/data-pipeline/wrangler.sim.jsonc` — add the D1 binding.

## 10. Error handling & idempotency

- Dedup is idempotent (unique index). Re-running a place with no new reviews is a
  no-op (skips the LLM + embed).
- LLM returns malformed JSON → parse guard retries once with a stricter prompt,
  then skips the place (logged) without corrupting stored critical_info.
- Embed/upsert keyed by `record_uuid` → idempotent re-upsert.
- A place that errors does not block the others (per-place try/catch + summary).

## 11. Testing

- `fingerprint`: unit tests — normalization collapses trivial variants; different
  text → different hash; per-place scoping.
- `critical-info`: unit tests on the pure parse/validate — well-formed model
  output parses; malformed is rejected; serialization is deterministic; empty
  facets handled.
- `refine-reviews`: small-scale live run over the 92 places; assert D1 rows
  created, Vectorize count stable/idempotent on re-run, and a search that only
  matches on review-derived language (e.g. "smoky wok-fried flavour", "cash only
  old-school spot") surfaces the right place — proving critical info is in the index.

## 12. Vectorize usage, retention & cost (verified 2026-06-14)

Capabilities checked against Cloudflare docs on 2026-06-14; they shape how the
derived artifact lives in Vectorize and how it ages out.

**Minimal records — Vectorize is an index, not a datastore.** Per vector we keep
only the embedding, a stable id (`record_uuid`), a few *filterable* metadata fields
(place_id, category, time/geo bucket), and a pointer back to D1/R2. Raw and compressed
text never go in the vector. Metadata size does **not** affect billing (10 KiB/vector
cap; indexed strings index only the first 64 bytes) — so "minimal" buys query speed and
headroom, not a lower bill. The two real cost levers are **vector count** and
**dimensions**:

- Compressing N raw reviews per place into 1–few critical-info embeddings cuts stored
  *and* queried dimensions proportionally (and is better LLM signal).
- Embedding dimension is a direct multiplier (384 / 768 / 1024 ≈ 2.7× spread). The build
  uses 1024-dim bge-m3 (§5); move to a smaller model only if recall holds.

**Cold + hot → LLM.** Query Vectorize → get ids/pointers → hydrate the *cold* compressed
critical_info from D1 (raw payloads stay in R2 cold) → merge with *hot* live data (price,
availability, current conditions) → hand to the LLM for secondary planning. Vectorize
does semantic retrieval only.

**Partitioning.** Namespaces are flat, single-level string labels (≤64 bytes; ~1,000 per
index on free, up to 50k paid). No nesting, no prefix/wildcard match; a vector lives in
exactly one namespace; a query targets **one** namespace or none (no cross-namespace
query). For cross-cutting selection (e.g. "all stores, 2026 only") use **metadata
filters** (`$in`, ranges, combinable) and reserve a namespace for the one hard partition
you always scope to. A query may combine a namespace + a metadata filter.

**Retention / expiry — design for it; there is no TTL.** Deletion is `deleteByIds`
**only** — no delete-by-namespace, no delete-by-filter, no auto-expiry. Two viable
patterns for annual roll-off:

- *Index-per-period (preferred for whole-cohort expiry):* one index per retention window
  (`reviews-2026`…). Expiring a year is `wrangler vectorize delete reviews-2025` — instant,
  no id list. Cross-year queries fan out across indexes; all shards must share
  dimensions/metric (index config is immutable).
- *D1-ledger sweep (one index, mixed cohorts):* we already map Vectorize hits → D1
  `place_critical_info`, so delete by query —
  `SELECT record_uuid FROM place_critical_info WHERE last_processed_at < :cutoff` → batch
  into `deleteByIds` (≤1,000 ids/call). Replaces paginating `list-vectors` and needs no
  cleanup-only metadata index. Use ULIDs / deterministic ids, **not** a hand-rolled
  incrementing counter (needs an atomic source, buys nothing).

Both paths: deletes are async (queryable change in ~5–10 s), are **not billed**, and
*reduce* stored-dimension cost.

**Export (migration off Vectorize).** No single dump endpoint, but `list-vectors`
(paginated, 1,000 ids/page) + `getByIds` (values + metadata) reconstructs a full export
to NDJSON. Neither is a similarity *query*, so neither is billed as queried dimensions —
export is effectively free from Vectorize's side (cost is just the compute/egress running
the loop). If the target DB re-embeds from source text, you often only need to export
ids + metadata.

**Cross-cloud / AWS access.** Vectorize has a plain REST API
(`POST /client/v4/accounts/{account_id}/vectorize/v2/indexes/{index}/{insert|upsert|query|get_by_ids|delete_by_ids|list_vectors}`),
auth via account id + API token (official Python client exists). Any AWS compute
(Lambda/ECS/EC2) can call it over HTTPS — but it's public-internet HTTPS to Cloudflare's
API (no VPC peering / PrivateLink), so factor cross-cloud latency, the HTTP-API batch
ceiling (5,000 vectors/call), and the ~5–10 s mutation lag.

**Pricing model (Workers Paid).** Billed on two metrics only:

| Metric | Free | Paid |
|--------|------|------|
| Stored vector dimensions | 5M | first 10M free, then `$0.05 / 100M` |
| Queried vector dimensions | 30M / mo | first 50M / mo free, then `$0.01 / 1M` |

Queried dimensions ≈ `(stored_vectors + queries) × dimensions` per month — a query's
billable cost scales with **total vectors in the index**. Not billed: CPU, memory, active
hours, number of indexes, or namespaces. This is the cost case for index-per-shard +
compression: a query on a small yearly shard doesn't pay for other years' vectors.

---

## 13. Out of scope

Consumer API, Flutter app (deferred until frontend design), cron automation
(disabled in prototyping), and any user-facing rendering of critical info.
