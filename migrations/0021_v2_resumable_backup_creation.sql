ALTER TABLE `v2_backup_snapshots` ADD COLUMN `workflow_version` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `v2_backup_snapshots` ADD COLUMN `idempotency_key` text;
--> statement-breakpoint
ALTER TABLE `v2_backup_snapshots` ADD COLUMN `build_phase` text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE `v2_backup_snapshots` ADD COLUMN `cursor_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE `v2_backup_snapshots` ADD COLUMN `state_revision` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `v2_backup_snapshots` ADD COLUMN `failure_code` text;
--> statement-breakpoint
ALTER TABLE `v2_backup_snapshots` ADD COLUMN `last_progress_at` text;
--> statement-breakpoint
ALTER TABLE `v2_backup_snapshots` ADD COLUMN `lease_token` text;
--> statement-breakpoint
ALTER TABLE `v2_backup_snapshots` ADD COLUMN `lease_expires_at` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_backup_user_idempotency` ON `v2_backup_snapshots` (`user_id`,`idempotency_key`) WHERE `idempotency_key` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_v2_backup_resume` ON `v2_backup_snapshots` (`user_id`,`status`,`build_phase`,`last_progress_at`);
--> statement-breakpoint

CREATE TABLE `v2_backup_metadata_files` (
  `snapshot_id` text NOT NULL REFERENCES `v2_backup_snapshots`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `table_name` text NOT NULL,
  `base_path` text NOT NULL,
  `part_number` integer NOT NULL,
  `path` text NOT NULL,
  `object_key` text NOT NULL,
  `metadata_mode` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `sha256` text NOT NULL,
  `record_count` integer NOT NULL,
  `status` text NOT NULL DEFAULT 'uploaded',
  `created_at` text NOT NULL,
  `verified_at` text,
  PRIMARY KEY (`snapshot_id`,`path`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_backup_metadata_resume` ON `v2_backup_metadata_files` (`snapshot_id`,`status`,`base_path`,`part_number`);
--> statement-breakpoint

CREATE TABLE `v2_backup_blob_work_items` (
  `snapshot_id` text NOT NULL REFERENCES `v2_backup_snapshots`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `sha256` text NOT NULL,
  `source_object_key` text NOT NULL,
  `object_key` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `media_type` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `upload_id` text,
  `next_offset` integer NOT NULL DEFAULT 0,
  `next_part_number` integer NOT NULL DEFAULT 1,
  `parts_json` text NOT NULL DEFAULT '[]',
  `created_at` text NOT NULL,
  `verified_at` text,
  PRIMARY KEY (`snapshot_id`,`sha256`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_backup_blob_work_resume` ON `v2_backup_blob_work_items` (`snapshot_id`,`status`,`sha256`);
--> statement-breakpoint

CREATE TABLE `v2_backup_blob_members` (
  `snapshot_id` text NOT NULL REFERENCES `v2_backup_snapshots`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `sha256` text NOT NULL,
  `attachment_id` text NOT NULL,
  PRIMARY KEY (`snapshot_id`,`sha256`,`attachment_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_backup_blob_members_hash` ON `v2_backup_blob_members` (`snapshot_id`,`sha256`,`attachment_id`);
--> statement-breakpoint

CREATE TRIGGER `trg_v2_backup_workflow_integrity_insert` BEFORE INSERT ON `v2_backup_snapshots`
WHEN new.workflow_version>=2
BEGIN
  SELECT CASE WHEN json_valid(new.cursor_json)<>1 OR new.state_revision<0 THEN RAISE(ABORT, 'backup_workflow_cursor_invalid') END;
  SELECT CASE WHEN (new.lease_token IS NULL)<>(new.lease_expires_at IS NULL) THEN RAISE(ABORT, 'backup_workflow_lease_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_workflow_integrity_update` BEFORE UPDATE ON `v2_backup_snapshots`
WHEN new.workflow_version>=2
BEGIN
  SELECT CASE WHEN json_valid(new.cursor_json)<>1 OR new.state_revision<0 THEN RAISE(ABORT, 'backup_workflow_cursor_invalid') END;
  SELECT CASE WHEN (new.lease_token IS NULL)<>(new.lease_expires_at IS NULL) THEN RAISE(ABORT, 'backup_workflow_lease_invalid') END;
END;
--> statement-breakpoint

CREATE TRIGGER `trg_v2_backup_metadata_user_guard` BEFORE INSERT ON `v2_backup_metadata_files`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_backup_snapshots s WHERE s.id=new.snapshot_id AND s.user_id=new.user_id) THEN RAISE(ABORT, 'backup_metadata_user_mismatch') END;
  SELECT CASE WHEN new.part_number<0 OR new.size_bytes<0 OR new.record_count<0 OR new.metadata_mode NOT IN ('full','delta') THEN RAISE(ABORT, 'backup_metadata_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_blob_work_user_guard` BEFORE INSERT ON `v2_backup_blob_work_items`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_backup_snapshots s WHERE s.id=new.snapshot_id AND s.user_id=new.user_id) THEN RAISE(ABORT, 'backup_blob_work_user_mismatch') END;
  SELECT CASE WHEN new.size_bytes<0 OR new.next_offset<0 OR new.next_offset>new.size_bytes OR new.next_part_number<1 OR json_valid(new.parts_json)<>1 THEN RAISE(ABORT, 'backup_blob_work_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_blob_member_user_guard` BEFORE INSERT ON `v2_backup_blob_members`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_backup_snapshots s WHERE s.id=new.snapshot_id AND s.user_id=new.user_id) THEN RAISE(ABORT, 'backup_blob_member_user_mismatch') END;
END;
