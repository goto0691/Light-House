ALTER TABLE `v2_legacy_migration_batch_items` ADD COLUMN `projection_hash` text;
--> statement-breakpoint
ALTER TABLE `v2_legacy_migration_batch_items` ADD COLUMN `projections_json` text;
--> statement-breakpoint
UPDATE `v2_legacy_migration_batch_items`
SET
  `projection_hash` = (
    SELECT json_extract(`entry`.`value`, '$.projectionHash')
    FROM `v2_legacy_migration_batches` `batch`, json_each(`batch`.`manifest_json`) `entry`
    WHERE `batch`.`id` = `v2_legacy_migration_batch_items`.`batch_id`
      AND cast(`entry`.`key` AS integer) = `v2_legacy_migration_batch_items`.`position`
  ),
  `projections_json` = (
    SELECT json_extract(`entry`.`value`, '$.projections')
    FROM `v2_legacy_migration_batches` `batch`, json_each(`batch`.`manifest_json`) `entry`
    WHERE `batch`.`id` = `v2_legacy_migration_batch_items`.`batch_id`
      AND cast(`entry`.`key` AS integer) = `v2_legacy_migration_batch_items`.`position`
  );
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_batch_resumable_manifest_guard` BEFORE UPDATE OF `status` ON `v2_legacy_migration_batches`
WHEN new.status='succeeded'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `v2_legacy_migration_batch_items` `item`
    WHERE `item`.`batch_id`=new.id
      AND `item`.`user_id`=new.user_id
      AND (
        `item`.`projection_hash` IS NULL
        OR length(`item`.`projection_hash`)<>64
        OR `item`.`projection_hash` GLOB '*[^0-9a-f]*'
        OR `item`.`projections_json` IS NULL
        OR json_valid(`item`.`projections_json`)<>1
        OR json_type(`item`.`projections_json`)<>'array'
      )
  ) THEN RAISE(ABORT, 'legacy_resumable_manifest_incomplete') END;
END;
--> statement-breakpoint
CREATE TABLE `v2_legacy_preservation_gates` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `target_batch_id` text NOT NULL,
  `target_table` text NOT NULL,
  `target_adapter_version` text NOT NULL,
  `target_dry_run_hash` text NOT NULL,
  `basis_hash` text NOT NULL,
  `required_tables_json` text NOT NULL,
  `next_table_position` integer NOT NULL DEFAULT 0,
  `next_row_offset` integer NOT NULL DEFAULT 0,
  `checked_rows` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'checking',
  `state_revision` integer NOT NULL DEFAULT 0,
  `lease_token` text,
  `lease_expires_at` text,
  `failure_code` text,
  `failure_detail` text,
  `created_at` text NOT NULL,
  `last_progress_at` text NOT NULL,
  `finished_at` text,
  CONSTRAINT `ck_v2_legacy_gate_status` CHECK (`status` IN ('checking','passed','failed')),
  CONSTRAINT `ck_v2_legacy_gate_hashes` CHECK (
    length(`target_dry_run_hash`)=64
    AND `target_dry_run_hash` NOT GLOB '*[^0-9a-f]*'
    AND length(`basis_hash`)=64
    AND `basis_hash` NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT `ck_v2_legacy_gate_cursor` CHECK (`next_table_position`>=0 AND `next_row_offset`>=0 AND `checked_rows`>=0),
  CONSTRAINT `ck_v2_legacy_gate_tables` CHECK (json_valid(`required_tables_json`)=1 AND json_type(`required_tables_json`)='array'),
  CONSTRAINT `ck_v2_legacy_gate_failure` CHECK (`status`<>'failed' OR `failure_code` IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_legacy_gate_target_batch` ON `v2_legacy_preservation_gates` (`user_id`,`target_batch_id`);
--> statement-breakpoint
CREATE INDEX `idx_v2_legacy_gate_resume` ON `v2_legacy_preservation_gates` (`user_id`,`status`,`lease_expires_at`,`last_progress_at`);
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_gate_passed_guard` BEFORE UPDATE OF `status` ON `v2_legacy_preservation_gates`
WHEN new.status='passed'
BEGIN
  SELECT CASE WHEN
    new.failure_code IS NOT NULL
    OR new.failure_detail IS NOT NULL
    OR new.next_table_position<>json_array_length(new.required_tables_json)
    OR new.next_row_offset<>0
    OR new.checked_rows<>(
      SELECT coalesce(sum(cast(json_extract(`entry`.`value`,'$.inputRows') AS integer)),0)
      FROM json_each(new.required_tables_json) `entry`
    )
  THEN RAISE(ABORT, 'legacy_preservation_gate_incomplete') END;
END;
