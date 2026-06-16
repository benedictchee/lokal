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
