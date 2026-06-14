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
