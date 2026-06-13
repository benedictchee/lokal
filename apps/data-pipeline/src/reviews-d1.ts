export interface FingerprintRow {
  fp: string;
  firstSeen: string;
}

/** Per-place review dedup backed by the review_fingerprints unique index. */
export class D1ReviewFingerprintStore {
  constructor(private readonly db: D1Database) {}

  /** Batch INSERT OR IGNORE; returns the set of fps that were NEWLY inserted. */
  async markSeen(placeId: string, rows: FingerprintRow[]): Promise<Set<string>> {
    if (rows.length === 0) return new Set();
    const stmts = rows.map((r) =>
      this.db
        .prepare(
          'INSERT OR IGNORE INTO review_fingerprints (place_id, fingerprint, first_seen) VALUES (?, ?, ?)',
        )
        .bind(placeId, r.fp, r.firstSeen),
    );
    const results = await this.db.batch(stmts);
    const fresh = new Set<string>();
    results.forEach((res, i) => {
      if ((res.meta?.changes ?? 0) > 0) fresh.add(rows[i]!.fp);
    });
    return fresh;
  }
}

export interface CriticalInfoRow {
  place_id: string;
  record_uuid: string;
  critical_json: string;
  embed_text: string;
  review_count: number;
  updated_at: string;
  last_processed_at: string;
}

/** Read/write the extracted critical information per place (easy-access store). */
export class D1CriticalInfoStore {
  constructor(private readonly db: D1Database) {}

  async get(placeId: string): Promise<CriticalInfoRow | null> {
    return (
      (await this.db
        .prepare('SELECT * FROM place_critical_info WHERE place_id = ?')
        .bind(placeId)
        .first<CriticalInfoRow>()) ?? null
    );
  }

  async put(row: CriticalInfoRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO place_critical_info
         (place_id, record_uuid, critical_json, embed_text, review_count, updated_at, last_processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.place_id,
        row.record_uuid,
        row.critical_json,
        row.embed_text,
        row.review_count,
        row.updated_at,
        row.last_processed_at,
      )
      .run();
  }
}
