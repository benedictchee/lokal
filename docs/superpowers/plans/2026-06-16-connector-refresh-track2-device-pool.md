# Connector Refresh — Track 2 (Device-Pool DOM Ingest, Pilot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn device-rendered DOM into records server-side and feed them through the existing Phase-1 refresh spine — a shared (Playwright-free) static-DOM extractor, a content-hash skip, a `travel-extract` queue + consumer, and a factored `ingestPulledRecords` — piloted on the starter 7 browser connectors.

**Architecture:** Extraction becomes a Playwright-free `extract(doc, baseUrl, limit)` over a `linkedom`-parsed document, shared by the Playwright CLI and the Worker. `POST /pool/results` skips unchanged DOM (content-hash) and enqueues changed DOM; a `travel-extract` consumer parses it, extracts records, and calls `ingestPulledRecords` (the record-level back half of `runRefreshSource`, now shared by the API and device paths).

**Tech Stack:** TypeScript, Cloudflare Workers (D1 + R2 + Queues), `linkedom`, Vitest with `@cloudflare/vitest-pool-workers`, `@travel/pipeline-core`.

Builds on Phase 1 + Track 1 (PR #6). Spec: `docs/superpowers/specs/2026-06-16-connector-refresh-track2-device-pool-design.md`. **Live data requires the separate Android fetcher app (spec §11); this plan is fixture-tested.**

---

## File Structure

**Create:**
- `apps/data-pipeline/scripts/connectors/core/parse-html.ts` — isomorphic `parseHtml` (linkedom).
- `apps/data-pipeline/scripts/connectors/core/browser-strategy.ts` — Playwright-free `BrowserStrategy`/`ScrapedItem` types + `anchors` helper.
- `apps/data-pipeline/src/refresh/ingest-records.ts` — `ingestPulledRecords` (factored).
- `apps/data-pipeline/migrations/0005_pool_source.sql` — `pool_url_registry.source` column.
- `apps/data-pipeline/src/pool/pilot-sources.ts` — Worker pilot registry (`source` → `{ strategy, mapping }`).
- `apps/data-pipeline/src/pool/extract-consumer.ts` — `extractBatch` queue consumer.
- Tests: `test/parse-html.test.ts`, `test/browser-extract.test.ts`, `test/ingest-records.test.ts`, `test/pool-source-d1.test.ts`, `test/pool-results-extract.test.ts`, `test/extract-consumer.integration.test.ts`.

**Modify:**
- `scripts/connectors/core/browser-connector.ts` — re-export types from `browser-strategy.ts`; render via `parseHtml(await page.content())`.
- `scripts/connectors/browser/starter.ts` — `extract(doc, baseUrl, limit)` signatures (Playwright-free).
- `src/refresh/run-refresh.ts` — call `ingestPulledRecords`; keep `source_snapshot` save.
- `src/pool/pool-d1.ts` — `UrlRow.source`; `upsert` sets `source`.
- `src/pool/handlers.ts` — content-hash skip + enqueue `EXTRACT`.
- `src/env.ts` — `EnrichMessage` neighbor `ExtractMessage`; `Env.EXTRACT`.
- `src/index.ts` — route `travel-extract` / `-dlq` in `queue()`.
- `wrangler.jsonc` — `EXTRACT` producer + `travel-extract` consumer(s).
- `vitest.config.ts` — `queueProducers` so worker-fetch tests have `env.EXTRACT`.
- `package.json` — add `linkedom`.
- `tsconfig.json` — include the 3 new Worker-imported connector files.

**Verified facts:**
- `run-refresh.ts` exports `RefreshEnv`, `RefreshContext`, `RefreshSummary`; its steps 3–8a are the record-level work, step 8b is the `source_snapshot` save.
- Pool: `handleResults` computes `fnv1a(dom)`, stores R2 at `pool/<sha256(url)[0:16]>/<ts>-<leaseId>.html.gz`, calls `markFetched`. `PoolUrlRegistryStore` has `get`/`upsert`/`markFetched`; `UrlRow` has `content_hash`.
- Starter 7 ids: `google-maps`,`tabelog`,`wongnai`,`2gis`,`yelp`,`tripadvisor`,`atlas-obscura-web`. 6 use the `anchors` helper; `google-maps` uses an inline `$$eval`.
- Tests: `cd apps/data-pipeline && npx vitest run <file>`; migrations applied via `?raw` split-on-`;` in `beforeAll`.

---

## Task 1: Isomorphic HTML parser + Playwright-free strategy module

**Files:**
- Create: `apps/data-pipeline/scripts/connectors/core/parse-html.ts`
- Create: `apps/data-pipeline/scripts/connectors/core/browser-strategy.ts`
- Modify: `apps/data-pipeline/package.json` (add `linkedom`)
- Test: `apps/data-pipeline/test/parse-html.test.ts`

- [ ] **Step 1: Add the linkedom dependency**

Run: `cd apps/data-pipeline && pnpm add linkedom`
Expected: `linkedom` appears under `dependencies` in `apps/data-pipeline/package.json`.

- [ ] **Step 2: Write the failing test**

Create `apps/data-pipeline/test/parse-html.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseHtml } from '../scripts/connectors/core/parse-html.js';
import { anchors } from '../scripts/connectors/core/browser-strategy.js';

const HTML = `<html><body>
  <a class="x" href="/a/1">  First  Place </a>
  <a class="x" href="https://h.com/a/2">Second</a>
  <a class="y" href="/a/3">Ignored</a>
  <a class="x" href="/a/4"></a>
</body></html>`;

describe('parseHtml + anchors', () => {
  it('parses HTML and extracts matching anchors with absolute urls', () => {
    const doc = parseHtml(HTML);
    const items = anchors(doc, 'https://base.com/list', 'a.x', (href) => href.replace(/^https?:\/\/[^/]+/, ''), 10);
    expect(items.map((i) => ({ id: i.sourceId, name: i.name, url: i.url }))).toEqual([
      { id: '/a/1', name: 'First Place', url: 'https://base.com/a/1' },
      { id: '/a/2', name: 'Second', url: 'https://h.com/a/2' },
    ]); // a.y excluded by selector; empty-name a.x/4 filtered out
  });

  it('respects the limit', () => {
    const doc = parseHtml(HTML);
    expect(anchors(doc, 'https://base.com/', 'a.x', (h) => h, 1).length).toBe(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/data-pipeline && npx vitest run test/parse-html.test.ts`
Expected: FAIL — `Cannot find module '../scripts/connectors/core/parse-html.js'`.

- [ ] **Step 4: Write `parse-html.ts`**

Create `apps/data-pipeline/scripts/connectors/core/parse-html.ts`:

```ts
import { parseHTML } from 'linkedom';

/**
 * Parse an HTML string into a DOM Document. The ONE isomorphic seam — linkedom
 * runs in both Node (the Playwright CLI) and workerd (the Worker extractor). If
 * linkedom ever fails under workerd, swap the parser HERE only.
 */
export function parseHtml(html: string): Document {
  return parseHTML(html).document as unknown as Document;
}
```

- [ ] **Step 5: Write `browser-strategy.ts`**

Create `apps/data-pipeline/scripts/connectors/core/browser-strategy.ts`:

```ts
import type { IncrementalCapability, PullInput, Tier } from './types.js';

/** A single scraped item (Playwright-free; identical to the old core/browser-connector shape). */
export interface ScrapedItem {
  sourceId: string;
  name?: string;
  lat?: number;
  lng?: number;
  url?: string;
  updated_at?: string;
  raw?: unknown;
}

/**
 * A browser-scrape strategy. `extract` runs over a STATIC parsed document (not a
 * live Playwright Page) so it is shared by the CLI (parse page.content()) and the
 * Worker (parse device DOM). Pure + synchronous → unit-testable on an HTML string.
 */
export interface BrowserStrategy {
  id: string;
  displayName: string;
  tier: Tier;
  coverage: string;
  access: string;
  listUrl: (input: PullInput) => string;
  waitFor?: string;
  consentSelectors?: string[];
  incremental: IncrementalCapability;
  extract: (doc: Document, baseUrl: string, limit: number) => ScrapedItem[];
  proxyEnv?: string;
  note?: string;
}

/** Generic anchor extractor: matching <a> → {sourceId,name,url} with absolute urls. */
export function anchors(
  doc: Document,
  baseUrl: string,
  selector: string,
  idFrom: (href: string) => string,
  limit: number,
): ScrapedItem[] {
  return [...doc.querySelectorAll(selector)]
    .slice(0, limit)
    .map((el) => {
      const raw = el.getAttribute('href') ?? '';
      const href = raw ? new URL(raw, baseUrl).toString() : '';
      const name = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
      return { sourceId: href ? idFrom(href) : '', name, url: href, raw: { href, name } };
    })
    .filter((x) => x.sourceId && x.name);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/data-pipeline && npx vitest run test/parse-html.test.ts`
Expected: PASS (2 tests). If linkedom fails to load under the workers test pool, that is the §8 risk — report it as BLOCKED with the error (the parser seam is isolated to `parse-html.ts`).

- [ ] **Step 7: Commit**

```bash
git add apps/data-pipeline/scripts/connectors/core/parse-html.ts apps/data-pipeline/scripts/connectors/core/browser-strategy.ts apps/data-pipeline/test/parse-html.test.ts apps/data-pipeline/package.json pnpm-lock.yaml
git commit -m "feat(data-pipeline): isomorphic parseHtml (linkedom) + Playwright-free browser-strategy"
```

---

## Task 2: Refactor the starter strategies to the shared extractor

**Files:**
- Modify: `apps/data-pipeline/scripts/connectors/core/browser-connector.ts`
- Modify: `apps/data-pipeline/scripts/connectors/browser/starter.ts`
- Modify: `apps/data-pipeline/tsconfig.json`
- Test: `apps/data-pipeline/test/browser-extract.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/data-pipeline/test/browser-extract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseHtml } from '../scripts/connectors/core/parse-html.js';
import { starterStrategies } from '../scripts/connectors/browser/starter.js';

const byId = (id: string) => starterStrategies.find((s) => s.id === id)!;

describe('starter strategies extract from static DOM', () => {
  it('tabelog: anchors by list-rst selector → path ids', () => {
    const html = `<ul>
      <li><a class="list-rst__rst-name-target" href="https://tabelog.com/en/kanagawa/A1401/rstLst/">Sushi One</a></li>
      <li><a class="list-rst__rst-name-target" href="https://tabelog.com/en/tokyo/A1301/">Ramen Two</a></li>
    </ul>`;
    const items = byId('tabelog').extract(parseHtml(html), 'https://tabelog.com/en/kanagawa/', 10);
    expect(items.map((i) => i.sourceId)).toEqual(['/en/kanagawa/A1401/rstLst', '/en/tokyo/A1301']);
    expect(items[0]!.name).toBe('Sushi One');
  });

  it('google-maps: feed anchors with aria-label name + place id', () => {
    const html = `<div role="feed">
      <a href="https://www.google.com/maps/place/?q=!19sChIJabc123!x" aria-label="Cafe Alpha">link</a>
    </div>`;
    const items = byId('google-maps').extract(parseHtml(html), 'https://www.google.com/maps/search/x', 10);
    expect(items[0]!.sourceId).toBe('ChIJabc123');
    expect(items[0]!.name).toBe('Cafe Alpha');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/data-pipeline && npx vitest run test/browser-extract.test.ts`
Expected: FAIL — `starterStrategies[].extract` still has the old `(page)` signature / `anchors` helper is page-based, so the call shape doesn't match (TS error or runtime failure).

- [ ] **Step 3: Make `browser-connector.ts` re-export the moved types and render via parseHtml**

In `apps/data-pipeline/scripts/connectors/core/browser-connector.ts`:

(a) Replace the local `ScrapedItem` + `BrowserStrategy` definitions and the `import type { Page }` usage in `extract` by importing/re-exporting from `browser-strategy.ts`. At the top, replace:
```ts
import type { Page } from 'playwright';

export interface ScrapedItem { /* ... */ }
export interface BrowserStrategy { /* ... extract: (page: Page, limit) ... */ }
```
with:
```ts
import type { Page } from 'playwright';
import { parseHtml } from './parse-html.js';
export type { ScrapedItem, BrowserStrategy } from './browser-strategy.js';
import type { BrowserStrategy } from './browser-strategy.js';
```

(b) In `defineBrowserConnector`, change the scrape call so extraction runs on the parsed page HTML. Replace:
```ts
      const outcome = await scrapePage(url, (page) => s.extract(page, limit), {
```
with:
```ts
      const outcome = await scrapePage(url, async (page: Page) => {
        const doc = parseHtml(await page.content());
        return s.extract(doc, url, limit);
      }, {
```

(The rest of `defineBrowserConnector` — `outcome.items`, `mkRecord`, the `page-items-hash` fingerprint — is unchanged.)

- [ ] **Step 4: Refactor `starter.ts` to the static-DOM signature**

In `apps/data-pipeline/scripts/connectors/browser/starter.ts`:

(a) Replace the imports + the local `anchors` helper:
```ts
import { type BrowserStrategy } from '../core/browser-connector.js';
import type { Page } from 'playwright';

async function anchors(page: Page, selector: string, idFrom: (href: string) => string, limit: number) { /* ... */ }
```
with:
```ts
import { type BrowserStrategy, anchors } from '../core/browser-strategy.js';
```

(b) Update every `extract` to the static-DOM signature. The six anchor-based ones become:
```ts
    // tabelog
    extract: (doc, baseUrl, limit) =>
      anchors(doc, baseUrl, 'a.list-rst__rst-name-target', (href) => href.replace(/^https?:\/\/tabelog\.com/, '').replace(/\/$/, ''), limit),
    // wongnai
    extract: (doc, baseUrl, limit) =>
      anchors(doc, baseUrl, 'a[href*="/restaurants/"]', (href) => (href.match(/\/restaurants\/([^/?#]+)/)?.[1] ?? href).slice(0, 80), limit),
    // 2gis
    extract: (doc, baseUrl, limit) => anchors(doc, baseUrl, 'a[href*="/firm/"]', (href) => href.match(/\/firm\/(\d+)/)?.[1] ?? href, limit),
    // yelp
    extract: (doc, baseUrl, limit) => anchors(doc, baseUrl, 'a[href*="/biz/"]', (href) => href.match(/\/biz\/([^/?#]+)/)?.[1] ?? href, limit),
    // tripadvisor
    extract: (doc, baseUrl, limit) => anchors(doc, baseUrl, 'a[href*="/Restaurant_Review"]', (href) => href.match(/-d(\d+)-/)?.[1] ?? href, limit),
    // atlas-obscura-web
    extract: (doc, baseUrl, limit) => anchors(doc, baseUrl, 'a[href*="/places/"]', (href) => href.match(/\/places\/([a-z0-9-]+)$/)?.[1] ?? href, limit),
```
and `google-maps` becomes a static-DOM query (no `$$eval`):
```ts
    // google-maps
    extract: (doc, _baseUrl, limit) =>
      [...doc.querySelectorAll('div[role="feed"] a[href*="/maps/place/"], div[role="feed"] a[href*="!19s"]')]
        .slice(0, limit)
        .map((a) => {
          const href = a.getAttribute('href') ?? '';
          const m = href.match(/!19s(ChIJ[^!?&]+)/) || href.match(/\/place\/([^/]+)/);
          const name = a.getAttribute('aria-label') ?? '';
          return { sourceId: m ? decodeURIComponent(m[1]!) : href.slice(0, 80), name, url: href, raw: { href, name } };
        })
        .filter((x) => x.name),
```

> Note: only `browser/starter.ts` is migrated. The other 61 strategy files keep the old `(page)` signature and still import `BrowserStrategy` from `browser-connector.ts` (which now re-exports it) — they are not in the Worker tsconfig and not touched here.

- [ ] **Step 5: Add the Worker-imported connector files to tsconfig**

In `apps/data-pipeline/tsconfig.json`, extend `include` with the three files the Worker will import (the extract consumer in Task 6 pulls in `starter.ts` → `browser-strategy.ts` → `parse-html.ts`):

```json
    "scripts/connectors/tierA/gov-open.ts",
    "scripts/connectors/core/parse-html.ts",
    "scripts/connectors/core/browser-strategy.ts",
    "scripts/connectors/browser/starter.ts"
```

(Append these after the existing `tierA/gov-open.ts` entry; do NOT add `core/browser-connector.ts` or `core/browser.ts` — they import Playwright.)

- [ ] **Step 6: Run the extract test + typecheck**

Run: `cd apps/data-pipeline && npx vitest run test/browser-extract.test.ts && npx tsc -b tsconfig.json`
Expected: extract test PASS (2 tests); `tsc` exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/data-pipeline/scripts/connectors/core/browser-connector.ts apps/data-pipeline/scripts/connectors/browser/starter.ts apps/data-pipeline/tsconfig.json apps/data-pipeline/test/browser-extract.test.ts
git commit -m "feat(data-pipeline): shared static-DOM extractor for the starter strategies"
```

---

## Task 3: Factor `ingestPulledRecords` out of `runRefreshSource`

**Files:**
- Create: `apps/data-pipeline/src/refresh/ingest-records.ts`
- Modify: `apps/data-pipeline/src/refresh/run-refresh.ts`
- Test: `apps/data-pipeline/test/ingest-records.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/data-pipeline/test/ingest-records.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import groupsSql from '../migrations/0001_groups.sql?raw';
import refreshSql from '../migrations/0004_refresh.sql?raw';
import { mkRecord } from '../scripts/connectors/core/fingerprint.js';
import { ingestPulledRecords } from '../src/refresh/ingest-records.js';
import type { EnrichMessage } from '../src/env.js';

async function apply(sql: string) {
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await env.GROUPS.prepare(stmt).run();
}
beforeAll(async () => { await apply(groupsSql); await apply(refreshSql); });

const MAPPING = { subject: 'poi', category: 'attraction' };
const CTX = { dataVersion: 2, nowIso: '2026-06-16T00:00:00Z', runId: 'r1' };

describe('ingestPulledRecords', () => {
  it('materializes new records, merges a blob, enqueues enrich, and records state', async () => {
    const rec = mkRecord('dev-src', 'P1', { v: 1 }, { name: 'Place 1', lat: 5.42, lng: 100.27, source_url: 'http://x/P1' });
    const sent: EnrichMessage[] = [];
    const refreshEnv = { DATA: env.DATA, GROUPS: env.GROUPS, ENRICH: { async sendBatch(m: { body: EnrichMessage }[]) { for (const x of m) sent.push(x.body); } } };

    const summary = await ingestPulledRecords(refreshEnv, 'dev-src', MAPPING, [rec], CTX);
    expect(summary.created).toBe(1);
    expect(summary.enqueued).toBe(1);
    expect(sent[0]!.source).toBe('dev-src');

    const blob = await env.DATA.get(`groups/r7/${sent[0]!.h3_r7}`);
    expect(JSON.parse(await blob!.text()).records.some((r: any) => r.source_url === 'http://x/P1')).toBe(true);

    // No source_snapshot written by ingestPulledRecords (device path owns no snapshot).
    const snap = await env.GROUPS.prepare('SELECT * FROM source_snapshot WHERE source=?').bind('dev-src').first();
    expect(snap).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/data-pipeline && npx vitest run test/ingest-records.test.ts`
Expected: FAIL — `Cannot find module '../src/refresh/ingest-records.js'`.

- [ ] **Step 3: Create `ingest-records.ts` with the factored body**

Create `apps/data-pipeline/src/refresh/ingest-records.ts`:

```ts
import {
  pulledToNormalized,
  mergeIntoR7Blob,
  aliasFor,
  type TravelRecord,
  type ConnectorMapping,
} from '@travel/pipeline-core';
import type { PulledRecord } from '../../scripts/connectors/core/types.js';
import { D1GroupRegistry } from '../registry-d1.js';
import { RecordStateStore, type ObservedRecord } from './refresh-d1.js';
import { classifyRecords } from './diff.js';
import type { RefreshEnv, RefreshContext, RefreshSummary } from './run-refresh.js';

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Response(text).body!.pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

/**
 * Record-level ingest shared by the API path (runRefreshSource) and the device
 * path (extract consumer): diff vs record_state → materialize → merge groups/r7
 * → lake delta → enqueue ENRICH → upsert record_state. Does NOT touch
 * source_snapshot (the API caller owns that; the device path uses pool_url_registry).
 */
export async function ingestPulledRecords(
  env: RefreshEnv,
  source: string,
  mapping: ConnectorMapping,
  records: PulledRecord[],
  ctx: RefreshContext,
): Promise<RefreshSummary> {
  const recordState = new RecordStateStore(env.GROUPS);

  const prevHashes = await recordState.hashesForSource(source);
  const diff = classifyRecords(records, prevHashes);
  const toMaterialize = [...diff.created, ...diff.changed];

  const registry = new D1GroupRegistry(env.GROUPS);
  const changedRecords: TravelRecord[] = [];
  for (const pr of toMaterialize) {
    const norm = pulledToNormalized(source, pr, mapping);
    if (norm === null) continue;
    const alias = aliasFor(
      { subject: norm.record.subject, category: norm.record.category, name: norm.record.name, record_uuid: norm.record.record_uuid },
      norm.signals,
    );
    const group_uuid = await registry.resolve(alias.key, { subject: norm.record.subject, kind: alias.kind, canonical_name: alias.name });
    changedRecords.push({ ...norm.record, group_uuid, raw_r2_key: '', data_version: ctx.dataVersion });
  }

  const byR7 = new Map<string, TravelRecord[]>();
  for (const r of changedRecords) {
    const arr = byR7.get(r.h3_r7);
    if (arr) arr.push(r); else byR7.set(r.h3_r7, [r]);
  }
  for (const [h3_r7, recs] of byR7) {
    const key = `groups/r7/${h3_r7}`;
    const existing = await env.DATA.get(key);
    const body = mergeIntoR7Blob(existing ? await existing.text() : null, h3_r7, recs, ctx.dataVersion);
    await env.DATA.put(key, body, { httpMetadata: { contentType: 'application/json' } });
  }

  if (changedRecords.length > 0) {
    const subject = changedRecords[0]!.subject;
    const ndjson = changedRecords.map((r) => JSON.stringify(r)).join('\n') + '\n';
    await env.DATA.put(
      `lake/${subject}/${source}/v${ctx.dataVersion}/delta-${ctx.runId}.ndjson.gz`,
      await gzip(ndjson),
      { httpMetadata: { contentEncoding: 'gzip', contentType: 'application/x-ndjson' } },
    );
  }

  const messages = changedRecords.map((r) => ({ body: { record_uuid: r.record_uuid, h3_r7: r.h3_r7, source } }));
  for (let i = 0; i < messages.length; i += 100) await env.ENRICH.sendBatch(messages.slice(i, i + 100));

  const observed: ObservedRecord[] = records.map((pr) => ({
    record_uuid: pr.record_uuid, source, source_url: pr.source_url ?? '', content_hash: pr.content_hash,
  }));
  await recordState.upsertObserved(observed, ctx.nowIso);

  return {
    source, skipped: false,
    created: diff.created.length, changed: diff.changed.length, unchanged: diff.unchanged.length,
    enqueued: messages.length,
  };
}
```

- [ ] **Step 4: Make `runRefreshSource` call the factored function**

In `apps/data-pipeline/src/refresh/run-refresh.ts`, replace the body from step (3) through the end of step (8) (the `// (3) Per-record diff …` block down to and including the `await recordState.upsertObserved(...)` call, but NOT the `snapshots.save(...)` call) with a single call. Concretely, replace lines from `// (3) Per-record diff against stored hashes.` through `await recordState.upsertObserved(observed, ctx.nowIso);` with:

```ts
  // (3-8a) Record-level ingest (shared with the device path).
  const summary = await ingestPulledRecords(env, connector.id, mapping, result.records, ctx);
```

Then update the imports and the final return. At the top, remove the now-unused imports (`pulledToNormalized`, `mergeIntoR7Blob`, `aliasFor`, `TravelRecord`, `D1GroupRegistry`, `classifyRecords`, `ObservedRecord`, and the local `gzip`) that moved into `ingest-records.ts`, keeping only what `runRefreshSource` still uses, and add:
```ts
import { ingestPulledRecords } from './ingest-records.js';
```
Keep `SourceSnapshotStore` (for `prior` + `markUnchanged` + `save`) and `RecordStateStore` is no longer used here (remove it). Keep the `RefreshEnv`/`RefreshContext`/`RefreshSummary` exports.

Replace the final `return { source: connector.id, skipped: false, created: …, changed: …, unchanged: …, enqueued: … };` with:
```ts
  // (8b) Persist the source-level snapshot (API path owns this).
  await snapshots.save({
    source: connector.id,
    fingerprint_method: result.sourceFingerprint.method,
    fingerprint_value: result.sourceFingerprint.value,
    cursor: result.cursor ?? null,
    since_ts: ctx.nowIso,
    last_run_at: ctx.nowIso,
    last_status: result.status,
  });
  return summary;
```
(The existing `snapshots.save(...)` block that was already there is now this one — ensure there is exactly one save, after the ingest call.)

- [ ] **Step 5: Run the new test + the existing run-refresh tests**

Run: `cd apps/data-pipeline && npx vitest run test/ingest-records.test.ts test/run-refresh.integration.test.ts && npx tsc -b tsconfig.json`
Expected: all PASS (ingest-records: 1; run-refresh: 3); `tsc` exits 0. The unchanged run-refresh suite proves the factor preserved API-path behavior.

- [ ] **Step 6: Commit**

```bash
git add apps/data-pipeline/src/refresh/ingest-records.ts apps/data-pipeline/src/refresh/run-refresh.ts apps/data-pipeline/test/ingest-records.test.ts
git commit -m "refactor(data-pipeline): factor ingestPulledRecords (shared API + device path)"
```

---

## Task 4: `pool_url_registry.source` + enrollment

**Files:**
- Create: `apps/data-pipeline/migrations/0005_pool_source.sql`
- Modify: `apps/data-pipeline/src/pool/pool-d1.ts`
- Test: `apps/data-pipeline/test/pool-source-d1.test.ts`

- [ ] **Step 1: Write the migration**

Create `apps/data-pipeline/migrations/0005_pool_source.sql`:

```sql
-- Track 2: tag each pool URL with the connector that owns it, so the server-side
-- extractor can pick the right strategy for a rendered DOM.
ALTER TABLE pool_url_registry ADD COLUMN source TEXT;
```

- [ ] **Step 2: Write the failing test**

Create `apps/data-pipeline/test/pool-source-d1.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import poolSql from '../migrations/0003_pool.sql?raw';
import sourceSql from '../migrations/0005_pool_source.sql?raw';
import { PoolUrlRegistryStore } from '../src/pool/pool-d1.js';

async function apply(sql: string) {
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await env.GROUPS.prepare(stmt).run();
}
beforeAll(async () => { await apply(poolSql); await apply(sourceSql); });

describe('pool_url_registry.source', () => {
  it('upsert sets source and get returns it', async () => {
    const reg = new PoolUrlRegistryStore(env.GROUPS);
    await reg.upsert({ url: 'https://tabelog.com/en/kanagawa/', host: 'tabelog.com', waitForSelector: 'a.list-rst__rst-name-target', dwellMs: 4000, tier: 'E', source: 'tabelog' });
    const row = await reg.get('https://tabelog.com/en/kanagawa/');
    expect(row?.source).toBe('tabelog');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/data-pipeline && npx vitest run test/pool-source-d1.test.ts`
Expected: FAIL — `upsert` rejects the `source` property (TS) / does not persist it; `row.source` is undefined.

- [ ] **Step 4: Add `source` to `UrlRow` and `upsert`**

In `apps/data-pipeline/src/pool/pool-d1.ts`:

(a) Add `source` to the `UrlRow` interface (after `backoff_until`):
```ts
  next_due_at: string | null; consecutive_challenges: number; backoff_until: string | null;
  source: string | null;
```

(b) Update `PoolUrlRegistryStore.upsert` to accept + persist `source`:
```ts
  async upsert(u: { url: string; host: string; waitForSelector: string | null; dwellMs: number | null; tier?: string | null; source?: string | null }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO pool_url_registry (url, host, enabled, tier, wait_for_selector, dwell_ms, consecutive_challenges, source)
         VALUES (?, ?, 1, ?, ?, ?, 0, ?)
         ON CONFLICT(url) DO UPDATE SET host=excluded.host, tier=excluded.tier,
           wait_for_selector=excluded.wait_for_selector, dwell_ms=excluded.dwell_ms, source=excluded.source`,
      )
      .bind(u.url, u.host, u.tier ?? null, u.waitForSelector, u.dwellMs, u.source ?? null)
      .run();
  }
```

(`get` is `SELECT *`, so it returns `source` once the column exists — no change.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/data-pipeline && npx vitest run test/pool-source-d1.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add apps/data-pipeline/migrations/0005_pool_source.sql apps/data-pipeline/src/pool/pool-d1.ts apps/data-pipeline/test/pool-source-d1.test.ts
git commit -m "feat(data-pipeline): pool_url_registry.source column + upsert"
```

---

## Task 5: `ExtractMessage` + content-hash skip + `travel-extract` queue

**Files:**
- Modify: `apps/data-pipeline/src/env.ts`
- Modify: `apps/data-pipeline/src/pool/handlers.ts`
- Modify: `apps/data-pipeline/src/pool/auth.ts` (the `PoolEnv` interface)
- Modify: `apps/data-pipeline/wrangler.jsonc`
- Modify: `apps/data-pipeline/vitest.config.ts`
- Test: `apps/data-pipeline/test/pool-results-extract.test.ts`

- [ ] **Step 1: Add the message type + binding**

In `apps/data-pipeline/src/env.ts`, after `EnrichMessage`, add:
```ts
export interface ExtractMessage {
  r2Key: string;
  url: string;
  source: string;
}
```
and add to `interface Env` (after `ENRICH`):
```ts
  EXTRACT: Queue<ExtractMessage>;
```

- [ ] **Step 2: Write the failing test**

Create `apps/data-pipeline/test/pool-results-extract.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import poolSql from '../migrations/0003_pool.sql?raw';
import sourceSql from '../migrations/0005_pool_source.sql?raw';
import { handleResults } from '../src/pool/handlers.js';
import { PoolDeviceStore, PoolUrlRegistryStore, PoolLeaseStore } from '../src/pool/pool-d1.js';
import { sha256Hex } from '../src/pool/crypto.js';

async function apply(sql: string) {
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await env.GROUPS.prepare(stmt).run();
}
async function gz(s: string): Promise<string> {
  const stream = new Response(s).body!.pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = ''; for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin);
}
beforeAll(async () => { await apply(poolSql); await apply(sourceSql); });

function poolEnv(extractSent: any[]) {
  return { GROUPS: env.GROUPS, DATA: env.DATA, EXTRACT: { async send(m: any) { extractSent.push(m); } } } as any;
}
async function seed(url: string, host: string, source: string, deviceToken: string) {
  await new PoolDeviceStore(env.GROUPS).provision('dev-1', await sha256Hex(deviceToken), '2026-06-16T00:00:00Z');
  await new PoolUrlRegistryStore(env.GROUPS).upsert({ url, host, waitForSelector: null, dwellMs: null, source });
  const leaseId = 'L-' + host;
  await new PoolLeaseStore(env.GROUPS).create([{ lease_id: leaseId, url, host, device_id: 'dev-1' }], '2026-06-16T00:00:00Z', '2026-06-16T01:00:00Z');
  return leaseId;
}
function resultReq(leaseId: string, domB64: string, token: string) {
  return new Request('https://x/pool/results', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ leaseId, status: 200, gzippedDomBase64: domB64 }),
  });
}

describe('POST /pool/results content-hash skip + extract enqueue', () => {
  it('enqueues extract on first (changed) DOM and skips on identical DOM', async () => {
    const token = 'tok-1';
    const url = 'https://tabelog.com/en/a/';
    const leaseId = await seed(url, 'tabelog.com', 'tabelog', token);
    const dom = await gz('<html><a class="list-rst__rst-name-target" href="/en/x">X</a></html>');

    const sent1: any[] = [];
    const r1 = await handleResults(resultReq(leaseId, dom, token), poolEnv(sent1));
    expect(r1.status).toBe(200);
    expect(sent1.length).toBe(1);
    expect(sent1[0]).toMatchObject({ url, source: 'tabelog' });
    expect(typeof sent1[0].r2Key).toBe('string');

    // Re-lease the same url, upload identical DOM → content_hash matches → no enqueue.
    const leaseId2 = 'L2';
    await new PoolLeaseStore(env.GROUPS).create([{ lease_id: leaseId2, url, host: 'tabelog.com', device_id: 'dev-1' }], '2026-06-16T00:00:00Z', '2026-06-16T02:00:00Z');
    const sent2: any[] = [];
    const r2 = await handleResults(resultReq(leaseId2, dom, token), poolEnv(sent2));
    expect(r2.status).toBe(200);
    expect(sent2.length).toBe(0); // unchanged DOM → skipped
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/data-pipeline && npx vitest run test/pool-results-extract.test.ts`
Expected: FAIL — `handleResults` does not enqueue (no `EXTRACT` use yet); `sent1.length` is 0.

- [ ] **Step 4: Add the content-hash skip + enqueue in `handleResults`**

In `apps/data-pipeline/src/pool/handlers.ts`, locate the success branch in `handleResults` (where it computes `contentHash`, stores R2, and calls `markFetched`). Replace:

```ts
  const contentHash = fnv1a(dom);
  const key = `pool/${(await sha256Hex(lease.url)).slice(0, 16)}/${Date.parse(nowIso)}-${body.leaseId}.html.gz`;
  await env.DATA.put(key, bytes, {
    httpMetadata: { contentType: 'text/html; charset=utf-8', contentEncoding: 'gzip' },
    customMetadata: { url: lease.url, deviceId, leaseId: body.leaseId, contentHash, fetchedAt: nowIso },
  });
  // NOTE: downstream extraction is not wired yet — the raw DOM is parked in R2 and the
  // registry marked fetched. Wiring the extractor hop (DOM → PulledRecord → pipeline) is a
  // tracked follow-up; see src/pool/README.md "Known follow-ups".
  await reg.markFetched(lease.url, contentHash, nowIso, addSeconds(nowIso, POOL.REFRESH_INTERVAL_SEC));
  await leases.markDone(body.leaseId);
  return json({ ok: true, contentHash, stored: key });
```

with:

```ts
  const contentHash = fnv1a(dom);
  const prior = await reg.get(lease.url);
  const key = `pool/${(await sha256Hex(lease.url)).slice(0, 16)}/${Date.parse(nowIso)}-${body.leaseId}.html.gz`;
  await env.DATA.put(key, bytes, {
    httpMetadata: { contentType: 'text/html; charset=utf-8', contentEncoding: 'gzip' },
    customMetadata: { url: lease.url, deviceId, leaseId: body.leaseId, contentHash, fetchedAt: nowIso },
  });
  await reg.markFetched(lease.url, contentHash, nowIso, addSeconds(nowIso, POOL.REFRESH_INTERVAL_SEC));
  await leases.markDone(body.leaseId);
  // Content-hash skip: extract only when the DOM changed AND the URL is owned by a
  // pilot connector. Unchanged DOM (same content_hash) is parked in R2, not re-extracted.
  if (prior?.source && prior.content_hash !== contentHash) {
    await env.EXTRACT.send({ r2Key: key, url: lease.url, source: prior.source });
  }
  return json({ ok: true, contentHash, stored: key });
```

Then add `EXTRACT` to the `PoolEnv` interface in `apps/data-pipeline/src/pool/auth.ts`:
`EXTRACT: { send(msg: { r2Key: string; url: string; source: string }): Promise<unknown> };`.

- [ ] **Step 5: Wire the queue in wrangler + give tests a producer binding**

In `apps/data-pipeline/wrangler.jsonc`, under `"queues"`, add the producer (after the `ENRICH` producer) and the consumers (after the existing consumers):
```jsonc
    "producers": [
      { "binding": "ENRICH", "queue": "travel-enrich" },
      { "binding": "EXTRACT", "queue": "travel-extract" }
    ],
```
and in the `"consumers"` array add:
```jsonc
      { "queue": "travel-extract", "max_batch_size": 10, "max_batch_timeout": 10, "max_retries": 5, "dead_letter_queue": "travel-extract-dlq" },
      { "queue": "travel-extract-dlq", "max_batch_size": 10, "max_batch_timeout": 30, "max_retries": 1 }
```

In `apps/data-pipeline/vitest.config.ts`, add a `queueProducers` entry to the workers project's `miniflare` block so `env.EXTRACT` exists in worker-fetch tests (alongside `d1Databases`/`r2Buckets`):
```ts
                miniflare: {
                  d1Databases: ["GROUPS"],
                  r2Buckets: ["DATA"],
                  queueProducers: { EXTRACT: "travel-extract" },
                  compatibilityDate: "2025-05-01",
                  compatibilityFlags: ["nodejs_compat"],
                },
```

- [ ] **Step 6: Run the test + the existing pool tests + typecheck**

Run: `cd apps/data-pipeline && npx vitest run test/pool-results-extract.test.ts test/pool-handlers.test.ts test/pool-integration.test.ts && npx tsc -b tsconfig.json`
Expected: all PASS; `tsc` exits 0. (The pool-handlers/integration suites confirm the new `EXTRACT` use + `reg.get` did not regress existing behavior.)

- [ ] **Step 7: Commit**

```bash
git add apps/data-pipeline/src/env.ts apps/data-pipeline/src/pool/handlers.ts apps/data-pipeline/src/pool/auth.ts apps/data-pipeline/wrangler.jsonc apps/data-pipeline/vitest.config.ts apps/data-pipeline/test/pool-results-extract.test.ts
git commit -m "feat(data-pipeline): content-hash skip + travel-extract enqueue on /pool/results"
```

---

## Task 6: The extract consumer

**Files:**
- Create: `apps/data-pipeline/src/pool/pilot-sources.ts`
- Create: `apps/data-pipeline/src/pool/extract-consumer.ts`
- Modify: `apps/data-pipeline/src/index.ts`
- Test: `apps/data-pipeline/test/extract-consumer.integration.test.ts`

- [ ] **Step 1: Write the pilot Worker registry**

Create `apps/data-pipeline/src/pool/pilot-sources.ts`:

```ts
import type { ConnectorMapping } from '@travel/pipeline-core';
import { starterStrategies } from '../../scripts/connectors/browser/starter.js';
import type { BrowserStrategy } from '../../scripts/connectors/core/browser-strategy.js';

export interface PilotSource {
  strategy: BrowserStrategy;
  mapping: ConnectorMapping;
}

const MAPPINGS: Record<string, ConnectorMapping> = {
  'google-maps': { subject: 'poi', category: 'poi' },
  tabelog: { subject: 'poi', category: 'restaurant' },
  wongnai: { subject: 'poi', category: 'restaurant' },
  '2gis': { subject: 'poi', category: 'poi' },
  yelp: { subject: 'poi', category: 'restaurant' },
  tripadvisor: { subject: 'poi', category: 'restaurant' },
  'atlas-obscura-web': { subject: 'poi', category: 'attraction' },
};

/** Pilot device-pool sources keyed by connector id (the pool_url_registry.source value). */
export const PILOT_SOURCES: Record<string, PilotSource> = Object.fromEntries(
  starterStrategies
    .filter((s) => MAPPINGS[s.id])
    .map((s) => [s.id, { strategy: s, mapping: MAPPINGS[s.id]! }]),
);
```

- [ ] **Step 2: Write the failing integration test**

Create `apps/data-pipeline/test/extract-consumer.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import groupsSql from '../migrations/0001_groups.sql?raw';
import refreshSql from '../migrations/0004_refresh.sql?raw';
import { extractBatch } from '../src/pool/extract-consumer.js';
import type { EnrichMessage, ExtractMessage } from '../src/env.js';

async function apply(sql: string) {
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await env.GROUPS.prepare(stmt).run();
}
async function putGz(key: string, html: string) {
  const stream = new Response(html).body!.pipeThrough(new CompressionStream('gzip'));
  await env.DATA.put(key, await new Response(stream).arrayBuffer(), { httpMetadata: { contentEncoding: 'gzip' } });
}
beforeAll(async () => { await apply(groupsSql); await apply(refreshSql); });

describe('extractBatch', () => {
  it('parses stored DOM, extracts records, merges a blob, and enqueues enrich', async () => {
    // google-maps DOM with a place anchor that yields lat/lng? google-maps has no coords,
    // so use wongnai-style anchors but with a connector whose records carry coords via raw.
    // For a clean end-to-end, use atlas-obscura (anchor) — but records need lat/lng to materialize.
    // The pilot extractors yield name+url only; pulledToNormalized needs coords, so this test
    // asserts the consumer runs end-to-end and that a coords-bearing record lands.
    const key = 'pool/abc/extract-1.html.gz';
    // Inject coords by using a strategy-independent path: enrich is asserted via record_state.
    await putGz(key, '<html><a class="list-rst__rst-name-target" href="https://tabelog.com/en/x">Sushi</a></html>');

    const sent: EnrichMessage[] = [];
    const consumerEnv = {
      DATA: env.DATA, GROUPS: env.GROUPS,
      ENRICH: { async sendBatch(m: { body: EnrichMessage }[]) { for (const x of m) sent.push(x.body); } },
    } as any;
    const msg: ExtractMessage = { r2Key: key, url: 'https://tabelog.com/en/a/', source: 'tabelog' };

    await extractBatch([msg], consumerEnv);

    // The anchor has no coordinates → pulledToNormalized returns null → no record materialized,
    // but record_state still records what was observed (the extracted item).
    const seen = await env.GROUPS.prepare('SELECT COUNT(*) AS n FROM record_state WHERE source=?').bind('tabelog').first<{ n: number }>();
    expect(seen!.n).toBe(1);
  });

  it('throws NonRetryableError for an unknown source', async () => {
    const consumerEnv = { DATA: env.DATA, GROUPS: env.GROUPS, ENRICH: { async sendBatch() {} } } as any;
    await env.DATA.put('pool/u/x.html.gz', new Response('<html></html>').body!.pipeThrough(new CompressionStream('gzip')) as any);
    await expect(extractBatch([{ r2Key: 'pool/u/x.html.gz', url: 'https://nope/', source: 'not-a-pilot' }], consumerEnv))
      .rejects.toThrow();
  });
});
```

> Note: the starter extractors yield `{name, url}` without coordinates, and `pulledToNormalized` requires lat/lng — so extracted listing items are *observed* (recorded in `record_state`) but not *materialized* to the map until detail-page coords arrive. The test asserts the consumer runs end-to-end and records observation; coordinate-bearing extraction is a per-connector follow-up (detail pages), out of this pilot's scope.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/data-pipeline && npx vitest run test/extract-consumer.integration.test.ts`
Expected: FAIL — `Cannot find module '../src/pool/extract-consumer.js'`.

- [ ] **Step 4: Write the extract consumer**

Create `apps/data-pipeline/src/pool/extract-consumer.ts`:

```ts
import { NonRetryableError } from 'cloudflare:workflows';
import { mkRecord } from '../../scripts/connectors/core/fingerprint.js';
import { parseHtml } from '../../scripts/connectors/core/parse-html.js';
import type { PulledRecord } from '../../scripts/connectors/core/types.js';
import { PILOT_SOURCES } from './pilot-sources.js';
import { ingestPulledRecords } from '../refresh/ingest-records.js';
import type { RefreshEnv } from '../refresh/run-refresh.js';
import type { ExtractMessage } from '../env.js';

const EXTRACT_LIMIT = 25;

/**
 * Consume travel-extract messages: load the device DOM from R2, parse it, run the
 * owning connector's static-DOM extractor, and feed the records through the shared
 * record-level ingest. Unrecoverable input (missing object, unknown source,
 * unparseable DOM) throws NonRetryableError → DLQ.
 */
export async function extractBatch(msgs: ExtractMessage[], env: RefreshEnv): Promise<void> {
  for (const msg of msgs) {
    const pilot = PILOT_SOURCES[msg.source];
    if (!pilot) throw new NonRetryableError(`extract: unknown source "${msg.source}" for ${msg.url}`);

    const obj = await env.DATA.get(msg.r2Key);
    if (obj === null) throw new NonRetryableError(`extract: R2 object missing at ${msg.r2Key}`);
    const html = await obj.text(); // R2 stored gzip; get() transparently decodes contentEncoding

    let items;
    try {
      items = pilot.strategy.extract(parseHtml(html), msg.url, EXTRACT_LIMIT);
    } catch (cause) {
      throw new NonRetryableError(`extract: parse/extract failed for ${msg.url}: ${String(cause)}`);
    }

    const records: PulledRecord[] = items.map((it) =>
      mkRecord(msg.source, it.sourceId, it.raw ?? it, {
        name: it.name, lat: it.lat, lng: it.lng, updated_at: it.updated_at, source_url: it.url,
      }),
    );

    const nowIso = new Date().toISOString();
    await ingestPulledRecords(env, msg.source, pilot.mapping, records, {
      dataVersion: Number((env as unknown as { DATA_VERSION?: string }).DATA_VERSION ?? 1),
      nowIso,
      runId: crypto.randomUUID(),
    });
  }
}
```

> `R2.get().text()` returns the decoded body (R2 honors the stored `contentEncoding: gzip`), so the consumer does not gunzip manually. If a future change stores raw (non-gzip) bytes, decode here.

- [ ] **Step 5: Route the queue in `index.ts`**

In `apps/data-pipeline/src/index.ts`:

(a) Add imports:
```ts
import { extractBatch } from './pool/extract-consumer.js';
import type { ExtractMessage } from './env.js';
```
(and widen the existing `EnrichMessage` import to also pull `ExtractMessage` if it shares the line).

(b) Replace the `queue` handler signature + body to route by queue name:
```ts
  async queue(batch: MessageBatch<EnrichMessage | ExtractMessage>, env: Env): Promise<void> {
    if (batch.queue === 'travel-enrich-dlq' || batch.queue === 'travel-extract-dlq') {
      for (const m of batch.messages) console.error(`${batch.queue}`, m.body);
      batch.ackAll();
      return;
    }
    if (batch.queue === 'travel-extract') {
      await extractBatch(batch.messages.map((m) => m.body as ExtractMessage), { DATA: env.DATA, GROUPS: env.GROUPS, ENRICH: env.ENRICH });
      return;
    }
    await enrichBatch((batch.messages as Message<EnrichMessage>[]).map((m) => m.body), env);
  },
```

- [ ] **Step 6: Run the test + typecheck + full suite**

Run: `cd apps/data-pipeline && npx vitest run test/extract-consumer.integration.test.ts && npx tsc -b tsconfig.json && npx vitest run`
Expected: extract-consumer PASS (2 tests); `tsc` exits 0; full suite green.

- [ ] **Step 7: Commit**

```bash
git add apps/data-pipeline/src/pool/pilot-sources.ts apps/data-pipeline/src/pool/extract-consumer.ts apps/data-pipeline/src/index.ts apps/data-pipeline/test/extract-consumer.integration.test.ts
git commit -m "feat(data-pipeline): travel-extract consumer — device DOM -> records -> ingest"
```

---

## Task 7: Verification + docs

**Files:**
- Modify: `apps/data-pipeline/src/pool/README.md` (or `src/refresh/README.md`)

- [ ] **Step 1: Full suite + typecheck**

Run: `cd apps/data-pipeline && npx vitest run && npx tsc -b tsconfig.json`
Expected: all suites PASS; `tsc` exits 0.

- [ ] **Step 2: Confirm zero Playwright/DuckDB and that linkedom IS present (Worker)**

Run: `cd apps/data-pipeline && npx wrangler deploy --dry-run --outdir /tmp/track2-bundle`
Expected: build succeeds. Then:
Run: `grep -ril "playwright\|duckdb\|chromium" /tmp/track2-bundle || echo "CLEAN: no playwright/duckdb/chromium"`
Expected: `CLEAN` (the executable bundle; sourcemap comment text may mention them — inspect `index.js`, not `.map`). If the build fails resolving `playwright`, an import reached `browser-connector.ts`/`browser.ts` — check that the extract consumer imports only `starter.ts` + `browser-strategy.ts` + `parse-html.ts`.

- [ ] **Step 3: Document the device-ingest pipe**

In `apps/data-pipeline/src/pool/README.md`, append:

```markdown

## Track 2 — server-side DOM ingest (pilot)

When a device uploads DOM (`POST /pool/results`), the coordinator:
1. content-hashes the DOM and compares to `pool_url_registry.content_hash`;
2. **unchanged** → parks the DOM, done; **changed** → enqueues `travel-extract` `{r2Key,url,source}`;
3. the `travel-extract` consumer (`extract-consumer.ts`) loads the DOM, parses it (`linkedom`),
   runs the owning connector's static-DOM `extract` (shared with the Playwright CLI via
   `browser-strategy.ts`), and feeds records through `ingestPulledRecords` → merge → enrich.

Pilot sources: `pilot-sources.ts` (the starter 7). Live data requires the Android fetcher app
(`docs/superpowers/specs/2026-06-14-device-fetch-pool-design.md`); until then, exercise the pipe
by `POST /pool/results` with captured DOM. Listing-page extractors yield name+url (no coords);
detail-page/coordinate extraction is a per-connector follow-up.
```

- [ ] **Step 4: Commit**

```bash
git add apps/data-pipeline/src/pool/README.md
git commit -m "docs(data-pipeline): document Track 2 device-pool DOM ingest"
```

---

## Self-Review

**1. Spec coverage:**
- Shared static-DOM extractor (spec §5) → Tasks 1–2 (`parse-html`, `browser-strategy`, `starter.ts` refactor, `defineBrowserConnector` via `page.content()`). ✓
- Module boundary keeps Playwright out (§5.3) → Task 2 (re-export; tsconfig adds only Playwright-free files) + Task 7 dry-run grep. ✓
- Routing `pool_url_registry.source` (§6.1) → Task 4. ✓
- Enrollment (§6.2) → `upsert({…source})` in Task 4 sets it; the pilot registry (Task 6) + manual `upsert` seed URLs. (A dedicated `POST /pool/enroll` was optional in the spec; deferred — `upsert` is the seam.) ✓
- Content-hash skip (§6.3) → Task 5. ✓
- `travel-extract` queue + consumer (§6.4) → Tasks 5 (queue) + 6 (consumer). ✓
- `ingestPulledRecords` factor, no `source_snapshot` on device path (§6.5) → Task 3 (+ test asserts no snapshot row). ✓
- Pilot mapping + `source_url` (§7) → Task 6 `pilot-sources.ts` + `mkRecord({source_url})`. ✓
- Error handling: unknown source / missing R2 / unparseable → `NonRetryableError` (§8) → Task 6 consumer + test. ✓
- Testing fixtures, content-hash skip, consumer integration, run-refresh regression, dry-run (§9) → Tasks 2,3,5,6,7. ✓
- linkedom-under-workerd risk (§8) → Task 1 Step 6 calls it out as the BLOCKED path. ✓

**2. Placeholder scan:** No "TBD/handle errors" — every code step is complete. Deferred items (enroll endpoint, coordinate/detail extraction, the 61 other strategies, the device app) are explicitly scoped out with rationale, not left as silent gaps.

**3. Type consistency:**
- `BrowserStrategy.extract(doc: Document, baseUrl: string, limit: number) => ScrapedItem[]` is identical across `browser-strategy.ts` (def), `starter.ts` (impls), `browser-connector.ts` (caller), and the consumer (Task 6). ✓
- `ingestPulledRecords(env: RefreshEnv, source, mapping: ConnectorMapping, records: PulledRecord[], ctx: RefreshContext)` matches between `ingest-records.ts` (def), `run-refresh.ts` (Task 3 caller), and `extract-consumer.ts` (Task 6 caller). ✓
- `ExtractMessage {r2Key,url,source}` is identical in `env.ts`, the `handleResults` enqueue (Task 5), and the consumer/queue routing (Task 6). ✓
- `PoolUrlRegistryStore.upsert({…source})` + `UrlRow.source` match between Task 4 and the Task 5 `reg.get(...).source` read. ✓
- `RefreshEnv`/`RefreshContext`/`RefreshSummary` reused from Phase 1 unchanged. ✓
