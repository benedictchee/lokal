-- apps/data-pipeline/migrations/0002_reviews.sql
-- Review dedup index + extracted critical-information store (read-side serving + watermark).

CREATE TABLE IF NOT EXISTS review_fingerprints (
  place_id    TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  first_seen  TEXT NOT NULL,            -- ISO timestamp
  PRIMARY KEY (place_id, fingerprint)   -- unique index = the dedup
);

CREATE TABLE IF NOT EXISTS place_critical_info (
  place_id          TEXT PRIMARY KEY,
  record_uuid       TEXT NOT NULL,      -- == Vectorize vector id
  critical_json     TEXT NOT NULL,      -- the facets JSON
  embed_text        TEXT NOT NULL,      -- serialized facets used for embedding
  review_count      INTEGER NOT NULL,   -- cumulative reviews seen
  updated_at        TEXT NOT NULL,
  last_processed_at TEXT NOT NULL       -- time watermark for the next delta
);
