-- Program-owned group identity registry (write-side state for entity resolution, v1).
-- groups: minted UUIDv7 identities. group_aliases: match signals -> group_uuid.
CREATE TABLE IF NOT EXISTS groups (
  group_uuid     TEXT PRIMARY KEY,   -- minted UUIDv7 (program-internal, never an external id)
  subject        TEXT NOT NULL,
  kind           TEXT NOT NULL,      -- chain | transport_category | standalone
  canonical_name TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_aliases (
  alias_key  TEXT PRIMARY KEY,       -- brand:wikidata:Q123 | brand:slug:<slug> | transport:<cat> | standalone:<record_uuid>
  group_uuid TEXT NOT NULL,
  FOREIGN KEY (group_uuid) REFERENCES groups(group_uuid)
);

CREATE INDEX IF NOT EXISTS idx_group_aliases_group ON group_aliases(group_uuid);
