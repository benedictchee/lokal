# Running the data pipeline locally

The **producer** half of M1 runs fully locally with **no Cloudflare credentials** —
it does a real OpenStreetMap (Overpass) fetch and writes to **local Miniflare-backed**
R2 + D1 (persisted under `.wrangler/state/`). The CLI uses `wrangler.cli.jsonc`
(only the R2/D1/Queue bindings; the producer never calls AI/Vectorize).

## One-time

```bash
cd apps/data-pipeline
pnpm migrate:local        # create the groups + group_aliases tables in the LOCAL D1
```

## Ingest a region (real OSM data → local lake)

```bash
# bbox is [south, west, north, east] (minLat, minLon, maxLat, maxLon)
pnpm ingest --source osm --region penang --bbox 5.40,100.30,5.43,100.35 --data-version 1
```

Prints a summary, e.g.:

```json
{ "rawKey": "raw/osm/…", "lakeKey": "lake/poi/penang/v1.ndjson.gz", "blobCount": 7, "recordCount": 2245 }
```

This writes, into local R2:
- `raw/osm/<hash>` — the exact Overpass response (replayable)
- `lake/poi/<region>/v<dataVersion>.ndjson.gz` — the NDJSON lake (source of truth)
- `groups/r7/<h3_r7>` — the r7 cold-serving blobs

…and mints program `group_uuid`s into the local D1 `groups` registry.

## See it on a map

```bash
pnpm map                  # builds viz/georgetown.html from the local lake
open viz/georgetown.html  # opens in your default browser (file:// works in normal Chrome)
```

## What does NOT run locally

The **enrich tail** — `@cf/baai/bge-m3` embeddings → **Vectorize** upsert — has no
local emulation (Workers AI and Vectorize are cloud-only). To exercise it you need a
real Cloudflare account (Workers Paid): provision the resources (see the deploy
runbook), run the `bootstrap:vectorize` script to create the index + 6 metadata
indexes *before* any upsert, then let the deployed queue consumer run `enrichBatch`.

## Run the automated tests (also fully local)

```bash
pnpm -r test        # 96 tests: pipeline-core (Node) + data-pipeline (Miniflare) + DuckDB
pnpm run typecheck  # from the repo root
```
