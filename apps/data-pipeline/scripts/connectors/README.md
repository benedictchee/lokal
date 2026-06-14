# Prototype scraper framework

Exploratory harness to answer, for every source in
[`docs/research/travel-data-sources-catalog.md`](../../../../docs/research/travel-data-sources-catalog.md),
two questions with a **runnable experiment**:

1. **Is pulling data doable?** (real fetch / probe — if it fails, drill down separately)
2. **Can we cheaply produce a delta?** — a per-source **fingerprint** + incremental-pull
   method so we only ingest new/updated info since a prior snapshot, avoiding full re-pulls.

> Prototype status: not production. The trigger input is deliberately loose (every field
> optional). Production will **require** `sinceTimestamp` (the `last_snapshot_timestamp` contract).
> Dedup of records is handled **separately** downstream — connectors only emit the
> `content_hash` (per record) and `sourceFingerprint` (per snapshot) needed to dedup.

## One interface in, one envelope out

Every source implements `SourceConnector` ([core/types.ts](core/types.ts)):

```ts
connector.pull(input: PullInput, deps: ConnectorDeps): Promise<PullResult>
```

- **Trigger** (`PullInput`): `{ sinceTimestamp?, lastSnapshotFingerprint?, cursor?, limit?, region? }`
- **Output** (`PullResult`): uniform envelope with `status`, `sourceFingerprint`, `incremental`
  (the chosen delta method), `records` (each carrying `record_uuid` + `content_hash`), `cursor`,
  `unchangedSinceSnapshot`, and `notes`.

Connectors are built with `defineConnector(...)` ([core/connector.ts](core/connector.ts)), which
stamps timing, guarantees the run never throws, counts records, and short-circuits when the
`sourceFingerprint` matches `lastSnapshotFingerprint`.

It reuses the repo's pipeline-core primitives: `fnv1a` (the `content_hash`), `recordUuid` (stable
ids), and `TravelRecord` — so a promising connector graduates into the real pipeline unchanged.

## Source fingerprint = "did anything change since last snapshot?"

Each connector computes a `sourceFingerprint` via `sourceFp(method, components)`. The **method is
customised per source**, picking the cheapest signal that flips when the source changes:

| Method | Used when | Example sources |
|--------|-----------|-----------------|
| `release-date` / `release-tag` | bulk dataset with dated releases | Foursquare OS Places, Overture |
| `replication-sequence` | OSM-style replication state | OSM Planet/Geofabrik |
| `max-dateModified+count` | per-entity modified timestamp | Wikidata |
| `latest-timestamp+revid` | changes feed | Wikipedia, Wikivoyage |
| `rowsUpdatedAt+count` | dataset-level update time | Socrata (US open data) |
| `latest-diff-date+rows` | published daily diff files | GeoNames |
| `etag` / `last-modified` | HTTP headers (universal fallback) | any URL |
| `sitemap-lastmod-max` | no API; sitemap has `<lastmod>` | Tabelog, Wongnai, HappyCow… |
| `content-hash` | no timestamp anywhere (last resort) | anti-bot / closed sources |

## Incremental-pull methods (best → worst)

`api-since-param` › `changes-feed` › `dump-diff` › `sort-by-updated` / `sitemap-lastmod` ›
`etag-conditional` › `full-only` › `none`. Each connector declares the best realistic method for
its source in `plan.incremental` and applies it (using `input.sinceTimestamp`) when possible.

## Two paths per source + Chrome fallback

Every source has up to two ways in, and the framework prefers the sanctioned one:

1. **API/data path** — the default `ALL_CONNECTORS`. Pulls open data directly, or probes
   key/licence-gated APIs.
2. **Browser path** — a Chrome scrape of the public site ([browser/strategies.ts](browser/strategies.ts)),
   driven like a normal user: **one page, one visit per run**, human dwell + scroll + jitter,
   sequential with pacing — no pagination, no parallel hammering. Hard WAFs (DataDome/Cloudflare)
   are detected and expose a pluggable `BROWSER_PROXY` (residential/unblocker) escalation.

