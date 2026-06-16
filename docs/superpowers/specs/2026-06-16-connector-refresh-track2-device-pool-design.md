# Connector Refresh — Track 2: Device-Pool DOM Ingest (Pilot) — Design

> Status: **Draft for review** · Date: 2026-06-16 · Subsystem: `apps/data-pipeline`
> Author: brainstormed with Claude Code
> Follows: `2026-06-16-connector-refresh-loop-design.md` (Phase 1, PR #6) and
> `2026-06-14-device-fetch-pool-design.md` (the pool coordinator + device app).

## 1. Summary

Finish the device fetch pool's "DOM → record" TODO: turn the post-JS DOM that devices
upload into `PulledRecord`s with a **server-side extractor**, and feed those records into the
**existing Phase-1 refresh changed-set** (two-level diff → merge `groups/r7` → enrich →
Vectorize). Extraction is expressed once as a **declarative, Playwright-free strategy** shared
by both the Worker (device path) and the Playwright prototype CLI.

This is the **coordinator side** of Track 2, piloted on the **starter 7** browser connectors.
It is fully testable now with **captured-DOM fixtures**; it produces **live data only once the
Android fetcher device app ships** (a separate build — see §11).

## 2. Goals / Non-goals

**Goals**
- A **server-side extractor**: device-rendered DOM (from R2) → `PulledRecord[]`, via a
  declarative per-connector extraction shared with the Playwright path.
- **Content-hash skip**: re-extract only when a URL's DOM actually changed (closes the gap
  Phase 1 noted — the pool stores `content_hash` but never compares it).
- **Rejoin Phase 1**: extracted records flow through the existing diff → merge → enrich spine
  via a factored `ingestPulledRecords` (shared by the API and device paths).
- **Zero Playwright / zero DuckDB in the Worker bundle** (verified, as in Phase 1/Track 1).
- Pilot the **starter 7**: `google-maps`, `tabelog`, `wongnai`, `2gis`, `yelp`, `tripadvisor`,
  `atlas-obscura-web`.

**Non-goals (this spec)**
- **No device app.** The Kotlin/Android fetcher is a separate build (§11). This spec is the
  coordinator side; devices are simulated by fixtures + `POST /pool/results`.
- **No scale-out to all 68** browser connectors. The other 61 keep the old signature until a
  follow-up migrates them (§10).
- **No live-scrape verification** (no real devices in CI). Extraction is verified against
  captured-DOM fixtures.
