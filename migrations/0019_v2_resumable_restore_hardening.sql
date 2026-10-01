ALTER TABLE `v2_restore_batches` ADD COLUMN `workflow_version` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `v2_restore_batches` ADD COLUMN `source_kind` text NOT NULL DEFAULT 'legacy_inline';
--> statement-breakpoint
ALTER TABLE `v2_restore_batches` ADD COLUMN `source_ref` text;
--> statement-breakpoint
ALTER TABLE `v2_restore_batches` ADD COLUMN `source_object_key` text;
--> statement-breakpoint
ALTER TABLE `v2_restore_batches` ADD COLUMN `source_size_bytes` integer;
--> statement-breakpoint
ALTER TABLE `v2_restore_batches` ADD COLUMN `cursor_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE `v2_restore_batches` ADD COLUMN `plan_chain_hash` text;
--> statement-breakpoint
ALTER TABLE `v2_restore_batches` ADD COLUMN `planned_row_count` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `v2_restore_batches` ADD COLUMN `applied_row_count` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `v2_restore_batches` ADD COLUMN `rollback_conflict_count` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `v2_restore_batches` ADD COLUMN `state_revision` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `v2_restore_batches` ADD COLUMN `lease_token` text;
--> statement-breakpoint
ALTER TABLE `v2_restore_batches` ADD COLUMN `lease_expires_at` text;
--> statement-breakpoint
ALTER TABLE `v2_restore_batches` ADD COLUMN `last_progress_at` text;
--> statement-breakpoint
CREATE INDEX `idx_v2_restore_resume` ON `v2_restore_batches` (`user_id`,`status`,`lease_expires_at`,`last_progress_at`);
--> statement-breakpoint
CREATE INDEX `idx_v2_restore_source` ON `v2_restore_batches` (`user_id`,`source_kind`,`source_ref`);
--> statement-breakpoint

ALTER TABLE `v2_restore_rows` ADD COLUMN `source_row_json` text;
--> statement-breakpoint
ALTER TABLE `v2_restore_rows` ADD COLUMN `candidate_row_json` text;
--> statement-breakpoint
ALTER TABLE `v2_restore_rows` ADD COLUMN `restored_row_hash` text;
--> statement-breakpoint
ALTER TABLE `v2_restore_rows` ADD COLUMN `target_row_hash` text;
--> statement-breakpoint
ALTER TABLE `v2_restore_rows` ADD COLUMN `plan_position` integer;
--> statement-breakpoint
ALTER TABLE `v2_restore_rows` ADD COLUMN `apply_sequence` integer;
--> statement-breakpoint
ALTER TABLE `v2_restore_rows` ADD COLUMN `apply_status` text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE `v2_restore_rows` ADD COLUMN `rollback_status` text NOT NULL DEFAULT 'not_applicable';
--> statement-breakpoint
ALTER TABLE `v2_restore_rows` ADD COLUMN `observed_row_hash` text;
--> statement-breakpoint
ALTER TABLE `v2_restore_rows` ADD COLUMN `r2_object_key` text;
--> statement-breakpoint
ALTER TABLE `v2_restore_rows` ADD COLUMN `r2_sha256` text;
--> statement-breakpoint
ALTER TABLE `v2_restore_rows` ADD COLUMN `r2_size_bytes` integer;
--> statement-breakpoint
ALTER TABLE `v2_restore_rows` ADD COLUMN `r2_status` text NOT NULL DEFAULT 'not_applicable';
--> statement-breakpoint
ALTER TABLE `v2_restore_rows` ADD COLUMN `updated_at` text;
--> statement-breakpoint
CREATE INDEX `idx_v2_restore_rows_apply` ON `v2_restore_rows` (`restore_batch_id`,`apply_status`,`plan_position`);
--> statement-breakpoint
CREATE INDEX `idx_v2_restore_rows_rollback` ON `v2_restore_rows` (`restore_batch_id`,`rollback_status`,`apply_sequence`);
--> statement-breakpoint
CREATE INDEX `idx_v2_restore_rows_r2` ON `v2_restore_rows` (`restore_batch_id`,`r2_status`,`plan_position`);
--> statement-breakpoint

CREATE TABLE `v2_restore_files` (
  `restore_batch_id` text NOT NULL REFERENCES `v2_restore_batches`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `file_id` text NOT NULL,
  `ordinal` integer NOT NULL,
  `kind` text NOT NULL,
  `table_name` text,
  `path` text NOT NULL,
  `source_object_key` text NOT NULL,
  `data_offset` integer NOT NULL DEFAULT 0,
  `byte_length` integer NOT NULL,
  `expected_sha256` text,
  `expected_crc32` integer,
  `expected_records` integer NOT NULL DEFAULT 0,
  `schema_version` text,
  `source_scope_id` text,
  `layer_ordinal` integer,
  `metadata_mode` text,
  `status` text NOT NULL DEFAULT 'indexed',
  `next_byte_offset` integer NOT NULL DEFAULT 0,
  `next_record` integer NOT NULL DEFAULT 0,
  `verified_at` text,
  `consumed_at` text,
  `failure_code` text,
  PRIMARY KEY (`restore_batch_id`,`file_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_restore_files_status` ON `v2_restore_files` (`restore_batch_id`,`status`,`ordinal`);
--> statement-breakpoint

CREATE TABLE `v2_restore_id_mappings` (
  `restore_batch_id` text NOT NULL REFERENCES `v2_restore_batches`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `table_name` text NOT NULL,
  `source_id` text NOT NULL,
  `target_id` text NOT NULL,
  `disposition` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`restore_batch_id`,`table_name`,`source_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_restore_id_mapping_target` ON `v2_restore_id_mappings` (`restore_batch_id`,`table_name`,`target_id`);
--> statement-breakpoint

CREATE TRIGGER `trg_v2_restore_batch_v2_integrity_insert` BEFORE INSERT ON `v2_restore_batches`
WHEN new.workflow_version>=2
BEGIN
  SELECT CASE WHEN new.source_kind='' OR json_valid(new.cursor_json)<>1 THEN RAISE(ABORT, 'restore_cursor_invalid') END;
  SELECT CASE WHEN new.source_size_bytes IS NOT NULL AND new.source_size_bytes<0 THEN RAISE(ABORT, 'restore_source_size_invalid') END;
  SELECT CASE WHEN new.planned_row_count<0 OR new.applied_row_count<0 OR new.applied_row_count>new.planned_row_count OR new.rollback_conflict_count<0 OR new.state_revision<0 THEN RAISE(ABORT, 'restore_progress_invalid') END;
  SELECT CASE WHEN (new.lease_token IS NULL)<>(new.lease_expires_at IS NULL) THEN RAISE(ABORT, 'restore_lease_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_restore_batch_v2_integrity_update` BEFORE UPDATE ON `v2_restore_batches`
