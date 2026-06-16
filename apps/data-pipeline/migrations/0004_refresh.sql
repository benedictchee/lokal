-- Connector refresh loop: per-source snapshot + per-record change-detection state.

-- One row per connector id. Cheap source-level "did anything change?" skip.
CREATE TABLE IF NOT EXISTS source_snapshot (
  source             TEXT PRIMARY KEY,
  fingerprint_method TEXT,
  fingerprint_value  TEXT,
  cursor             TEXT,
  since_ts           TEXT,
  last_run_at        TEXT,
  last_status        TEXT
);

-- One row per record. Per-record content_hash diff (new / changed / unchanged).
CREATE TABLE IF NOT EXISTS record_state (
  record_uuid     TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  source_url      TEXT,
  content_hash    TEXT NOT NULL,
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  last_changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_record_state_source ON record_state (source, last_seen_at);