- **No discovery/crawling.** One enrolled listing URL per connector (consistent with the pool
  spec's "refresh a known URL set").

## 3. Decisions captured (from brainstorming)

| Topic | Decision |
|-------|----------|
| Deliverable | Coordinator-side pipe; device app out of scope |
| Pilot scope | Starter 7 browser connectors |
| Extraction model | Declarative config **shared** by Playwright + Worker (one source of truth) |
| Parser | `linkedom` (isomorphic — runs in Node CLI and workerd; forced by "shared") |
| Trigger | Queue-driven (`travel-extract`); content-hash skip at `/pool/results` time |
| Routing | `pool_url_registry.source` column maps a URL/DOM to its connector |
| Downstream | Reuse Phase-1 spine via a factored `ingestPulledRecords` |

## 4. Architecture & data flow

```
device renders page ──► POST /pool/results  (exists)
   store gzipped DOM in R2 (pool/<urlHash16>/<ts>-<leaseId>.html.gz), compute contentHash
   ── compare contentHash vs pool_url_registry.content_hash ──┐
        unchanged → markFetched(bump next_due_at), STOP        │   content-hash skip
        changed   → markFetched(new hash), enqueue EXTRACT ────┤
                       { r2Key, url, source }                  ▼
   travel-extract consumer (NEW):
     R2.get(r2Key) → gunzip → parseHTML (linkedom) → connector by `source`
       → strategy.extract(doc, url, limit) → ScrapedItem[] → mkRecord → PulledRecord[]
       → ingestPulledRecords(env, source, mapping, records, sourceFingerprint, ctx)
            └ diff vs record_state → materialize TravelRecord → MERGE groups/r7
              → enqueue ENRICH (existing) → Vectorize
```

The device path rejoins the **exact** Phase-1 downstream; only the front-end (DOM→records) and
the content-hash skip are new.

## 5. The shared static-DOM extractor

### 5.1 Interface change
`BrowserStrategy.extract` moves off Playwright's `Page`:

```ts
// before: extract: (page: Page, limit: number) => Promise<ScrapedItem[]>
// after:  extract: (doc: Document, baseUrl: string, limit: number) => ScrapedItem[]
```

`doc` is a `linkedom`-parsed document (standard `querySelectorAll`/`getAttribute`/
`textContent`); `baseUrl` resolves relative `href`s. Pure + synchronous → unit-testable on an
HTML string, identical in Node and workerd.

### 5.2 The shared `anchors` helper (ported)
```ts
export function anchors(doc: Document, baseUrl: string, selector: string,
                        idFrom: (href: string) => string, limit: number): ScrapedItem[] {
  return [...doc.querySelectorAll(selector)].slice(0, limit).map((a) => {
    const href = new URL(a.getAttribute('href') ?? '', baseUrl).toString();
    const name = (a.textContent ?? '').trim().replace(/\s+/g, ' ');
    return { sourceId: idFrom(href), name, url: href, raw: { href, name } };
  }).filter((x) => x.sourceId && x.name);
}
```
6 of the 7 starter connectors are one-liners over this helper — their `selector` + `idFrom`
regex are unchanged. `google-maps` (aria-label name + place-id regex) ports directly.

### 5.3 Module boundary (keeps Playwright out of the Worker)
Because `extract` is now Playwright-free, the strategy objects are pure data; only the
*wrapper* touches Playwright. Split accordingly:

- **`core/browser-strategy.ts` (new, Playwright-free):** `BrowserStrategy` + `ScrapedItem`
  types + the `anchors` helper. Imports only `parse-html.ts` + connector types.
- **`core/parse-html.ts` (new):** the `linkedom` `parseHTML` wrapper — the one isomorphic seam.
- **`browser/starter.ts` (refactor):** Playwright-free data (`BrowserStrategy[]`) importing
  only the two modules above → **Worker-importable** (added to tsconfig include).
- **`core/browser-connector.ts` (refactor):** keeps `defineBrowserConnector` (Playwright); now
  does `const doc = parseHTML(await page.content()); s.extract(doc, url, limit)` so the CLI runs
  through the **same** extractor. Playwright stays quarantined here + in `browser.ts`; the
  Worker never imports either.

## 6. Device-pool wiring

### 6.1 Routing — `pool_url_registry.source`
Migration `0005_pool_source.sql` adds `source TEXT` to `pool_url_registry`. Enrollment sets it;
the extractor reads it to choose the connector. (Nullable; existing rows unaffected.)

### 6.2 Enrollment
`enrollPilotSources(env, region?)` upserts each pilot connector's `listUrl(input)` into
`pool_url_registry` with `{ source, host, wait_for_selector, dwell_ms, tier }`. Seedable now;
a thin `POST /pool/enroll` (auth-gated) can trigger it. The pilot strategies expose
`listUrl`/`waitFor`/`tier` already.

### 6.3 Content-hash skip (in `POST /pool/results`)
After computing `contentHash` and storing the DOM in R2:
- read `pool_url_registry.content_hash` for `lease.url`;
- **equal → `markFetched(url, contentHash, now, nextDue)` and return** (no extraction);
- **different → `markFetched(...)` + enqueue** `{ r2Key: key, url, source }` onto `travel-extract`.

`source` comes from the registry row. `markChallenge`/backoff behavior is unchanged.

### 6.4 `travel-extract` queue + consumer
New producer/consumer binding (mirrors `ENRICH`), with a DLQ. The consumer
(`src/pool/extract-consumer.ts`):
1. `R2.get(r2Key)` → gunzip → `parseHTML`;
2. resolve the connector's strategy by `source` (a Worker-side pilot registry, imported from
   the Playwright-free `starter.ts`);
3. `strategy.extract(doc, url, limit)` → `ScrapedItem[]` (`limit` default 25, matching the
   browser-connector cap);
4. `mkRecord(source, it.sourceId, it.raw, {...})` → `PulledRecord[]`, each with
   `source_url = it.url`;
5. `ingestPulledRecords(env, source, mapping, records, ctx)`.

The device path does **not** touch `source_snapshot`: per-URL freshness already lives in
`pool_url_registry` (`content_hash`/`next_due_at`, updated by `markFetched` at `/pool/results`).
`source_snapshot` stays owned by the API path (§6.5).

Unrecoverable input (missing R2 object, unknown `source`, unparseable DOM) throws
`NonRetryableError` → DLQ (mirrors the enrich consumer).

### 6.5 `ingestPulledRecords` (factored from Phase-1 `run-refresh.ts`)
Extract the **record-level** back half of `runRefreshSource` (diff vs `record_state` →
materialize `TravelRecord` via `pulledToNormalized` + ER → merge `groups/r7` blobs → append
lake delta → enqueue `ENRICH` → upsert `record_state`) into:

```ts
ingestPulledRecords(
  env: RefreshEnv,
  source: string,
  mapping: ConnectorMapping,
  records: PulledRecord[],
  ctx: RefreshContext,
): Promise<RefreshSummary>
```

