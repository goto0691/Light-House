CREATE TABLE `v2_capture_bundles` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `draft_id` text NOT NULL,
  `capture_channel` text NOT NULL CHECK (`capture_channel` IN ('web','mobile_share','clipboard','import','api')),
  `user_note` text,
  `ai_enabled` integer NOT NULL CHECK (`ai_enabled` IN (0,1)),
  `client_timezone` text NOT NULL,
  `processing_status` text DEFAULT 'pending' NOT NULL CHECK (`processing_status` IN ('pending','analyzing','enriching','completed','needs_review','failed_retryable','unclassified')),
  `processing_priority` text DEFAULT 'interactive' NOT NULL CHECK (`processing_priority` IN ('interactive','background','migration')),
  `content_hash` text NOT NULL,
  `template_version_id` text,
  `captured_at` text NOT NULL,
  `committed_at` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_capture_user_draft` ON `v2_capture_bundles` (`user_id`,`draft_id`);
--> statement-breakpoint
CREATE INDEX `idx_v2_capture_user_time` ON `v2_capture_bundles` (`user_id`,`captured_at`);
--> statement-breakpoint

CREATE TABLE `v2_attachment_reservations` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `status` text DEFAULT 'reserved' NOT NULL CHECK (`status` IN ('reserved','uploaded_unverified','verified','committed','expired')),
  `object_key` text NOT NULL,
  `filename` text NOT NULL,
  `mime_type` text NOT NULL,
  `size_bytes` integer NOT NULL CHECK (`size_bytes` > 0 AND `size_bytes` <= 104857600),
  `sha256` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `verified_at` text,
  `committed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_attachment_object_key` ON `v2_attachment_reservations` (`object_key`);
--> statement-breakpoint
CREATE INDEX `idx_v2_attachment_user_status` ON `v2_attachment_reservations` (`user_id`,`status`,`created_at`);
--> statement-breakpoint

CREATE TABLE `v2_source_items` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `capture_id` text NOT NULL REFERENCES `v2_capture_bundles`(`id`) ON DELETE cascade,
  `item_kind` text NOT NULL CHECK (`item_kind` IN ('text','image','audio','video','document','transcript','url')),
  `display_order` integer NOT NULL CHECK (`display_order` >= 0),
  `raw_text` text,
  `content_hash` text NOT NULL,
  `source_metadata` text,
  `immutability_version` integer DEFAULT 1 NOT NULL CHECK (`immutability_version` = 1),
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_source_capture_order` ON `v2_source_items` (`capture_id`,`display_order`);
--> statement-breakpoint
CREATE INDEX `idx_v2_source_user_capture` ON `v2_source_items` (`user_id`,`capture_id`);
--> statement-breakpoint

CREATE TABLE `v2_source_attachment_links` (
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `source_item_id` text NOT NULL REFERENCES `v2_source_items`(`id`) ON DELETE cascade,
  `attachment_id` text NOT NULL REFERENCES `v2_attachment_reservations`(`id`),
  `created_at` text NOT NULL,
  PRIMARY KEY (`source_item_id`,`attachment_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_source_attachment_once` ON `v2_source_attachment_links` (`attachment_id`);
--> statement-breakpoint
CREATE INDEX `idx_v2_source_attachment_user` ON `v2_source_attachment_links` (`user_id`,`source_item_id`);
--> statement-breakpoint
CREATE TRIGGER `v2_verified_attachment_link_insert`
BEFORE INSERT ON `v2_source_attachment_links`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `v2_attachment_reservations` reservation
    WHERE reservation.id = NEW.attachment_id
      AND reservation.user_id = NEW.user_id
      AND reservation.status = 'verified'
  ) THEN RAISE(ABORT, 'attachment_not_verified_for_user') END;
END;
--> statement-breakpoint

CREATE TABLE `v2_idempotency_records` (
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `operation` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `payload_hash` text NOT NULL,
  `response_json` text NOT NULL,
  `status_code` integer NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`user_id`,`operation`,`idempotency_key`)
);
--> statement-breakpoint

CREATE TABLE `v2_processing_outbox` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `capture_id` text NOT NULL REFERENCES `v2_capture_bundles`(`id`) ON DELETE cascade,
  `event_type` text NOT NULL CHECK (`event_type` = 'analyze'),
  `payload_json` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending','dispatched','failed')),
  `created_at` text NOT NULL,
  `dispatched_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_outbox_capture_event` ON `v2_processing_outbox` (`capture_id`,`event_type`);
--> statement-breakpoint
CREATE INDEX `idx_v2_outbox_status_time` ON `v2_processing_outbox` (`status`,`created_at`);
--> statement-breakpoint

