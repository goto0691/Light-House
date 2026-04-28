ALTER TABLE source_documents ADD COLUMN source_path TEXT;
ALTER TABLE source_documents ADD COLUMN raw_content TEXT;
ALTER TABLE source_documents ADD COLUMN raw_content_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_source_document_raw_hash
  ON source_documents(raw_content_hash);