WHEN new.workflow_version>=2
BEGIN
  SELECT CASE WHEN new.source_kind='' OR json_valid(new.cursor_json)<>1 THEN RAISE(ABORT, 'restore_cursor_invalid') END;
  SELECT CASE WHEN new.source_size_bytes IS NOT NULL AND new.source_size_bytes<0 THEN RAISE(ABORT, 'restore_source_size_invalid') END;
  SELECT CASE WHEN new.planned_row_count<0 OR new.applied_row_count<0 OR new.applied_row_count>new.planned_row_count OR new.rollback_conflict_count<0 OR new.state_revision<0 THEN RAISE(ABORT, 'restore_progress_invalid') END;
  SELECT CASE WHEN (new.lease_token IS NULL)<>(new.lease_expires_at IS NULL) THEN RAISE(ABORT, 'restore_lease_invalid') END;
END;
--> statement-breakpoint

CREATE TRIGGER `trg_v2_restore_batch_v2_succeeded_insert` BEFORE INSERT ON `v2_restore_batches`
WHEN new.workflow_version>=2 AND new.status='succeeded'
BEGIN
  SELECT CASE WHEN new.plan_chain_hash IS NULL OR length(new.plan_chain_hash)<>64 OR new.plan_chain_hash GLOB '*[^0-9a-f]*' THEN RAISE(ABORT, 'restore_plan_hash_missing') END;
  SELECT CASE WHEN new.planned_row_count<>0 OR new.applied_row_count<>0 THEN RAISE(ABORT, 'restore_rows_not_fully_applied') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_restore_batch_v2_succeeded_update` BEFORE UPDATE ON `v2_restore_batches`
WHEN new.workflow_version>=2 AND new.status='succeeded'
BEGIN
  SELECT CASE WHEN new.plan_chain_hash IS NULL OR length(new.plan_chain_hash)<>64 OR new.plan_chain_hash GLOB '*[^0-9a-f]*' THEN RAISE(ABORT, 'restore_plan_hash_missing') END;
  SELECT CASE WHEN new.planned_row_count<>new.applied_row_count OR new.planned_row_count<>(SELECT count(*) FROM v2_restore_rows r WHERE r.restore_batch_id=new.id) OR new.applied_row_count<>(SELECT count(*) FROM v2_restore_rows r WHERE r.restore_batch_id=new.id AND r.apply_status IN ('applied','reused')) THEN RAISE(ABORT, 'restore_rows_not_fully_applied') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM v2_restore_rows r WHERE r.restore_batch_id=new.id AND (r.apply_status NOT IN ('applied','reused') OR r.source_row_json IS NULL OR json_valid(r.source_row_json)<>1 OR r.candidate_row_json IS NULL OR json_valid(r.candidate_row_json)<>1 OR r.source_row_hash IS NULL OR length(r.source_row_hash)<>64 OR r.source_row_hash GLOB '*[^0-9a-f]*' OR r.restored_row_hash IS NULL OR length(r.restored_row_hash)<>64 OR r.restored_row_hash GLOB '*[^0-9a-f]*' OR r.target_row_hash IS NULL OR length(r.target_row_hash)<>64 OR r.target_row_hash GLOB '*[^0-9a-f]*' OR r.r2_status NOT IN ('not_applicable','committed','reused') OR (r.r2_status IN ('committed','reused') AND (r.r2_object_key IS NULL OR r.r2_sha256 IS NULL OR length(r.r2_sha256)<>64 OR r.r2_sha256 GLOB '*[^0-9a-f]*' OR r.r2_size_bytes IS NULL OR r.r2_size_bytes<0)))) THEN RAISE(ABORT, 'restore_row_receipt_incomplete') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM v2_restore_files f WHERE f.restore_batch_id=new.id AND (f.status<>'consumed' OR f.next_byte_offset<>f.byte_length OR f.next_record<>f.expected_records OR f.verified_at IS NULL OR f.consumed_at IS NULL OR (f.expected_sha256 IS NULL AND f.expected_crc32 IS NULL) OR (f.expected_sha256 IS NOT NULL AND (length(f.expected_sha256)<>64 OR f.expected_sha256 GLOB '*[^0-9a-f]*')))) THEN RAISE(ABORT, 'restore_files_not_fully_consumed') END;
END;
--> statement-breakpoint

CREATE TRIGGER `trg_v2_restore_batch_v2_rolled_back_insert` BEFORE INSERT ON `v2_restore_batches`
WHEN new.workflow_version>=2 AND new.status='rolled_back'
BEGIN
  SELECT CASE WHEN new.rollback_conflict_count<>0 THEN RAISE(ABORT, 'restore_rollback_conflicts_present') END;
  SELECT CASE WHEN new.planned_row_count<>0 OR new.applied_row_count<>0 THEN RAISE(ABORT, 'restore_owned_rows_not_rolled_back') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_restore_batch_v2_rolled_back_update` BEFORE UPDATE ON `v2_restore_batches`
WHEN new.workflow_version>=2 AND new.status='rolled_back'
BEGIN
  SELECT CASE WHEN new.rollback_conflict_count<>0 THEN RAISE(ABORT, 'restore_rollback_conflicts_present') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM v2_restore_rows r WHERE r.restore_batch_id=new.id AND r.disposition IN ('created','forked') AND r.apply_status='applied' AND r.rollback_status<>'rolled_back') THEN RAISE(ABORT, 'restore_owned_rows_not_rolled_back') END;
END;
--> statement-breakpoint

CREATE TRIGGER `trg_v2_restore_file_user_guard` BEFORE INSERT ON `v2_restore_files`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_restore_batches b WHERE b.id=new.restore_batch_id AND b.user_id=new.user_id) THEN RAISE(ABORT, 'restore_file_user_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_restore_id_mapping_user_guard` BEFORE INSERT ON `v2_restore_id_mappings`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_restore_batches b WHERE b.id=new.restore_batch_id AND b.user_id=new.user_id) THEN RAISE(ABORT, 'restore_id_mapping_user_mismatch') END;
END;
