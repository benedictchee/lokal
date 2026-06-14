# Device Fetch Pool — Coordinator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Cloudflare Worker coordinator for the device fetch pool — the `/pool/lease`, `/pool/results`, `/pool/heartbeat` endpoints plus their D1 schema and R2 storage — so 60 Android devices can lease known URLs, return rendered DOM, and feed the existing pipeline.

**Architecture:** Add a self-contained `src/pool/` module to the existing `apps/data-pipeline` Worker. Plain `fetch`-handler routing and per-device Bearer auth follow the repo's existing `/ingest` pattern. State lives in the existing `GROUPS` D1 database (new `pool_*` tables) and raw DOM payloads in the existing `DATA` R2 bucket. Parsing stays server-side and reuses the existing pipeline envelope (`fnv1a` content hashing from `@travel/pipeline-core`).

**Tech Stack:** TypeScript, Cloudflare Workers (Wrangler), D1 (SQLite), R2, Web Crypto (`crypto.subtle`), `DecompressionStream`, Vitest via `@cloudflare/vitest-pool-workers`.

**Scope:** This plan covers ONLY the coordinator (spec §5, §6, §9, §10). The Android pool app (spec §7, §8) and MDM packaging/rollout (spec §11) are **separate plans** to be written next — they require an Android/Gradle toolchain not present in this monorepo. Spec: `docs/superpowers/specs/2026-06-14-device-fetch-pool-design.md`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `apps/data-pipeline/migrations/0003_pool.sql` | Create `pool_device`, `pool_url_registry`, `pool_lease` tables + indexes |
| `apps/data-pipeline/src/pool/config.ts` | Tunable constants (lease TTL, max URLs, backoff, default dwell) |
| `apps/data-pipeline/src/pool/crypto.ts` | `sha256Hex(s)` token-hash helper (Web Crypto) |
| `apps/data-pipeline/src/pool/gzip.ts` | `gunzipToString(bytes)` via `DecompressionStream` |
| `apps/data-pipeline/src/pool/pool-d1.ts` | `PoolDeviceStore`, `PoolUrlRegistryStore`, `PoolLeaseStore` + row types |
| `apps/data-pipeline/src/pool/auth.ts` | `authenticateDevice(request, env)` → `deviceId \| null` |
| `apps/data-pipeline/src/pool/handlers.ts` | `handleLease`, `handleResults`, `handleHeartbeat`, `routePool` dispatcher |
| `apps/data-pipeline/src/index.ts` | Wire `routePool` into the Worker `fetch` handler (modify) |
| `apps/data-pipeline/scripts/pool-seed.ts` | Dev utility: provision a device token + seed URLs into local D1 |
| `apps/data-pipeline/src/pool/README.md` | How the pool coordinator works + local run |

