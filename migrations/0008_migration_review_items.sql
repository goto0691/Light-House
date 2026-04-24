CREATE TABLE IF NOT EXISTS migration_review_items (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_document_id TEXT REFERENCES source_documents(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  issue_type TEXT NOT NULL,
  suggested_action TEXT NOT NULL,
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'open',
  reason TEXT,
  payload TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_migration_review_user_status
  ON migration_review_items(user_id, status);

CREATE INDEX IF NOT EXISTS idx_migration_review_user_issue
  ON migration_review_items(user_id, issue_type);

CREATE INDEX IF NOT EXISTS idx_migration_review_entity
  ON migration_review_items(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_migration_review_source_document
  ON migration_review_items(source_document_id);
