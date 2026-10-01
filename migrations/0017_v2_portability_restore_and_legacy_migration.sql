CREATE TABLE `v2_change_events` (
  `sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `aggregate_kind` text NOT NULL,
  `aggregate_id` text NOT NULL,
  `revision_or_version` text,
  `operation` text NOT NULL,
  `content_hash` text,
  `occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_v2_change_user_sequence` ON `v2_change_events` (`user_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `idx_v2_change_user_aggregate` ON `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`sequence`);
--> statement-breakpoint
CREATE TABLE `v2_export_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `idempotency_key` text NOT NULL,
  `profile` text NOT NULL,
  `scope_json` text NOT NULL,
  `scope_hash` text NOT NULL,
  `status` text NOT NULL DEFAULT 'queued',
  `base_sequence` integer NOT NULL DEFAULT 0,
  `end_sequence` integer NOT NULL DEFAULT 0,
  `bundle_object_key` text,
  `bundle_sha256` text,
  `bundle_size_bytes` integer,
  `manifest_json` text,
  `failure_code` text,
  `created_at` text NOT NULL,
  `started_at` text,
  `finished_at` text,
  `expires_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_export_user_idempotency` ON `v2_export_jobs` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_v2_export_user_status_time` ON `v2_export_jobs` (`user_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `v2_backup_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `snapshot_kind` text NOT NULL,
  `status` text NOT NULL DEFAULT 'building',
  `base_snapshot_id` text,
  `base_sequence` integer NOT NULL DEFAULT 0,
  `end_sequence` integer NOT NULL,
  `manifest_object_key` text,
  `manifest_root_hash` text,
  `referenced_blob_count` integer NOT NULL DEFAULT 0,
  `referenced_blob_bytes` integer NOT NULL DEFAULT 0,
  `retention_class` text NOT NULL DEFAULT 'manual',
  `pinned` integer NOT NULL DEFAULT 0,
  `validator_json` text,
  `created_at` text NOT NULL,
  `verified_at` text,
  `expires_at` text,
  `pruned_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_v2_backup_user_kind_time` ON `v2_backup_snapshots` (`user_id`,`snapshot_kind`,`created_at`);
--> statement-breakpoint
CREATE TABLE `v2_backup_blob_refs` (
  `snapshot_id` text NOT NULL REFERENCES `v2_backup_snapshots`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `sha256` text NOT NULL,
  `object_key` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `media_type` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`snapshot_id`,`sha256`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_backup_blob_ref_user_hash` ON `v2_backup_blob_refs` (`user_id`,`sha256`,`snapshot_id`);
--> statement-breakpoint
CREATE TABLE `v2_backup_blob_gc_marks` (
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `sha256` text NOT NULL,
  `object_key` text NOT NULL,
  `unreferenced_since` text NOT NULL,
  `last_checked_at` text NOT NULL,
  `deleted_at` text,
  PRIMARY KEY (`user_id`,`sha256`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_backup_blob_gc_due` ON `v2_backup_blob_gc_marks` (`user_id`,`deleted_at`,`unreferenced_since`);
--> statement-breakpoint
CREATE TABLE `v2_restore_batches` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `idempotency_key` text NOT NULL,
  `archive_sha256` text NOT NULL,
  `manifest_root_hash` text NOT NULL,
  `dry_run_hash` text NOT NULL,
  `status` text NOT NULL DEFAULT 'verified',
  `summary_json` text NOT NULL,
  `collision_map_json` text NOT NULL DEFAULT '{}',
  `created_at` text NOT NULL,
  `approved_at` text,
  `started_at` text,
  `finished_at` text,
  `rolled_back_at` text,
  `failure_code` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_restore_user_idempotency` ON `v2_restore_batches` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_v2_restore_user_status_time` ON `v2_restore_batches` (`user_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `v2_restore_rows` (
  `restore_batch_id` text NOT NULL REFERENCES `v2_restore_batches`(`id`) ON DELETE CASCADE,
  `table_name` text NOT NULL,
  `row_key` text NOT NULL,
  `source_row_hash` text NOT NULL,
  `disposition` text NOT NULL,
  `restored_row_key` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`restore_batch_id`,`table_name`,`row_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_restore_rows_disposition` ON `v2_restore_rows` (`restore_batch_id`,`disposition`,`table_name`);
--> statement-breakpoint
CREATE TABLE `v2_legacy_source_envelopes` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `legacy_table` text NOT NULL,
  `legacy_id` text NOT NULL,
  `row_json` text NOT NULL,
  `row_hash` text NOT NULL,
  `captured_at` text NOT NULL,
  `schema_snapshot` text NOT NULL,
  `damage_codes_json` text NOT NULL DEFAULT '[]',
  `import_batch_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_legacy_envelope_source` ON `v2_legacy_source_envelopes` (`user_id`,`legacy_table`,`legacy_id`,`row_hash`);
--> statement-breakpoint
CREATE INDEX `idx_v2_legacy_envelope_batch` ON `v2_legacy_source_envelopes` (`user_id`,`import_batch_id`);
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_envelope_immutable` BEFORE UPDATE ON `v2_legacy_source_envelopes`
BEGIN SELECT RAISE(ABORT, 'legacy_source_envelope_is_immutable'); END;
--> statement-breakpoint
CREATE TABLE `v2_legacy_source_mappings` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `legacy_envelope_id` text NOT NULL REFERENCES `v2_legacy_source_envelopes`(`id`) ON DELETE CASCADE,
  `legacy_table` text NOT NULL,
  `legacy_id` text NOT NULL,
  `adapter_version` text NOT NULL,
  `source_item_id` text REFERENCES `v2_source_items`(`id`) ON DELETE SET NULL,
  `projected_object_id` text REFERENCES `v2_objects`(`id`) ON DELETE SET NULL,
  `projection_kind` text NOT NULL,
  `status` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_legacy_mapping_projection` ON `v2_legacy_source_mappings` (`user_id`,`legacy_table`,`legacy_id`,`adapter_version`,`projection_kind`);
--> statement-breakpoint
CREATE INDEX `idx_v2_legacy_mapping_batch_source` ON `v2_legacy_source_mappings` (`legacy_envelope_id`,`status`);
--> statement-breakpoint

CREATE TRIGGER `trg_v2_change_capture_insert` AFTER INSERT ON `v2_capture_bundles`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'capture_bundle',new.id,'1','upsert',new.content_hash,new.committed_at); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_source_insert` AFTER INSERT ON `v2_source_items`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'source_item',new.id,cast(new.immutability_version as text),'upsert',new.content_hash,new.created_at); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_attachment_insert` AFTER INSERT ON `v2_attachment_reservations`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'attachment',new.id,new.status,'upsert',new.sha256,new.created_at); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_attachment_update` AFTER UPDATE ON `v2_attachment_reservations`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'attachment',new.id,new.status,'upsert',new.sha256,coalesce(new.committed_at,new.verified_at,new.created_at)); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_source_attachment_link_insert` AFTER INSERT ON `v2_source_attachment_links`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'source_attachment_link',new.source_item_id || ':' || new.attachment_id,null,'upsert',null,new.created_at); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_revision_insert` AFTER INSERT ON `v2_document_revisions`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) SELECT user_id,'document_revision',new.id,cast(new.revision_number as text),'upsert',new.content_hash,new.created_at FROM `v2_objects` WHERE id=new.document_object_id; END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_document_insert` AFTER INSERT ON `v2_documents`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) SELECT o.user_id,'document',new.object_id,cast(new.current_version as text),'upsert',(SELECT content_hash FROM v2_document_revisions WHERE id=new.current_revision_id),o.updated_at FROM `v2_objects` o WHERE o.id=new.object_id; END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_document_update` AFTER UPDATE ON `v2_documents`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) SELECT o.user_id,'document',new.object_id,cast(new.current_version as text),'upsert',(SELECT content_hash FROM v2_document_revisions WHERE id=new.current_revision_id),o.updated_at FROM `v2_objects` o WHERE o.id=new.object_id; END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_object_tombstone` AFTER UPDATE OF `lifecycle_status` ON `v2_objects` WHEN new.lifecycle_status='deleted'
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,new.object_kind,new.id,null,'tombstone',null,new.updated_at); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_property_insert` AFTER INSERT ON `v2_property_values`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'property_value',new.id,new.review_status,'upsert',null,new.created_at); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_property_update` AFTER UPDATE ON `v2_property_values`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'property_value',new.id,new.review_status,'upsert',null,coalesce(new.superseded_at,new.confirmed_by_user_at,new.created_at)); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_relation_insert` AFTER INSERT ON `v2_relation_edges`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'relation',new.id,new.review_status,'upsert',null,new.created_at); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_relation_update` AFTER UPDATE ON `v2_relation_edges`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'relation',new.id,new.review_status,'upsert',null,coalesce(new.superseded_at,new.created_at)); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_template_insert` AFTER INSERT ON `v2_capture_templates`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'capture_template',new.id,new.current_version_id,'upsert',null,new.created_at); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_template_update` AFTER UPDATE ON `v2_capture_templates`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'capture_template',new.id,new.current_version_id,'upsert',null,new.updated_at); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_saved_view_insert` AFTER INSERT ON `v2_saved_views`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'saved_view',new.id,new.view_key,'upsert',null,new.created_at); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_saved_view_update` AFTER UPDATE ON `v2_saved_views`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'saved_view',new.id,new.view_key,'upsert',null,new.updated_at); END;
