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
