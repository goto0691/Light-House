CREATE TABLE IF NOT EXISTS source_documents (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL DEFAULT 'notion',
  source_id TEXT NOT NULL,
  import_batch_id TEXT,
  source_database TEXT,
  title TEXT NOT NULL,
  document_role TEXT,
  canonical_entity_type TEXT,
  canonical_entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  url TEXT,
  raw_properties TEXT,
  raw_content_preview TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_source_document_user_source
  ON source_documents(user_id, source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_source_document_canonical
  ON source_documents(canonical_entity_type, canonical_entity_id);

CREATE INDEX IF NOT EXISTS idx_source_document_user_database
  ON source_documents(user_id, source_database);

CREATE INDEX IF NOT EXISTS idx_source_document_user_role
  ON source_documents(user_id, document_role);

CREATE TABLE IF NOT EXISTS source_document_properties (
  id TEXT PRIMARY KEY NOT NULL,
  source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  property_key TEXT NOT NULL,
  property_name TEXT NOT NULL,
  property_type TEXT,
  value_text TEXT,
  value_json TEXT,
  normalized_value TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_source_property_source_key
  ON source_document_properties(source_document_id, property_key);

CREATE INDEX IF NOT EXISTS idx_source_property_normalized
  ON source_document_properties(normalized_value);

CREATE TABLE IF NOT EXISTS source_document_relations (
  id TEXT PRIMARY KEY NOT NULL,
  source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  relation_name TEXT NOT NULL,
  target_source_id TEXT,
  target_title TEXT,
  resolved_entity_type TEXT,
  resolved_entity_id TEXT,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_source_relation_source
  ON source_document_relations(source_document_id);

CREATE INDEX IF NOT EXISTS idx_source_relation_resolved
  ON source_document_relations(resolved_entity_type, resolved_entity_id);