`runRefreshSource` (API path) calls it after `connector.pull`, then writes `source_snapshot`
itself (it owns the source-level fingerprint + `since_ts`). The extract consumer (device path)
calls it after extraction and does **not** write `source_snapshot` (per-URL state is in
`pool_url_registry`). One record-level downstream, two front-ends. The API path's behavior is
unchanged — this is a pure refactor with a new second caller.

## 7. Data model / config

- **Pilot mapping** — `{subject, category}` per pilot connector (mirrors Track 1's `sources.ts`):
  all `poi`; category per source (restaurants → `restaurant`, maps/dir → `poi`, atlas →
  `attraction`). Lives in a Worker-side pilot registry keyed by connector id.
- **`PulledRecord.source_url`** — set to the extracted item URL (the detail-page link), so the
  record records exactly where it came from (Track-1 contract).
- **Identity** unchanged: `record_uuid = recordUuid(source, sourceId)`, `content_hash = fnv1a`.

## 8. Error handling / edge cases

- **Challenge DOM reaches `/pool/results`** — handled today (challenge → backoff, never stored
  as success); unchanged. The extractor only ever sees non-challenge DOM.
- **0 items extracted** — selector drift; the consumer records a `partial`/empty result, enqueues
  nothing, still advances `record_state`/snapshot for what it saw (none). Logged for selector
  tuning. Not a crash.
- **Unknown `source`** (URL enrolled without a pilot strategy) → `NonRetryableError` → DLQ.
- **Merge concurrency** — the device path writes the same `groups/r7` blobs as the API path;
  the Phase-1 merge is read-modify-write per blob. Track 2 keeps the single-writer assumption
  (low pilot volume); the Phase-3 dedicated merge queue still applies when volume grows.
- **`linkedom` under workerd** — verify it bundles/runs in the Worker during implementation; if
  not, fall back to a Workers-compatible parser behind the same `parse-html.ts` seam (the only
  isomorphic dependency, so the blast radius is one file).

## 9. Testing

- **Extractor (unit, offline)** — for each pilot connector, a captured-DOM **fixture** (a real
  saved listing page) → `strategy.extract(parseHTML(html), url, limit)` yields the expected
  `{sourceId, name, url}` set. This is the core verification and needs no device.
- **Shared-path parity** — assert the refactored `anchors`/`google-maps` extractors produce the
  same shape the Playwright path expected (fixture-based).
- **Content-hash skip** — `POST /pool/results` with identical DOM twice: second call does not
  enqueue an extract message; changed DOM does.
- **Extract consumer (integration)** — feed a fixture through the consumer against miniflare
  D1+R2: assert it parses, extracts, merges a `groups/r7` blob, and enqueues `ENRICH` only for
  changed records (reuses the Phase-1 harness + a stubbed enrich queue).
- **`ingestPulledRecords` refactor** — the existing Phase-1 `run-refresh` tests stay green
  (proves the factor didn't change API-path behavior).
- **Regression + bundle** — full suite green; `tsc -b` clean; `wrangler deploy --dry-run`
  clean with **zero Playwright/DuckDB** (confirms the module boundary held).

## 10. Build order

1. `parse-html.ts` (linkedom) + `core/browser-strategy.ts` (types + `anchors`) — Playwright-free
   foundation; unit-tested on fixtures.
2. Refactor `browser/starter.ts` to the new `extract(doc, baseUrl)` signature; refactor
   `defineBrowserConnector` to `parseHTML(page.content())`. CLI prototype still works; the other
   61 strategies are untouched (not in tsconfig include, not imported by the Worker).
3. `ingestPulledRecords` factored out of `run-refresh.ts`; Phase-1 tests stay green.
4. Migration `0005_pool_source.sql` + enrollment + registry `source` read/write.
5. Content-hash skip in `/pool/results` + `travel-extract` queue + consumer; integration tests.
6. Full-suite + dry-run verification.

## 11. The live-data dependency (explicit)

This spec builds and **fixture-tests** the coordinator-side pipe. It yields **live data only
when real devices upload DOM**, which requires the **Android fetcher app** from
`2026-06-14-device-fetch-pool-design.md` (Kotlin, MDM, off-screen WebView) — a separate build,
almost certainly outside this TS monorepo. Until it ships, the pipe is exercised by `curl`-ing
`POST /pool/results` with captured DOM. Building it now finishes the pool's planned extractor
hop and de-risks extraction, so data flows the moment the app lands.

## 12. Follow-ups (not this spec)

- **Scale-out:** migrate the other 61 browser strategies to the shared `extract(doc, baseUrl)`
  signature; expand the pilot registry; enrollment governance against the source catalog.
- **The device app** (separate spec/repo).
- **Keyed/licensed API connectors** (Track 1 follow-up; secret injection).
- **Dedicated merge queue** (Phase 3) once blob-write volume rises.