CREATE TABLE `v2_processing_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `capture_id` text NOT NULL REFERENCES `v2_capture_bundles`(`id`) ON DELETE cascade,
  `object_id` text,
  `stage` text NOT NULL,
  `status` text DEFAULT 'queued' NOT NULL CHECK (`status` IN ('queued','leased','running','succeeded','retry_wait','needs_review','dead_letter','superseded')),
  `priority` text DEFAULT 'interactive' NOT NULL,
  `idempotency_key` text NOT NULL,
  `attempt` integer DEFAULT 0 NOT NULL,
  `max_attempts` integer NOT NULL,
  `next_attempt_at` text NOT NULL,
  `lease_owner` text,
  `lease_expires_at` text,
  `dependency_job_id` text,
  `input_revision_id` text,
  `input_hash` text NOT NULL,
  `created_at` text NOT NULL,
  `started_at` text,
  `finished_at` text,
  `last_error_class` text,
  `last_error_code` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_job_idempotency` ON `v2_processing_jobs` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_v2_job_claim` ON `v2_processing_jobs` (`status`,`priority`,`next_attempt_at`);
--> statement-breakpoint

CREATE TABLE `v2_processing_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL REFERENCES `v2_processing_jobs`(`id`) ON DELETE cascade,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `model_role` text NOT NULL,
  `model_id` text NOT NULL,
  `prompt_version` text NOT NULL,
  `schema_version` text NOT NULL,
  `registry_version` text NOT NULL,
  `model_config_version` text NOT NULL,
  `input_hash` text NOT NULL,
  `output_hash` text,
  `input_tokens` integer,
  `output_tokens` integer,
  `latency_ms` integer,
  `provider_request_id_hash` text,
  `status` text NOT NULL CHECK (`status` IN ('running','succeeded','partial','failed','stale','superseded')),
  `validation_error_code` text,
  `grounding_query_count` integer DEFAULT 0 NOT NULL,
  `cited_source_count` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `finished_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_v2_run_job_time` ON `v2_processing_runs` (`job_id`,`created_at`);
--> statement-breakpoint

CREATE TABLE `v2_objects` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `object_kind` text NOT NULL CHECK (`object_kind` IN ('document','entity','event')),
  `lifecycle_status` text DEFAULT 'active' NOT NULL CHECK (`lifecycle_status` IN ('active','archived','merged','deleted')),
  `canonical_object_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_v2_object_user_lifecycle` ON `v2_objects` (`user_id`,`lifecycle_status`,`updated_at`);
--> statement-breakpoint

CREATE TABLE `v2_documents` (
  `object_id` text PRIMARY KEY NOT NULL REFERENCES `v2_objects`(`id`) ON DELETE cascade,
  `capture_id` text NOT NULL REFERENCES `v2_capture_bundles`(`id`),
  `title` text NOT NULL,
  `title_source` text NOT NULL CHECK (`title_source` IN ('user','ai_generated','imported','fallback')),
  `body_markdown` text NOT NULL,
  `current_revision_id` text NOT NULL,
  `current_version` integer DEFAULT 1 NOT NULL CHECK (`current_version` >= 1),
  `analyzed_revision_id` text,
  `written_at` text,
  `document_status` text DEFAULT 'inbox' NOT NULL CHECK (`document_status` IN ('inbox','draft','revising','finished','archived')),
  `summary` text,
  `privacy_level` text DEFAULT 'normal' NOT NULL CHECK (`privacy_level` IN ('normal','sensitive','restricted')),
  `user_locked_fields` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_document_capture` ON `v2_documents` (`capture_id`);
--> statement-breakpoint

CREATE TABLE `v2_document_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `document_object_id` text NOT NULL REFERENCES `v2_objects`(`id`) ON DELETE cascade,
  `parent_revision_id` text,
  `body_markdown` text NOT NULL,
  `content_hash` text NOT NULL,
  `author_kind` text NOT NULL CHECK (`author_kind` IN ('user','ai_accepted','import')),
  `change_reason` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_revision_document_hash` ON `v2_document_revisions` (`document_object_id`,`content_hash`);
--> statement-breakpoint
CREATE INDEX `idx_v2_revision_document_time` ON `v2_document_revisions` (`document_object_id`,`created_at`);
--> statement-breakpoint

CREATE TABLE `v2_document_source_links` (
  `document_object_id` text NOT NULL REFERENCES `v2_objects`(`id`) ON DELETE cascade,
  `source_item_id` text NOT NULL REFERENCES `v2_source_items`(`id`) ON DELETE cascade,
  `role` text NOT NULL CHECK (`role` IN ('primary_text','evidence','quotation','illustration','identifier')),
  `source_order` integer NOT NULL,
  `extraction_run_id` text,
  `created_at` text NOT NULL,
  PRIMARY KEY (`document_object_id`,`source_item_id`)
);
--> statement-breakpoint

CREATE TABLE `v2_deletion_tombstones` (
  `object_id` text PRIMARY KEY NOT NULL REFERENCES `v2_objects`(`id`) ON DELETE cascade,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `deleted_at` text NOT NULL,
  `purge_after` text NOT NULL,
  `restored_at` text,
  `reason` text DEFAULT 'user_request' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_v2_tombstone_user_purge` ON `v2_deletion_tombstones` (`user_id`,`purge_after`);
--> statement-breakpoint

CREATE TABLE `v2_audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `action` text NOT NULL,
  `object_kind` text NOT NULL,
  `object_id` text NOT NULL,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_v2_audit_user_time` ON `v2_audit_events` (`user_id`,`created_at`);