**Test files** (mirror the repo's `test/` layout):
`test/pool-crypto.test.ts`, `test/pool-gzip.test.ts`, `test/pool-d1.test.ts`, `test/pool-auth.test.ts`, `test/pool-handlers.test.ts`.

## Shared types (defined in Task 3, referenced throughout)

```typescript
// src/pool/pool-d1.ts
export interface DeviceRow { device_id: string; token_sha256: string; enabled: number; created_at: string; }
export interface UrlRow {
  url: string; host: string; enabled: number; tier: string | null;
  wait_for_selector: string | null; dwell_ms: number | null;
  last_fetched_at: string | null; content_hash: string | null;
  next_due_at: string | null; consecutive_challenges: number; backoff_until: string | null;
}
export interface LeaseRow {
  lease_id: string; url: string; host: string; device_id: string;
  state: 'open' | 'done' | 'expired'; expires_at: string; created_at: string;
}
export interface LeasableUrl { url: string; host: string; waitForSelector: string | null; dwellMs: number; }
```

```typescript
// src/pool/handlers.ts — wire-format types
export interface LeaseJob { leaseId: string; url: string; host: string; engine: 'webview'; waitForSelector: string | null; dwellMs: number; }
export interface LeaseReqBody { battery?: { pct?: number; charging?: boolean }; appForeground?: boolean; maxUrls?: number; }
export interface ResultReqBody { leaseId: string; status: number; finalUrl?: string; title?: string; challenge: string | null; gzippedDomBase64: string; timings?: { loadMs?: number; totalMs?: number }; }
```

---

### Task 1: D1 migration — pool schema

**Files:**
- Create: `apps/data-pipeline/migrations/0003_pool.sql`
- Test: `apps/data-pipeline/test/pool-d1.test.ts` (migration-applies smoke; expanded in Task 3)

- [ ] **Step 1: Write the migration SQL**

Create `apps/data-pipeline/migrations/0003_pool.sql`:

```sql
-- Device fetch pool: device identity, URL registry, lease state.

CREATE TABLE IF NOT EXISTS pool_device (
  device_id    TEXT PRIMARY KEY,
  token_sha256 TEXT NOT NULL UNIQUE,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pool_url_registry (
  url                    TEXT PRIMARY KEY,
  host                   TEXT NOT NULL,
  enabled                INTEGER NOT NULL DEFAULT 1,
  tier                   TEXT,
  wait_for_selector      TEXT,
  dwell_ms               INTEGER,
  last_fetched_at        TEXT,
  content_hash           TEXT,
  next_due_at            TEXT,
  consecutive_challenges INTEGER NOT NULL DEFAULT 0,
  backoff_until          TEXT
);
CREATE INDEX IF NOT EXISTS idx_pool_url_host ON pool_url_registry (host);
CREATE INDEX IF NOT EXISTS idx_pool_url_due  ON pool_url_registry (enabled, next_due_at);

CREATE TABLE IF NOT EXISTS pool_lease (
  lease_id   TEXT PRIMARY KEY,
  url        TEXT NOT NULL,
  host       TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'open',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pool_lease_open ON pool_lease (state, expires_at);
CREATE INDEX IF NOT EXISTS idx_pool_lease_host ON pool_lease (host, state);
```

- [ ] **Step 2: Write a smoke test that applies the migration**

Create `apps/data-pipeline/test/pool-d1.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import migrationSql from '../migrations/0003_pool.sql?raw';

// Apply the pool migration once against the isolated-per-suite D1 (env.GROUPS),
// mirroring reviews-d1.test.ts's ?raw + split-on-';' application pattern.
beforeAll(async () => {
  for (const stmt of migrationSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.GROUPS.prepare(stmt).run();
  }
});

describe('0003_pool migration', () => {
  it('creates the three pool tables', async () => {
    const rows = await env.GROUPS
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pool_%' ORDER BY name")
      .all<{ name: string }>();
    expect(rows.results.map((r) => r.name)).toEqual(['pool_device', 'pool_lease', 'pool_url_registry']);
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd apps/data-pipeline && pnpm vitest run test/pool-d1.test.ts`
Expected: PASS (1 test). If the `cloudflare:test` D1 binding errors, confirm `vitest.config.ts` already lists `d1Databases: ["GROUPS"]` (it does).

- [ ] **Step 4: Commit**

```bash
git add apps/data-pipeline/migrations/0003_pool.sql apps/data-pipeline/test/pool-d1.test.ts
git commit -m "feat(data-pipeline): pool coordinator D1 schema (0003)"
```

---

### Task 2: `sha256Hex` token-hash helper

**Files:**
- Create: `apps/data-pipeline/src/pool/crypto.ts`
- Test: `apps/data-pipeline/test/pool-crypto.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/data-pipeline/test/pool-crypto.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { sha256Hex } from '../src/pool/crypto.js';

describe('sha256Hex', () => {
  it('hashes the empty string to the known SHA-256 digest', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
  it('is stable and lowercase-hex of length 64', async () => {
    const h = await sha256Hex('device-token-abc');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex('device-token-abc')).toBe(h);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/data-pipeline && pnpm vitest run test/pool-crypto.test.ts`
Expected: FAIL — cannot find module `../src/pool/crypto.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/data-pipeline/src/pool/crypto.ts`:

```typescript
/** Lowercase hex SHA-256 of a UTF-8 string, via Web Crypto (available in Workers + miniflare). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/data-pipeline && pnpm vitest run test/pool-crypto.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/data-pipeline/src/pool/crypto.ts apps/data-pipeline/test/pool-crypto.test.ts
git commit -m "feat(data-pipeline): pool sha256Hex token-hash helper"
```

---

### Task 3: D1 stores — device, URL registry, lease

**Files:**
- Create: `apps/data-pipeline/src/pool/pool-d1.ts`
- Create: `apps/data-pipeline/src/pool/config.ts`
- Test: `apps/data-pipeline/test/pool-d1.test.ts` (extend Task 1 file)

- [ ] **Step 1: Write the config constants**

Create `apps/data-pipeline/src/pool/config.ts`:

```typescript
/** Tunable coordinator constants. Kept here so handlers and stores share one source. */
export const POOL = {
  DEFAULT_MAX_URLS: 5, // jobs per lease if device omits maxUrls
  MAX_URLS_CAP: 20, // hard ceiling regardless of device request
  LEASE_TTL_SEC: 300, // visibility timeout: dropped leases reclaim after this
  BACKOFF_BASE_SEC: 3600, // first challenge backoff; doubles per consecutive challenge
  BACKOFF_MAX_SEC: 86_400, // cap backoff at 24h
  DEFAULT_DWELL_MS: 4000, // human-dwell hint sent to the device when URL has none
  REFRESH_INTERVAL_SEC: 86_400, // after a successful fetch, next_due = now + this
} as const;
```

- [ ] **Step 2: Write the failing store tests (append to `test/pool-d1.test.ts`)**

Append these `describe` blocks to `apps/data-pipeline/test/pool-d1.test.ts`:

```typescript
import { PoolDeviceStore, PoolUrlRegistryStore, PoolLeaseStore } from '../src/pool/pool-d1.js';

describe('PoolDeviceStore', () => {
  it('provisions and looks up a device by token hash', async () => {
    const store = new PoolDeviceStore(env.GROUPS);
    await store.provision('dev-1', 'hash-1', '2026-06-14T00:00:00Z');
    expect((await store.findByTokenHash('hash-1'))?.device_id).toBe('dev-1');
    expect(await store.findByTokenHash('nope')).toBeNull();
  });
  it('does not return a disabled device', async () => {
    const store = new PoolDeviceStore(env.GROUPS);
    await store.provision('dev-2', 'hash-2', '2026-06-14T00:00:00Z');
    await env.GROUPS.prepare('UPDATE pool_device SET enabled=0 WHERE device_id=?').bind('dev-2').run();
    expect(await store.findByTokenHash('hash-2')).toBeNull();
  });
});

describe('PoolUrlRegistryStore.selectLeasable', () => {
  const now = '2026-06-14T12:00:00Z';
  it('returns enabled, due, non-backed-off URLs and skips others', async () => {
    const reg = new PoolUrlRegistryStore(env.GROUPS);
    await reg.upsert({ url: 'https://a.com/1', host: 'a.com', waitForSelector: '.x', dwellMs: 2000 });
    await reg.upsert({ url: 'https://b.com/1', host: 'b.com', waitForSelector: null, dwellMs: null });
    await env.GROUPS.prepare('UPDATE pool_url_registry SET enabled=0 WHERE url=?').bind('https://b.com/1').run();
    const got = await reg.selectLeasable(now, 5, new Set());
    expect(got.map((u) => u.url)).toEqual(['https://a.com/1']);
    expect(got[0]!.dwellMs).toBe(2000);
  });
  it('excludes URLs whose host is paced out', async () => {
    const reg = new PoolUrlRegistryStore(env.GROUPS);
    await reg.upsert({ url: 'https://c.com/1', host: 'c.com', waitForSelector: null, dwellMs: null });
    expect((await reg.selectLeasable(now, 5, new Set(['c.com']))).length).toBe(0);
  });
  it('respects the limit', async () => {
    const reg = new PoolUrlRegistryStore(env.GROUPS);
    await reg.upsert({ url: 'https://d.com/1', host: 'd.com', waitForSelector: null, dwellMs: null });
    await reg.upsert({ url: 'https://d.com/2', host: 'd.com', waitForSelector: null, dwellMs: null });
    expect((await reg.selectLeasable(now, 1, new Set())).length).toBe(1);
  });
});

describe('PoolUrlRegistryStore.markFetched / markChallenge', () => {
  const now = '2026-06-14T12:00:00Z';
  it('markFetched clears backoff and sets content_hash + next_due', async () => {
    const reg = new PoolUrlRegistryStore(env.GROUPS);
    await reg.upsert({ url: 'https://e.com/1', host: 'e.com', waitForSelector: null, dwellMs: null });
    await reg.markFetched('https://e.com/1', 'hash123', now, '2026-06-15T12:00:00Z');
    const row = await reg.get('https://e.com/1');
    expect(row?.content_hash).toBe('hash123');
    expect(row?.consecutive_challenges).toBe(0);
    expect(row?.next_due_at).toBe('2026-06-15T12:00:00Z');
  });
  it('markChallenge increments the counter and sets backoff_until', async () => {
    const reg = new PoolUrlRegistryStore(env.GROUPS);
    await reg.upsert({ url: 'https://f.com/1', host: 'f.com', waitForSelector: null, dwellMs: null });
    await reg.markChallenge('https://f.com/1', '2026-06-14T13:00:00Z');
    const row = await reg.get('https://f.com/1');
    expect(row?.consecutive_challenges).toBe(1);
    expect(row?.backoff_until).toBe('2026-06-14T13:00:00Z');
  });
});

describe('PoolLeaseStore', () => {
  const now = '2026-06-14T12:00:00Z';
  const later = '2026-06-14T12:10:00Z';
  it('creates leases, lists open hosts, and marks done', async () => {
    const ls = new PoolLeaseStore(env.GROUPS);
    await ls.create([{ lease_id: 'L1', url: 'https://g.com/1', host: 'g.com', device_id: 'dev-1' }], now, later);
    expect(await ls.openHosts(now)).toContain('g.com');
    const lease = await ls.getOpen('L1', now);
    expect(lease?.url).toBe('https://g.com/1');
    await ls.markDone('L1');
    expect(await ls.getOpen('L1', now)).toBeNull();
  });
  it('reclaimExpired flips stale open leases to expired', async () => {
    const ls = new PoolLeaseStore(env.GROUPS);
    await ls.create([{ lease_id: 'L2', url: 'https://h.com/1', host: 'h.com', device_id: 'dev-1' }], now, '2026-06-14T12:01:00Z');
    const reclaimed = await ls.reclaimExpired('2026-06-14T12:05:00Z');
    expect(reclaimed).toBeGreaterThanOrEqual(1);
    expect(await ls.getOpen('L2', '2026-06-14T12:05:00Z')).toBeNull();
  });
});
```

Also add the top-of-file import next to the existing imports in `test/pool-d1.test.ts` (already added in the snippet above). Keep the `beforeAll` migration block from Task 1.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/data-pipeline && pnpm vitest run test/pool-d1.test.ts`
Expected: FAIL — cannot find module `../src/pool/pool-d1.js`.

- [ ] **Step 4: Write the store implementation**

Create `apps/data-pipeline/src/pool/pool-d1.ts`:

```typescript
import { POOL } from './config.js';

export interface DeviceRow { device_id: string; token_sha256: string; enabled: number; created_at: string; }
export interface UrlRow {
  url: string; host: string; enabled: number; tier: string | null;
  wait_for_selector: string | null; dwell_ms: number | null;
  last_fetched_at: string | null; content_hash: string | null;
  next_due_at: string | null; consecutive_challenges: number; backoff_until: string | null;
}
export interface LeaseRow {
  lease_id: string; url: string; host: string; device_id: string;
  state: 'open' | 'done' | 'expired'; expires_at: string; created_at: string;
}
export interface LeasableUrl { url: string; host: string; waitForSelector: string | null; dwellMs: number; }

/** Device identity + per-device token (stored as a hash; the raw token never persists). */
export class PoolDeviceStore {
  constructor(private readonly db: D1Database) {}

  async provision(deviceId: string, tokenSha256: string, nowIso: string): Promise<void> {
    await this.db
      .prepare('INSERT OR REPLACE INTO pool_device (device_id, token_sha256, enabled, created_at) VALUES (?, ?, 1, ?)')
      .bind(deviceId, tokenSha256, nowIso)
      .run();
  }

  /** Returns the enabled device for a token hash, or null. */
  async findByTokenHash(tokenSha256: string): Promise<DeviceRow | null> {
    return (
      (await this.db
        .prepare('SELECT * FROM pool_device WHERE token_sha256 = ? AND enabled = 1')
        .bind(tokenSha256)
        .first<DeviceRow>()) ?? null
    );
  }
}

/** The curated known-URL list + per-URL change-detection state. */
export class PoolUrlRegistryStore {
  constructor(private readonly db: D1Database) {}

  async upsert(u: { url: string; host: string; waitForSelector: string | null; dwellMs: number | null; tier?: string | null }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO pool_url_registry (url, host, enabled, tier, wait_for_selector, dwell_ms, consecutive_challenges)
         VALUES (?, ?, 1, ?, ?, ?, 0)
         ON CONFLICT(url) DO UPDATE SET host=excluded.host, tier=excluded.tier,
           wait_for_selector=excluded.wait_for_selector, dwell_ms=excluded.dwell_ms`,
      )
      .bind(u.url, u.host, u.tier ?? null, u.waitForSelector, u.dwellMs)
      .run();
  }

  async get(url: string): Promise<UrlRow | null> {
    return (await this.db.prepare('SELECT * FROM pool_url_registry WHERE url = ?').bind(url).first<UrlRow>()) ?? null;
  }

  /**
   * Up to `limit` URLs that are enabled, due (next_due_at null or <= now), not backed off,
   * not currently leased-open, and whose host is not in `pacedHosts`. SQLite sorts NULL first,
   * so never-fetched URLs lead. Caller passes the set of hosts already in flight (pacing).
   */
  async selectLeasable(nowIso: string, limit: number, pacedHosts: Set<string>): Promise<LeasableUrl[]> {
    const res = await this.db
      .prepare(
        `SELECT url, host, wait_for_selector, dwell_ms
           FROM pool_url_registry
          WHERE enabled = 1
            AND (next_due_at IS NULL OR next_due_at <= ?1)
            AND (backoff_until IS NULL OR backoff_until <= ?1)
            AND url NOT IN (SELECT url FROM pool_lease WHERE state='open' AND expires_at > ?1)
          ORDER BY next_due_at ASC
          LIMIT ?2`,
      )
      .bind(nowIso, Math.max(1, limit) * 4) // over-fetch, then host-filter in JS
      .all<{ url: string; host: string; wait_for_selector: string | null; dwell_ms: number | null }>();

    const out: LeasableUrl[] = [];
    const usedHosts = new Set(pacedHosts);
    for (const r of res.results) {
      if (usedHosts.has(r.host)) continue; // one in-flight URL per host per lease batch
      usedHosts.add(r.host);
      out.push({ url: r.url, host: r.host, waitForSelector: r.wait_for_selector, dwellMs: r.dwell_ms ?? POOL.DEFAULT_DWELL_MS });
      if (out.length >= limit) break;
    }
    return out;
  }

  async markFetched(url: string, contentHash: string, nowIso: string, nextDueIso: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE pool_url_registry
            SET last_fetched_at=?2, content_hash=?3, next_due_at=?4,
                consecutive_challenges=0, backoff_until=NULL
          WHERE url=?1`,
      )
      .bind(url, nowIso, contentHash, nextDueIso)
      .run();
  }

  async markChallenge(url: string, backoffUntilIso: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE pool_url_registry
            SET consecutive_challenges = consecutive_challenges + 1, backoff_until = ?2
          WHERE url = ?1`,
      )
      .bind(url, backoffUntilIso)
      .run();
  }
}

/** Lease lifecycle: open → done/expired, with a visibility timeout. */
export class PoolLeaseStore {
  constructor(private readonly db: D1Database) {}

  async create(
    leases: Array<{ lease_id: string; url: string; host: string; device_id: string }>,
    nowIso: string,
    expiresIso: string,
  ): Promise<void> {
    if (leases.length === 0) return;
    const stmts = leases.map((l) =>
      this.db
        .prepare(
          `INSERT INTO pool_lease (lease_id, url, host, device_id, state, expires_at, created_at)
           VALUES (?, ?, ?, ?, 'open', ?, ?)`,
        )
        .bind(l.lease_id, l.url, l.host, l.device_id, expiresIso, nowIso),
    );
    await this.db.batch(stmts);
  }

  /** Hosts with an open, unexpired lease — used by selectLeasable for fleet pacing. */
  async openHosts(nowIso: string): Promise<string[]> {
    const res = await this.db
      .prepare("SELECT DISTINCT host FROM pool_lease WHERE state='open' AND expires_at > ?")
      .bind(nowIso)
      .all<{ host: string }>();
    return res.results.map((r) => r.host);
  }

  async getOpen(leaseId: string, nowIso: string): Promise<LeaseRow | null> {
    return (
      (await this.db
        .prepare("SELECT * FROM pool_lease WHERE lease_id=? AND state='open' AND expires_at > ?")
        .bind(leaseId, nowIso)
        .first<LeaseRow>()) ?? null
    );
  }

  async markDone(leaseId: string): Promise<void> {
    await this.db.prepare("UPDATE pool_lease SET state='done' WHERE lease_id=?").bind(leaseId).run();
  }

  /** Flip open-but-expired leases to 'expired'. Returns the number reclaimed. */
  async reclaimExpired(nowIso: string): Promise<number> {
    const res = await this.db
      .prepare("UPDATE pool_lease SET state='expired' WHERE state='open' AND expires_at <= ?")
      .bind(nowIso)
      .run();
    return res.meta?.changes ?? 0;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/data-pipeline && pnpm vitest run test/pool-d1.test.ts`
Expected: PASS (all pool-d1 describes green).

- [ ] **Step 6: Commit**

```bash
git add apps/data-pipeline/src/pool/pool-d1.ts apps/data-pipeline/src/pool/config.ts apps/data-pipeline/test/pool-d1.test.ts
git commit -m "feat(data-pipeline): pool D1 stores (device, url registry, lease)"
```

---

### Task 4: `gunzipToString` helper

**Files:**
- Create: `apps/data-pipeline/src/pool/gzip.ts`
- Test: `apps/data-pipeline/test/pool-gzip.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/data-pipeline/test/pool-gzip.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { gunzipToString } from '../src/pool/gzip.js';

/** gzip a string with the platform CompressionStream so the test is self-contained. */
async function gzip(s: string): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  void writer.write(new TextEncoder().encode(s));
  void writer.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

describe('gunzipToString', () => {
  it('round-trips a gzipped UTF-8 string', async () => {
    const html = '<html><body>Café — テスト</body></html>';
    expect(await gunzipToString(await gzip(html))).toBe(html);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/data-pipeline && pnpm vitest run test/pool-gzip.test.ts`
Expected: FAIL — cannot find module `../src/pool/gzip.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/data-pipeline/src/pool/gzip.ts`:

```typescript
/** Decompress gzip bytes to a UTF-8 string using the platform DecompressionStream. */
export async function gunzipToString(bytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  return await new Response(ds.readable).text();
}

/** Decode a base64 string to bytes (Workers/miniflare provide global atob). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/data-pipeline && pnpm vitest run test/pool-gzip.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/data-pipeline/src/pool/gzip.ts apps/data-pipeline/test/pool-gzip.test.ts
git commit -m "feat(data-pipeline): pool gzip decode helpers"
```

---

### Task 5: Device authentication

**Files:**
- Create: `apps/data-pipeline/src/pool/auth.ts`
- Test: `apps/data-pipeline/test/pool-auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/data-pipeline/test/pool-auth.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import migrationSql from '../migrations/0003_pool.sql?raw';
import { authenticateDevice } from '../src/pool/auth.js';
import { PoolDeviceStore } from '../src/pool/pool-d1.js';
import { sha256Hex } from '../src/pool/crypto.js';

beforeAll(async () => {
  for (const stmt of migrationSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.GROUPS.prepare(stmt).run();
  }
  const store = new PoolDeviceStore(env.GROUPS);
  await store.provision('dev-auth', await sha256Hex('good-token'), '2026-06-14T00:00:00Z');
});

function req(auth?: string): Request {
  const headers: Record<string, string> = {};
  if (auth !== undefined) headers['Authorization'] = auth;
  return new Request('http://localhost/pool/lease', { method: 'POST', headers });
}

describe('authenticateDevice', () => {
  it('returns the deviceId for a valid Bearer token', async () => {
    expect(await authenticateDevice(req('Bearer good-token'), env)).toBe('dev-auth');
  });
  it('returns null when the header is missing', async () => {
    expect(await authenticateDevice(req(undefined), env)).toBeNull();
  });
  it('returns null when the scheme is not Bearer', async () => {
    expect(await authenticateDevice(req('Token good-token'), env)).toBeNull();
  });
  it('returns null for an unknown token', async () => {
    expect(await authenticateDevice(req('Bearer nope'), env)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/data-pipeline && pnpm vitest run test/pool-auth.test.ts`
Expected: FAIL — cannot find module `../src/pool/auth.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/data-pipeline/src/pool/auth.ts`:

```typescript
import type { Env } from '../env.js';
import { PoolDeviceStore } from './pool-d1.js';
import { sha256Hex } from './crypto.js';

export type PoolEnv = Pick<Env, 'GROUPS' | 'DATA'>;

/**
 * Resolve a request's `Authorization: Bearer <token>` to a deviceId, or null.
 * Tokens are matched by SHA-256 hash lookup (the raw token is never stored), so a
 * single indexed query both authenticates and identifies the device.
 */
export async function authenticateDevice(request: Request, env: PoolEnv): Promise<string | null> {
  const header = request.headers.get('Authorization') ?? '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return null;
  const token = header.slice(prefix.length);
  if (!token) return null;
  const device = await new PoolDeviceStore(env.GROUPS).findByTokenHash(await sha256Hex(token));
  return device?.device_id ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/data-pipeline && pnpm vitest run test/pool-auth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/data-pipeline/src/pool/auth.ts apps/data-pipeline/test/pool-auth.test.ts
git commit -m "feat(data-pipeline): pool per-device Bearer authentication"
```

---

### Task 6: `handleLease` + `routePool` dispatcher

**Files:**
- Create: `apps/data-pipeline/src/pool/handlers.ts`
- Test: `apps/data-pipeline/test/pool-handlers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/data-pipeline/test/pool-handlers.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import migrationSql from '../migrations/0003_pool.sql?raw';
import { routePool } from '../src/pool/handlers.js';
import { PoolDeviceStore, PoolUrlRegistryStore } from '../src/pool/pool-d1.js';
import { sha256Hex } from '../src/pool/crypto.js';
import type { PoolEnv } from '../src/pool/auth.js';

const AUTH = 'Bearer dev-token';

beforeAll(async () => {
  for (const stmt of migrationSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.GROUPS.prepare(stmt).run();
  }
  await new PoolDeviceStore(env.GROUPS).provision('dev-h', await sha256Hex('dev-token'), '2026-06-14T00:00:00Z');
  const reg = new PoolUrlRegistryStore(env.GROUPS);
  await reg.upsert({ url: 'https://lease-a.com/1', host: 'lease-a.com', waitForSelector: '.x', dwellMs: 1500 });
  await reg.upsert({ url: 'https://lease-b.com/1', host: 'lease-b.com', waitForSelector: null, dwellMs: null });
});

function leaseReq(auth: string | undefined, body: unknown): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth !== undefined) headers['Authorization'] = auth;
  return new Request('http://localhost/pool/lease', { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('POST /pool/lease', () => {
  it('401s without a valid token', async () => {
    const res = await routePool(leaseReq(undefined, {}), new URL('http://localhost/pool/lease'), env as PoolEnv);
    expect(res?.status).toBe(401);
  });

  it('returns jobs and creates leases, capped by maxUrls', async () => {
    const res = await routePool(
      leaseReq(AUTH, { battery: { pct: 90, charging: true }, maxUrls: 1 }),
      new URL('http://localhost/pool/lease'),
      env as PoolEnv,
    );
    expect(res?.status).toBe(200);
    const json = (await res!.json()) as { jobs: Array<{ leaseId: string; url: string; engine: string }> };
    expect(json.jobs.length).toBe(1);
    expect(json.jobs[0]!.engine).toBe('webview');
    expect(json.jobs[0]!.leaseId).toMatch(/.+/);
    // The leased URL is now open and excluded from a second lease for the same host.
    const open = await env.GROUPS.prepare("SELECT COUNT(*) AS c FROM pool_lease WHERE state='open'").first<{ c: number }>();
    expect(open!.c).toBeGreaterThanOrEqual(1);
  });

  it('returns an empty job list when nothing is due', async () => {
    // Lease everything first (high maxUrls), then a second call finds no free hosts.
    await routePool(leaseReq(AUTH, { maxUrls: 20 }), new URL('http://localhost/pool/lease'), env as PoolEnv);
    const res = await routePool(leaseReq(AUTH, { maxUrls: 20 }), new URL('http://localhost/pool/lease'), env as PoolEnv);
    const json = (await res!.json()) as { jobs: unknown[] };
    expect(json.jobs.length).toBe(0);
  });
});

describe('routePool dispatch', () => {
  it('returns null for non-pool paths', async () => {
    const res = await routePool(new Request('http://localhost/health'), new URL('http://localhost/health'), env as PoolEnv);
    expect(res).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/data-pipeline && pnpm vitest run test/pool-handlers.test.ts`
Expected: FAIL — cannot find module `../src/pool/handlers.js`.

- [ ] **Step 3: Write the implementation (lease + dispatcher; results/heartbeat added in Task 7)**

Create `apps/data-pipeline/src/pool/handlers.ts`:

```typescript
import type { PoolEnv } from './auth.js';
import { authenticateDevice } from './auth.js';
import { PoolUrlRegistryStore, PoolLeaseStore } from './pool-d1.js';
import { POOL } from './config.js';

export interface LeaseJob { leaseId: string; url: string; host: string; engine: 'webview'; waitForSelector: string | null; dwellMs: number; }
export interface LeaseReqBody { battery?: { pct?: number; charging?: boolean }; appForeground?: boolean; maxUrls?: number; }

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** POST /pool/lease — hand a device up to N due URLs, one per host (fleet pacing). */
export async function handleLease(request: Request, env: PoolEnv): Promise<Response> {
  const deviceId = await authenticateDevice(request, env);
  if (!deviceId) return new Response('unauthorized', { status: 401 });

  let body: LeaseReqBody;
  try {
    body = (await request.json()) as LeaseReqBody;
  } catch {
    return new Response('bad request: invalid JSON', { status: 400 });
  }

  const requested = Number.isInteger(body.maxUrls) ? (body.maxUrls as number) : POOL.DEFAULT_MAX_URLS;
  const limit = Math.max(0, Math.min(requested, POOL.MAX_URLS_CAP));
  if (limit === 0) return json({ jobs: [] });

  const nowIso = new Date().toISOString();
  const reg = new PoolUrlRegistryStore(env.GROUPS);
  const leases = new PoolLeaseStore(env.GROUPS);

  await leases.reclaimExpired(nowIso); // free dropped leases before selecting
  const pacedHosts = new Set(await leases.openHosts(nowIso)); // hosts already in flight fleet-wide
  const urls = await reg.selectLeasable(nowIso, limit, pacedHosts);
  if (urls.length === 0) return json({ jobs: [] });

  const expiresIso = addSeconds(nowIso, POOL.LEASE_TTL_SEC);
  const jobs: LeaseJob[] = urls.map((u) => ({
    leaseId: crypto.randomUUID(),
    url: u.url,
    host: u.host,
    engine: 'webview',
    waitForSelector: u.waitForSelector,
    dwellMs: u.dwellMs,
  }));
  await leases.create(
    jobs.map((j) => ({ lease_id: j.leaseId, url: j.url, host: j.host, device_id: deviceId })),
    nowIso,
    expiresIso,
  );
  return json({ jobs });
}

/** Dispatch /pool/* routes. Returns null if the path is not a pool route. */
export async function routePool(request: Request, url: URL, env: PoolEnv): Promise<Response | null> {
  if (request.method === 'POST' && url.pathname === '/pool/lease') return handleLease(request, env);
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/data-pipeline && pnpm vitest run test/pool-handlers.test.ts`
Expected: PASS (lease + dispatch describes green).

- [ ] **Step 5: Commit**

```bash
git add apps/data-pipeline/src/pool/handlers.ts apps/data-pipeline/test/pool-handlers.test.ts
git commit -m "feat(data-pipeline): POST /pool/lease handler + routePool dispatcher"
```

---

### Task 7: `handleResults` + `handleHeartbeat`

**Files:**
- Modify: `apps/data-pipeline/src/pool/handlers.ts`
- Modify: `apps/data-pipeline/test/pool-handlers.test.ts` (add results + heartbeat describes)

- [ ] **Step 1: Write the failing tests (append to `test/pool-handlers.test.ts`)**

Append to `apps/data-pipeline/test/pool-handlers.test.ts`:

```typescript
import { PoolLeaseStore } from '../src/pool/pool-d1.js';

async function gzipB64(s: string): Promise<string> {
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  void w.write(new TextEncoder().encode(s));
  void w.close();
  const bytes = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function resultsReq(auth: string | undefined, body: unknown): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth !== undefined) headers['Authorization'] = auth;
  return new Request('http://localhost/pool/results', { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('POST /pool/results', () => {
  it('stores DOM in R2, updates registry, and closes the lease (idempotently)', async () => {
    // Create a fresh URL + lease to report against.
    const reg = new PoolUrlRegistryStore(env.GROUPS);
    await reg.upsert({ url: 'https://res.com/1', host: 'res.com', waitForSelector: null, dwellMs: null });
    const ls = new PoolLeaseStore(env.GROUPS);
    const now = new Date().toISOString();
    await ls.create([{ lease_id: 'RES-L1', url: 'https://res.com/1', host: 'res.com', device_id: 'dev-h' }], now, addIso(now, 300));

    const body = {
      leaseId: 'RES-L1', status: 200, finalUrl: 'https://res.com/1', title: 'Res',
      challenge: null, gzippedDomBase64: await gzipB64('<html>data</html>'),
      timings: { loadMs: 100, totalMs: 200 },
    };
    const res = await routePool(resultsReq(AUTH, body), new URL('http://localhost/pool/results'), env as PoolEnv);
    expect(res?.status).toBe(200);

    const row = await reg.get('https://res.com/1');
    expect(row?.content_hash).toMatch(/.+/);
    expect(row?.last_fetched_at).toMatch(/.+/);
    expect(await ls.getOpen('RES-L1', new Date().toISOString())).toBeNull(); // closed

    // R2 object exists under the pool/ prefix.
    const listed = await env.DATA.list({ prefix: 'pool/' });
    expect(listed.objects.length).toBeGreaterThanOrEqual(1);

    // Idempotent: a repeat call for the same (now-closed) lease returns 200 and does not throw.
    const res2 = await routePool(resultsReq(AUTH, body), new URL('http://localhost/pool/results'), env as PoolEnv);
    expect(res2?.status).toBe(200);
  });

  it('records a challenge as backoff, not success', async () => {
    const reg = new PoolUrlRegistryStore(env.GROUPS);
    await reg.upsert({ url: 'https://res.com/2', host: 'res.com', waitForSelector: null, dwellMs: null });
    const ls = new PoolLeaseStore(env.GROUPS);
    const now = new Date().toISOString();
    await ls.create([{ lease_id: 'RES-L2', url: 'https://res.com/2', host: 'res.com', device_id: 'dev-h' }], now, addIso(now, 300));

    const body = {
      leaseId: 'RES-L2', status: 403, challenge: 'DataDome challenge',
      gzippedDomBase64: await gzipB64('blocked'), timings: {},
    };
    const res = await routePool(resultsReq(AUTH, body), new URL('http://localhost/pool/results'), env as PoolEnv);
    expect(res?.status).toBe(200);
    const row = await reg.get('https://res.com/2');
    expect(row?.consecutive_challenges).toBe(1);
    expect(row?.backoff_until).toMatch(/.+/);
    expect(row?.content_hash).toBeNull(); // not treated as fetched
  });

  it('401s without a valid token', async () => {
    const res = await routePool(resultsReq(undefined, { leaseId: 'x' }), new URL('http://localhost/pool/results'), env as PoolEnv);
    expect(res?.status).toBe(401);
  });

  it('404s for an unknown or already-closed lease id with a fresh body', async () => {
    const body = { leaseId: 'does-not-exist', status: 200, challenge: null, gzippedDomBase64: await gzipB64('x'), timings: {} };
    const res = await routePool(resultsReq(AUTH, body), new URL('http://localhost/pool/results'), env as PoolEnv);
    expect(res?.status).toBe(404);
  });
});

describe('POST /pool/heartbeat', () => {
  it('200s for an authenticated device', async () => {
    const req = new Request('http://localhost/pool/heartbeat', {
      method: 'POST', headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: '{}',
    });
    const res = await routePool(req, new URL('http://localhost/pool/heartbeat'), env as PoolEnv);
    expect(res?.status).toBe(200);
  });
});

/** Local ISO offset helper for the tests above. */
function addIso(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/data-pipeline && pnpm vitest run test/pool-handlers.test.ts`
Expected: FAIL — `routePool` returns null for `/pool/results` and `/pool/heartbeat`, so `res` is null and assertions on `res.status` fail.

- [ ] **Step 3: Extend the implementation**

In `apps/data-pipeline/src/pool/handlers.ts`, add imports at the top:

```typescript
import { fnv1a } from '@travel/pipeline-core';
import { gunzipToString, base64ToBytes } from './gzip.js';
import { sha256Hex } from './crypto.js';
```

Add the `ResultReqBody` type next to the other exported interfaces:

```typescript
export interface ResultReqBody {
  leaseId: string; status: number; finalUrl?: string; title?: string;
  challenge: string | null; gzippedDomBase64: string; timings?: { loadMs?: number; totalMs?: number };
}
```

Add these two handlers (above `routePool`):

```typescript
/** POST /pool/results — store the rendered DOM, update registry state, close the lease. */
export async function handleResults(request: Request, env: PoolEnv): Promise<Response> {
  const deviceId = await authenticateDevice(request, env);
  if (!deviceId) return new Response('unauthorized', { status: 401 });

  let body: ResultReqBody;
  try {
    body = (await request.json()) as ResultReqBody;
  } catch {
    return new Response('bad request: invalid JSON', { status: 400 });
  }
  if (typeof body.leaseId !== 'string' || typeof body.gzippedDomBase64 !== 'string') {
    return new Response('bad request: leaseId and gzippedDomBase64 required', { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const leases = new PoolLeaseStore(env.GROUPS);
  const lease = await leases.getOpen(body.leaseId, nowIso);
  if (!lease) {
    // Idempotency: if THIS device already closed this lease, treat as success; else 404.
    const known = await env.GROUPS
      .prepare("SELECT state, device_id FROM pool_lease WHERE lease_id = ?")
      .bind(body.leaseId)
      .first<{ state: string; device_id: string }>();
    if (known && known.state === 'done' && known.device_id === deviceId) return json({ ok: true, duplicate: true });
    return new Response('not found: no open lease for id', { status: 404 });
  }
  if (lease.device_id !== deviceId) return new Response('forbidden: lease belongs to another device', { status: 403 });

  const reg = new PoolUrlRegistryStore(env.GROUPS);

  if (body.challenge) {
    // Bot wall: back the URL off exponentially; do NOT treat as a successful fetch.
    const row = await reg.get(lease.url);
    const n = (row?.consecutive_challenges ?? 0) + 1;
    const backoffSec = Math.min(POOL.BACKOFF_BASE_SEC * 2 ** (n - 1), POOL.BACKOFF_MAX_SEC);
    await reg.markChallenge(lease.url, addSeconds(nowIso, backoffSec));
    await leases.markDone(body.leaseId);
    return json({ ok: true, challenge: body.challenge });
  }

  // Success path: decode → store raw DOM in R2 → content-hash → update registry → close lease.
  const bytes = base64ToBytes(body.gzippedDomBase64);
  const dom = await gunzipToString(bytes);
  const contentHash = fnv1a(dom);
  const key = `pool/${(await sha256Hex(lease.url)).slice(0, 16)}/${Date.parse(nowIso)}.html.gz`;
  await env.DATA.put(key, bytes, {
    httpMetadata: { contentType: 'text/html; charset=utf-8', contentEncoding: 'gzip' },
    customMetadata: { url: lease.url, deviceId, leaseId: body.leaseId, contentHash, fetchedAt: nowIso },
  });
  await reg.markFetched(lease.url, contentHash, nowIso, addSeconds(nowIso, POOL.REFRESH_INTERVAL_SEC));
  await leases.markDone(body.leaseId);
  return json({ ok: true, contentHash, stored: key });
}

/** POST /pool/heartbeat — liveness; 200 if the device authenticates. */
export async function handleHeartbeat(request: Request, env: PoolEnv): Promise<Response> {
  const deviceId = await authenticateDevice(request, env);
  if (!deviceId) return new Response('unauthorized', { status: 401 });
  return json({ ok: true, deviceId });
}
```

Extend `routePool` to dispatch the new routes:

```typescript
export async function routePool(request: Request, url: URL, env: PoolEnv): Promise<Response | null> {
  if (request.method === 'POST' && url.pathname === '/pool/lease') return handleLease(request, env);
  if (request.method === 'POST' && url.pathname === '/pool/results') return handleResults(request, env);
  if (request.method === 'POST' && url.pathname === '/pool/heartbeat') return handleHeartbeat(request, env);
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/data-pipeline && pnpm vitest run test/pool-handlers.test.ts`
Expected: PASS (lease + results + heartbeat + dispatch all green).

- [ ] **Step 5: Commit**

```bash
git add apps/data-pipeline/src/pool/handlers.ts apps/data-pipeline/test/pool-handlers.test.ts
git commit -m "feat(data-pipeline): POST /pool/results (R2 + content-hash + backoff) and /pool/heartbeat"
```

---

### Task 8: Wire `routePool` into the Worker `fetch` handler

**Files:**
- Modify: `apps/data-pipeline/src/index.ts`
- Test: `apps/data-pipeline/test/pool-integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `apps/data-pipeline/test/pool-integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import handler from '../src/index.js';
import type { Env } from '../src/env.js';
import migrationSql from '../migrations/0003_pool.sql?raw';
import { PoolDeviceStore } from '../src/pool/pool-d1.js';
import { sha256Hex } from '../src/pool/crypto.js';

beforeAll(async () => {
  for (const stmt of migrationSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.GROUPS.prepare(stmt).run();
  }
  await new PoolDeviceStore(env.GROUPS).provision('dev-int', await sha256Hex('int-token'), '2026-06-14T00:00:00Z');
});

describe('Worker fetch → pool routes', () => {
  it('routes POST /pool/lease through the top-level handler', async () => {
    const req = new Request('http://localhost/pool/lease', {
      method: 'POST',
      headers: { Authorization: 'Bearer int-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxUrls: 3 }),
    });
    const res = await handler.fetch(req, env as unknown as Env);
    expect(res.status).toBe(200);
    expect((await res.json()) as { jobs: unknown[] }).toHaveProperty('jobs');
  });

  it('still 404s unknown paths', async () => {
    const res = await handler.fetch(new Request('http://localhost/nope', { method: 'POST' }), env as unknown as Env);
    expect(res.status).toBe(404);
  });

  it('still serves /health', async () => {
    const res = await handler.fetch(new Request('http://localhost/health'), env as unknown as Env);
    expect(await res.text()).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/data-pipeline && pnpm vitest run test/pool-integration.test.ts`
Expected: FAIL — `/pool/lease` falls through to the `404 not found` branch (status 404, not 200).

- [ ] **Step 3: Wire the dispatcher into `src/index.ts`**

In `apps/data-pipeline/src/index.ts`, add the import after the existing imports at the top:

```typescript
import { routePool } from './pool/handlers.js';
```

Then, inside `fetch`, immediately after the `if (url.pathname === '/health') return new Response('ok');` line, add:

```typescript
    const poolRes = await routePool(request, url, env);
    if (poolRes) return poolRes;
```

(The existing `/ingest` block and `404` fallthrough remain unchanged below it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/data-pipeline && pnpm vitest run test/pool-integration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `cd apps/data-pipeline && pnpm vitest run && pnpm typecheck`
Expected: All tests PASS; `tsc -b` exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/data-pipeline/src/index.ts apps/data-pipeline/test/pool-integration.test.ts
git commit -m "feat(data-pipeline): wire pool routes into the Worker fetch handler"
```

---

### Task 9: Dev seeding utility + README

**Files:**
- Create: `apps/data-pipeline/scripts/pool-seed.ts`
- Create: `apps/data-pipeline/src/pool/README.md`

- [ ] **Step 1: Write the seeding script**

Create `apps/data-pipeline/scripts/pool-seed.ts`. It prints SQL (rather than connecting to D1 directly) so it works for both local and remote via `wrangler d1 execute`. This keeps the script pure and dependency-free.

```typescript
/**
 * Emit SQL to provision one pool device token and seed URLs.
 * Usage:
 *   tsx scripts/pool-seed.ts <deviceId> <rawToken> <url> [url...] > seed.sql
 *   wrangler d1 execute travel-groups --local --file=seed.sql
 *
 * The raw token is hashed with SHA-256; only the hash is stored. Print the raw
 * token to the operator once (stderr) so it can be pushed to the device via MDM.
 */
import { createHash } from 'node:crypto';

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function hostOf(u: string): string {
  return new URL(u).host;
}

const [deviceId, rawToken, ...urls] = process.argv.slice(2);
if (!deviceId || !rawToken || urls.length === 0) {
  console.error('usage: tsx scripts/pool-seed.ts <deviceId> <rawToken> <url> [url...]');
  process.exit(1);
}
const now = new Date().toISOString();
const lines: string[] = [];
lines.push(
  `INSERT OR REPLACE INTO pool_device (device_id, token_sha256, enabled, created_at) VALUES ('${deviceId}', '${sha256Hex(rawToken)}', 1, '${now}');`,
);
for (const u of urls) {
  lines.push(
    `INSERT OR IGNORE INTO pool_url_registry (url, host, enabled, consecutive_challenges) VALUES ('${u.replace(/'/g, "''")}', '${hostOf(u)}', 1, 0);`,
  );
}
console.error(`device token (push via MDM, store nowhere else): ${rawToken}`);
console.log(lines.join('\n'));
```

- [ ] **Step 2: Verify the script emits valid SQL (manual)**

Run: `cd apps/data-pipeline && pnpm tsx scripts/pool-seed.ts dev-001 testtoken123 https://example.com/a https://example.com/b`
Expected (stdout): three SQL `INSERT` lines (1 device, 2 URLs); stderr prints the raw token once. No DB write yet.

- [ ] **Step 3: Apply locally and smoke-test the endpoint (manual)**

```bash
cd apps/data-pipeline
pnpm wrangler d1 migrations apply travel-groups --local
pnpm tsx scripts/pool-seed.ts dev-001 testtoken123 https://example.com/a > /tmp/seed.sql
pnpm wrangler d1 execute travel-groups --local --file=/tmp/seed.sql
pnpm wrangler dev &   # then:
curl -s localhost:8787/pool/lease -H 'Authorization: Bearer testtoken123' \
  -H 'Content-Type: application/json' -d '{"maxUrls":1}'
```
Expected: JSON `{ "jobs": [ { "leaseId": "…", "url": "https://example.com/a", "engine": "webview", … } ] }`.

- [ ] **Step 4: Write the README**

Create `apps/data-pipeline/src/pool/README.md`:

```markdown
# Device Fetch Pool — Coordinator

Worker endpoints that let MDM-managed Android devices lease known URLs, return the
rendered DOM, and feed the existing pipeline. Spec:
`docs/superpowers/specs/2026-06-14-device-fetch-pool-design.md`.

## Endpoints (all require `Authorization: Bearer <device-token>`)

- `POST /pool/lease` — body `{ battery?, appForeground?, maxUrls? }` → `{ jobs: LeaseJob[] }`.
  One URL per host per batch (fleet pacing); honours per-URL `next_due` and host backoff.
- `POST /pool/results` — body `{ leaseId, status, challenge, gzippedDomBase64, timings }`.
  Stores the gzipped DOM in R2 (`pool/<urlhash>/<ts>.html.gz`), content-hashes it (`fnv1a`),
  updates the registry, and closes the lease. Idempotent per lease. `challenge` → host backoff.
- `POST /pool/heartbeat` — liveness; `{ ok: true }` when authenticated.

## State (in the `GROUPS` D1 database; migration `0003_pool.sql`)

- `pool_device` — device_id + SHA-256 of its token (raw token never stored).
- `pool_url_registry` — the curated URL list + change-detection state (content_hash, next_due, backoff).
- `pool_lease` — open/done/expired with a visibility timeout (`POOL.LEASE_TTL_SEC`).

## Provision a device + seed URLs

```
tsx scripts/pool-seed.ts <deviceId> <rawToken> <url> [url...] > seed.sql
wrangler d1 execute travel-groups --local --file=seed.sql   # drop --local for prod
```

## Tunables

See `src/pool/config.ts` (`POOL.*`): lease TTL, max URLs/lease, backoff base/cap, refresh interval.

## Not here

The Android pool app and MDM rollout are separate subsystems/plans. Target-URL governance
must respect the catalog tiers (`docs/research/travel-data-sources-catalog.md`): permitted,
IP-reputation-gated sources only — never red-tier.
```

- [ ] **Step 5: Commit**

```bash
git add apps/data-pipeline/scripts/pool-seed.ts apps/data-pipeline/src/pool/README.md
git commit -m "chore(data-pipeline): pool dev-seed script + coordinator README"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- §5 endpoints (`/pool/lease`, `/pool/results`, `/pool/heartbeat`) → Tasks 6, 7; visibility timeout → Task 3 (`reclaimExpired`) + Task 6; per-host pacing → Task 3 (`selectLeasable` + `openHosts`) + Task 6.
- §6 data model (`url_registry`, `lease`, R2 payloads) → Task 1 schema, Task 3 stores, Task 7 R2 put; envelope reuse (`fnv1a`) → Task 7.
- §9 security: per-device Bearer → Task 5; server-side host allowlist/SSRF guard → the registry IS the allowlist (devices only ever receive registry URLs, Task 6); size/idempotency → Task 7.
- §10 resilience: challenge→backoff → Task 7; dropped-lease reclaim → Tasks 3/6; idempotent results → Task 7; (per-URL render timeout is device-side, out of this plan's scope — noted).
- §11 testing: Vitest coordinator tests across Tasks 1–8; curl smoke → Task 9.

**Deferred to separate plans (not gaps):** Android app (§7, §8), MDM packaging/rollout (§11 device steps), per-URL render timeout (device-side), allowlist curation tooling/governance (§14 open question).

**Placeholder scan:** none — every step has complete code or an exact command.

**Type consistency:** `LeaseJob`, `LeaseReqBody`, `ResultReqBody`, `LeasableUrl`, and the three row types are defined once and referenced consistently; `selectLeasable(nowIso, limit, pacedHosts)`, `create(...)`, `getOpen`, `markDone`, `reclaimExpired`, `openHosts`, `markFetched`, `markChallenge` signatures match between Task 3 (definition) and Tasks 6–7 (use). `PoolEnv = Pick<Env,'GROUPS'|'DATA'>` is defined in Task 5 and reused in Tasks 6–8.

## Notes / known limitations (for the executor)

- **Lease selection race:** `selectLeasable` then `create` are separate statements, so two simultaneous devices could rarely double-lease one URL. Acceptable for a best-effort pool; the visibility timeout and idempotent results bound the damage. If it bites, move selection+insert into a single `batch()` with a conditional insert.
- **`fnv1a` import:** confirmed exported from `@travel/pipeline-core` (used by `scripts/connectors/core/fingerprint.ts`). If the alias differs in the workers test pool, the `vitest.config.ts` alias already maps `@travel/pipeline-core` → `packages/pipeline-core/src/index.ts`.
- **R2 in tests:** `env.DATA` is provided by `vitest.config.ts` (`r2Buckets: ["DATA"]`) — no mocking needed.
```
