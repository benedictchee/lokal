/** Per-source snapshot + per-record change-detection state (migration 0004). */

export interface SnapshotRow {
  source: string;
  fingerprint_method: string | null;
  fingerprint_value: string | null;
  cursor: string | null;
  since_ts: string | null;
  last_run_at: string | null;
  last_status: string | null;
}

export interface ObservedRecord {
  record_uuid: string;
  source: string;
  source_url: string;
  content_hash: string;
}

/** One row per connector id — the cheap source-level skip key. */
export class SourceSnapshotStore {
  constructor(private readonly db: D1Database) {}

  async get(source: string): Promise<SnapshotRow | null> {
    return (
      (await this.db.prepare('SELECT * FROM source_snapshot WHERE source = ?').bind(source).first<SnapshotRow>()) ?? null
    );
  }

  async save(row: SnapshotRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO source_snapshot
           (source, fingerprint_method, fingerprint_value, cursor, since_ts, last_run_at, last_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(row.source, row.fingerprint_method, row.fingerprint_value, row.cursor, row.since_ts, row.last_run_at, row.last_status)
      .run();
  }

  /** Record an unchanged run: advance last_run_at, set status, keep the fingerprint. */
  async markUnchanged(source: string, nowIso: string): Promise<void> {
    await this.db
      .prepare("UPDATE source_snapshot SET last_run_at = ?2, last_status = 'unchanged' WHERE source = ?1")
      .bind(source, nowIso)
      .run();
  }
}

/** One row per record — the per-record content_hash diff state. */
export class RecordStateStore {
  constructor(private readonly db: D1Database) {}

  /** record_uuid -> content_hash for every known record of a source. */
  async hashesForSource(source: string): Promise<Map<string, string>> {
    const res = await this.db
      .prepare('SELECT record_uuid, content_hash FROM record_state WHERE source = ?')
      .bind(source)
      .all<{ record_uuid: string; content_hash: string }>();
    return new Map(res.results.map((r) => [r.record_uuid, r.content_hash]));
  }

  /**
   * Upsert every observed record. New rows stamp first/last/changed = now.
   * Existing rows always advance last_seen_at; last_changed_at advances ONLY
   * when content_hash differs (the CASE reads the pre-update row value).
   */
  async upsertObserved(records: ObservedRecord[], nowIso: string): Promise<void> {
    if (records.length === 0) return;
    const stmts = records.map((r) =>
      this.db
        .prepare(
          `INSERT INTO record_state (record_uuid, source, source_url, content_hash, first_seen_at, last_seen_at, last_changed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5)
           ON CONFLICT(record_uuid) DO UPDATE SET
             source_url      = excluded.source_url,
             last_seen_at    = excluded.last_seen_at,
             last_changed_at = CASE WHEN record_state.content_hash <> excluded.content_hash
                                    THEN excluded.last_seen_at ELSE record_state.last_changed_at END,
             content_hash    = excluded.content_hash`,
        )
        .bind(r.record_uuid, r.source, r.source_url, r.content_hash, nowIso),
    );
    await this.db.batch(stmts);
  }
}
