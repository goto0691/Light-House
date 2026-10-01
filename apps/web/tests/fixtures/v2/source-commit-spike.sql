CREATE TABLE v2_capture_bundles (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  title TEXT,
  body_text TEXT,
  ai_enabled INTEGER NOT NULL CHECK (ai_enabled IN (0, 1)),
  status TEXT NOT NULL CHECK (status = 'source_committed'),
  committed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, draft_id)
);

--> statement-breakpoint

CREATE TABLE v2_source_items (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  capture_id TEXT NOT NULL REFERENCES v2_capture_bundles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'audio', 'file', 'transcript')),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  text_content TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (capture_id, ordinal)
);

--> statement-breakpoint

CREATE TABLE v2_attachment_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'uploaded', 'verified', 'expired')),
  object_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

--> statement-breakpoint

CREATE TABLE v2_source_attachment_links (
  user_id TEXT NOT NULL,
  source_item_id TEXT NOT NULL REFERENCES v2_source_items(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES v2_attachment_reservations(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_item_id, attachment_id),
  UNIQUE (attachment_id)
);

--> statement-breakpoint

CREATE TRIGGER v2_verified_attachment_link_insert
BEFORE INSERT ON v2_source_attachment_links
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM v2_attachment_reservations reservation
      WHERE reservation.id = NEW.attachment_id
        AND reservation.user_id = NEW.user_id
        AND reservation.status = 'verified'
    )
    THEN RAISE(ABORT, 'attachment_not_verified_for_user')
  END;
END;

--> statement-breakpoint

CREATE TABLE v2_processing_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  capture_id TEXT NOT NULL REFERENCES v2_capture_bundles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type = 'analyze'),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'pending'),
  created_at TEXT NOT NULL,
  UNIQUE (capture_id, event_type)
);

--> statement-breakpoint

CREATE TABLE v2_idempotency_records (
  user_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, operation, idempotency_key)
);