With **`--fallback`**, each API connector is wrapped ([core/fallback.ts](core/fallback.ts)) so that
when the API yields no data (`needs_key` / `needs_license` / `blocked` / `error`) it **auto-falls
back to that source's Chrome strategy**. 61 sources pair by identical id; 8 via an alias map
(`google-places→google-maps`, `tripadvisor-content→tripadvisor`, `naver-local→naver-map`, …).

### Classification — how each source's data is actually obtainable

Every `PullResult` is stamped with a `classification` (and `path`, `apiStatus`, `fallbackAvailable`):

| Classification | Meaning |
|----------------|---------|
| `open` | pull directly, no credentials (Tier A) |
| `api-key` | API works with a key **+ Chrome fallback wired** |
| `api-license` | API behind a paid/partner licence **+ Chrome fallback wired** |
| `browser` | no usable public API — Chrome scrape is the path |
| `browser+proxy` | Chrome reaches it but a WAF needs a residential `BROWSER_PROXY` |
| `no-public-source` | no public API **and** no public website (pure data provider) |

See [FINDINGS.md](FINDINGS.md) for the per-source results (97 sources: open 11 · api-key 26 ·
api-license 32 · browser 26 · no-public-source 2 → **95/97 obtainable**).

## Running

```bash
cd apps/data-pipeline

# list everything
npx tsx scripts/connectors/run.ts --list

# one connector, verbose
npx tsx scripts/connectors/run.ts wikidata --limit=10 --verbose

# a whole tier
npx tsx scripts/connectors/run.ts tierA --since=2026-05-01T00:00:00Z --concurrency=6

# everything (writes out/<id>.json + out/_summary.json, prints status + classification matrix)
npx tsx scripts/connectors/run.ts all --concurrency=8

# API run WITH Chrome fallback where the API yields no data (sequential, human-paced)
npx tsx scripts/connectors/run.ts all --fallback

# scrape the public site directly via Chrome (the browser pool), one page/visit per source
npx tsx scripts/connectors/run.ts tabelog,wongnai --browser --verbose

# route the browser path through a residential proxy / unblocker for WAF-walled sites
BROWSER_PROXY=http://user:pass@host:port npx tsx scripts/connectors/run.ts yelp --browser
```

API keys are read from `process.env` (e.g. `GOOGLE_MAPS_API_KEY`, `YELP_API_KEY`,
`OPENTRIPMAP_KEY`, `NAVER_CLIENT_ID`/`NAVER_CLIENT_SECRET`, `REDDIT_CLIENT_ID`, …). Without a key,
a keyed source returns `needs_key` after a real probe that confirms the gate.

## Status legend

`🟢 ok` real data pulled · `🟡 partial` some data / caveats · `🔑 needs_key` API needs a credential ·
`📄 needs_license` paid/partner license required · `🔴 blocked` no sanctioned access (anti-bot / closed) ·
`💥 error` unexpected failure.

> **Legality note:** tiers come from the source catalog. This prototype assumes licences are in
> hand (per the task brief). `blocked`/`needs_license` reflect *technical/ToS* access, not a
> decision to bypass it — production must respect each source's terms.

## Layout

```
core/        types, connector wrapper, fingerprint+probe helpers, web/duck/browser helpers,
             fallback (API→Chrome) wrapper, runner, registry
tierA/       open/bulk-ingestible (live experiments: Wikidata, OSM, GeoNames, Foursquare, Overture, …)
tierB/       licensable-commercial
tierC/       API display/lookup-only
tierD/       partner/affiliate-gated
tierE/       scrape-only / no sanctioned access
browser/     Chrome browser-scrape strategies (starter + per-cluster) → 68 browser connectors
out/         per-connector PullResult JSON + _summary.json (gitignored)
_gen/        workflow scripts + assemblers + doability probes (how B–E + browser strategies were generated)
```
