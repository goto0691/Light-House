CREATE TABLE IF NOT EXISTS source_property_mappings (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_database TEXT NOT NULL DEFAULT '*',
  canonical_entity_type TEXT NOT NULL DEFAULT '*',
  property_name TEXT NOT NULL,
  property_type TEXT NOT NULL DEFAULT '*',
  status TEXT NOT NULL DEFAULT 'mapped',
  target_field TEXT,
  display_label TEXT,
  reason TEXT,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_source_property_mapping_lookup
  ON source_property_mappings(user_id, source_database, canonical_entity_type, property_name, property_type);

CREATE INDEX IF NOT EXISTS idx_source_property_mapping_status
  ON source_property_mappings(user_id, status);
