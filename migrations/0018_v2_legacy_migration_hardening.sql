DROP INDEX `uq_v2_legacy_envelope_source`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_legacy_envelope_source` ON `v2_legacy_source_envelopes` (`user_id`,`legacy_table`,`legacy_id`,`row_hash`,`schema_snapshot`);
--> statement-breakpoint
DROP INDEX `uq_v2_legacy_mapping_projection`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_legacy_mapping_projection` ON `v2_legacy_source_mappings` (`user_id`,`legacy_envelope_id`,`adapter_version`,`projection_kind`);
--> statement-breakpoint
ALTER TABLE `v2_legacy_source_mappings` ADD COLUMN `superseded_at` text;
--> statement-breakpoint
ALTER TABLE `v2_legacy_source_mappings` ADD COLUMN `superseded_by_mapping_id` text;
--> statement-breakpoint
ALTER TABLE `v2_legacy_source_mappings` ADD COLUMN `target_lifecycle_status` text;
--> statement-breakpoint
ALTER TABLE `v2_legacy_source_mappings` ADD COLUMN `activation_batch_id` text;
--> statement-breakpoint
CREATE INDEX `idx_v2_legacy_mapping_current_projection` ON `v2_legacy_source_mappings` (`user_id`,`legacy_table`,`legacy_id`,`adapter_version`,`projection_kind`,`status`);
--> statement-breakpoint
CREATE TABLE `v2_legacy_migration_batches` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `legacy_table` text NOT NULL,
  `adapter_version` text NOT NULL,
  `mode` text NOT NULL,
  `dry_run_hash` text NOT NULL,
  `schema_snapshot` text NOT NULL,
  `manifest_json` text NOT NULL,
  `input_rows` integer NOT NULL,
  `expected_mapping_count` integer NOT NULL,
  `next_offset` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'approved',
  `reconciliation_status` text NOT NULL DEFAULT 'pending',
  `reconciliation_json` text,
  `summary_json` text NOT NULL,
  `failure_code` text,
  `created_at` text NOT NULL,
  `approved_at` text NOT NULL,
  `started_at` text,
  `finished_at` text,
  `reconciled_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_v2_legacy_batch_user_status` ON `v2_legacy_migration_batches` (`user_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `v2_legacy_migration_batch_items` (
  `batch_id` text NOT NULL REFERENCES `v2_legacy_migration_batches`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `position` integer NOT NULL,
  `legacy_envelope_id` text NOT NULL REFERENCES `v2_legacy_source_envelopes`(`id`) ON DELETE CASCADE,
  `legacy_id` text NOT NULL,
  `row_hash` text NOT NULL,
  `expected_mapping_count` integer NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `processed_at` text,
  PRIMARY KEY (`batch_id`,`position`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_legacy_batch_item_envelope` ON `v2_legacy_migration_batch_items` (`batch_id`,`legacy_envelope_id`);
--> statement-breakpoint
CREATE INDEX `idx_v2_legacy_batch_item_status` ON `v2_legacy_migration_batch_items` (`user_id`,`batch_id`,`status`,`position`);
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_batch_succeeded_guard` BEFORE UPDATE OF `status` ON `v2_legacy_migration_batches`
WHEN new.status='succeeded'
BEGIN
  SELECT CASE WHEN new.reconciliation_status<>'passed' OR new.reconciliation_json IS NULL OR new.reconciled_at IS NULL THEN RAISE(ABORT, 'legacy_reconciliation_receipt_missing') END;
  SELECT CASE WHEN new.mode='knowledge' AND json_valid(new.reconciliation_json)=1 AND (coalesce(json_extract(new.reconciliation_json,'$.knowledge_pending_count'),-1)<>0 OR EXISTS (SELECT 1 FROM v2_legacy_source_mappings m JOIN v2_legacy_migration_batch_items i ON i.legacy_envelope_id=m.legacy_envelope_id AND i.user_id=m.user_id WHERE i.batch_id=new.id AND i.user_id=new.user_id AND m.adapter_version=new.adapter_version AND m.status='knowledge_pending')) THEN RAISE(ABORT, 'legacy_knowledge_pending_not_zero') END;
  SELECT CASE WHEN json_valid(new.reconciliation_json)<>1 OR coalesce(json_extract(new.reconciliation_json,'$.batch_status'),'')<>'succeeded' OR coalesce(json_extract(new.reconciliation_json,'$.complete'),0)<>1 OR coalesce(json_extract(new.reconciliation_json,'$.knowledge_pending_count'),-1)<>(SELECT count(*) FROM v2_legacy_source_mappings m JOIN v2_legacy_migration_batch_items i ON i.legacy_envelope_id=m.legacy_envelope_id AND i.user_id=m.user_id WHERE i.batch_id=new.id AND i.user_id=new.user_id AND m.adapter_version=new.adapter_version AND m.status='knowledge_pending') THEN RAISE(ABORT, 'legacy_reconciliation_receipt_invalid') END;
  SELECT CASE WHEN new.next_offset<>new.input_rows THEN RAISE(ABORT, 'legacy_batch_offset_incomplete') END;
  SELECT CASE WHEN (SELECT count(*) FROM v2_legacy_migration_batch_items i WHERE i.batch_id=new.id AND i.user_id=new.user_id AND i.status='succeeded')<>new.input_rows THEN RAISE(ABORT, 'legacy_batch_items_incomplete') END;
  SELECT CASE WHEN (SELECT count(*) FROM v2_legacy_source_mappings m JOIN v2_legacy_migration_batch_items i ON i.legacy_envelope_id=m.legacy_envelope_id AND i.user_id=m.user_id WHERE i.batch_id=new.id AND i.user_id=new.user_id AND m.adapter_version=new.adapter_version)<>new.expected_mapping_count THEN RAISE(ABORT, 'legacy_batch_mappings_incomplete') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM v2_legacy_source_mappings m JOIN v2_legacy_migration_batch_items i ON i.legacy_envelope_id=m.legacy_envelope_id AND i.user_id=m.user_id WHERE i.batch_id=new.id AND i.user_id=new.user_id AND m.adapter_version=new.adapter_version AND ((m.projection_kind='archived_only' AND (m.status<>'archived' OR m.source_item_id IS NOT NULL OR m.projected_object_id IS NOT NULL)) OR (m.projection_kind<>'archived_only' AND (m.source_item_id IS NULL OR m.projected_object_id IS NULL OR (new.mode='knowledge' AND m.status<>'projected') OR (new.mode<>'knowledge' AND m.status NOT IN ('source_only','knowledge_pending','projected','superseded')))))) THEN RAISE(ABORT, 'legacy_batch_mapping_dependency_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_legacy_envelope_insert` AFTER INSERT ON `v2_legacy_source_envelopes`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'legacy_envelope',new.id,new.schema_snapshot,'upsert',new.row_hash,new.captured_at); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_legacy_mapping_insert` AFTER INSERT ON `v2_legacy_source_mappings`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'legacy_mapping',new.id,new.status,'upsert',null,new.created_at); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_legacy_mapping_update` AFTER UPDATE ON `v2_legacy_source_mappings`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'legacy_mapping',new.id,new.status,'upsert',null,coalesce(new.superseded_at,new.created_at)); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_legacy_batch_insert` AFTER INSERT ON `v2_legacy_migration_batches`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'legacy_migration_batch',new.id,new.status,'upsert',new.dry_run_hash,new.created_at); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_legacy_batch_update` AFTER UPDATE ON `v2_legacy_migration_batches`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) VALUES (new.user_id,'legacy_migration_batch',new.id,new.status,'upsert',new.dry_run_hash,coalesce(new.finished_at,new.started_at,new.approved_at,new.created_at)); END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_legacy_batch_item_insert` AFTER INSERT ON `v2_legacy_migration_batch_items`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) SELECT new.user_id,'legacy_migration_batch_item',new.batch_id || ':' || cast(new.position as text),new.status,'upsert',new.row_hash,b.created_at FROM `v2_legacy_migration_batches` b WHERE b.id=new.batch_id; END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_legacy_batch_item_update` AFTER UPDATE ON `v2_legacy_migration_batch_items`
BEGIN INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`) SELECT new.user_id,'legacy_migration_batch_item',new.batch_id || ':' || cast(new.position as text),new.status,'upsert',new.row_hash,coalesce(new.processed_at,b.started_at,b.created_at) FROM `v2_legacy_migration_batches` b WHERE b.id=new.batch_id; END;
