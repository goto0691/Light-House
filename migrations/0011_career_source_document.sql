ALTER TABLE career_history ADD COLUMN source_document_id TEXT REFERENCES source_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_career_source_document
  ON career_history(source_document_id);
