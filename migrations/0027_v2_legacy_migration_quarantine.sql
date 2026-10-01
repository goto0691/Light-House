ALTER TABLE `v2_legacy_migration_batches` ADD COLUMN `state_revision` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `v2_legacy_migration_batches` ADD COLUMN `control_status` text NOT NULL DEFAULT 'paused';
--> statement-breakpoint
ALTER TABLE `v2_legacy_migration_batches` ADD COLUMN `quarantine_idempotency_key` text;
--> statement-breakpoint
ALTER TABLE `v2_legacy_migration_batches` ADD COLUMN `quarantine_reason` text;
--> statement-breakpoint
ALTER TABLE `v2_legacy_migration_batches` ADD COLUMN `quarantine_pre_status` text;
--> statement-breakpoint
ALTER TABLE `v2_legacy_migration_batches` ADD COLUMN `quarantine_pre_control_status` text;
--> statement-breakpoint
ALTER TABLE `v2_legacy_migration_batches` ADD COLUMN `quarantine_receipt_json` text;
--> statement-breakpoint
ALTER TABLE `v2_legacy_migration_batches` ADD COLUMN `quarantined_at` text;
--> statement-breakpoint
ALTER TABLE `v2_legacy_source_mappings` ADD COLUMN `superseded_from_status` text;
--> statement-breakpoint
UPDATE `v2_legacy_source_mappings`
SET `superseded_from_status`=CASE WHEN `activation_batch_id` IS NULL THEN 'source_only' ELSE 'projected' END
WHERE `status`='superseded' AND `superseded_from_status` IS NULL;
--> statement-breakpoint
CREATE INDEX `idx_v2_legacy_mapping_object_visibility`
ON `v2_legacy_source_mappings` (`user_id`,`projected_object_id`,`status`)
WHERE `projected_object_id` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `v2_legacy_quarantine_assertions` (
  `assertion_id` text PRIMARY KEY NOT NULL,
  `batch_id` text NOT NULL REFERENCES `v2_legacy_migration_batches`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `expected_revision` integer NOT NULL CHECK (`expected_revision`>=0),
  `expected_control_status` text NOT NULL CHECK (`expected_control_status` IN ('paused','active','complete')),
  `idempotency_key` text NOT NULL,
  `expected_item_count` integer NOT NULL CHECK (`expected_item_count`>=0),
  `expected_envelope_count` integer NOT NULL CHECK (`expected_envelope_count`>=0),
  `expected_mapping_count` integer NOT NULL CHECK (`expected_mapping_count`>=0),
  `expected_source_count` integer NOT NULL CHECK (`expected_source_count`>=0),
  `expected_prior_mapping_count` integer NOT NULL CHECK (`expected_prior_mapping_count`>=0),
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_quarantine_assertion_insert` BEFORE INSERT ON `v2_legacy_quarantine_assertions`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `v2_legacy_migration_batches` `batch`
    WHERE `batch`.`id`=new.batch_id
      AND `batch`.`user_id`=new.user_id
      AND `batch`.`state_revision`=new.expected_revision
      AND `batch`.`control_status`=new.expected_control_status
      AND `batch`.`quarantine_idempotency_key` IS NULL
  ) THEN RAISE(ABORT, 'legacy_quarantine_transition_lost') END;
  SELECT CASE WHEN new.expected_item_count<>(
    SELECT count(*) FROM `v2_legacy_migration_batch_items` `item`
    WHERE `item`.`batch_id`=new.batch_id AND `item`.`user_id`=new.user_id
  ) OR new.expected_envelope_count<>(
    SELECT count(DISTINCT `envelope`.`id`)
    FROM `v2_legacy_migration_batch_items` `item`
    JOIN `v2_legacy_source_envelopes` `envelope`
      ON `envelope`.`id`=`item`.`legacy_envelope_id` AND `envelope`.`user_id`=`item`.`user_id`
    WHERE `item`.`batch_id`=new.batch_id AND `item`.`user_id`=new.user_id
  ) OR new.expected_mapping_count<>(
    SELECT count(*)
    FROM `v2_legacy_source_mappings` `mapping`
    JOIN `v2_legacy_migration_batch_items` `item`
      ON `item`.`legacy_envelope_id`=`mapping`.`legacy_envelope_id` AND `item`.`user_id`=`mapping`.`user_id`
    JOIN `v2_legacy_migration_batches` `batch`
      ON `batch`.`id`=`item`.`batch_id` AND `batch`.`user_id`=`item`.`user_id`
    WHERE `item`.`batch_id`=new.batch_id AND `item`.`user_id`=new.user_id
      AND `mapping`.`adapter_version`=`batch`.`adapter_version`
  ) OR new.expected_source_count<>(
    SELECT count(DISTINCT `source`.`id`)
    FROM `v2_legacy_source_mappings` `mapping`
    JOIN `v2_legacy_migration_batch_items` `item`
      ON `item`.`legacy_envelope_id`=`mapping`.`legacy_envelope_id` AND `item`.`user_id`=`mapping`.`user_id`
    JOIN `v2_legacy_migration_batches` `batch`
      ON `batch`.`id`=`item`.`batch_id` AND `batch`.`user_id`=`item`.`user_id`
    JOIN `v2_source_items` `source`
      ON `source`.`id`=`mapping`.`source_item_id` AND `source`.`user_id`=`mapping`.`user_id`
    WHERE `item`.`batch_id`=new.batch_id AND `item`.`user_id`=new.user_id
      AND `mapping`.`adapter_version`=`batch`.`adapter_version`
  ) OR new.expected_prior_mapping_count<>(
    SELECT count(*)
    FROM `v2_legacy_source_mappings` `old_mapping`
    JOIN `v2_legacy_source_mappings` `current_mapping`
      ON `current_mapping`.`id`=`old_mapping`.`superseded_by_mapping_id`
     AND `current_mapping`.`user_id`=`old_mapping`.`user_id`
    JOIN `v2_legacy_migration_batch_items` `item`
      ON `item`.`legacy_envelope_id`=`current_mapping`.`legacy_envelope_id`
     AND `item`.`user_id`=`current_mapping`.`user_id`
    JOIN `v2_legacy_migration_batches` `batch`
      ON `batch`.`id`=`item`.`batch_id` AND `batch`.`user_id`=`item`.`user_id`
    WHERE `item`.`batch_id`=new.batch_id AND `item`.`user_id`=new.user_id
      AND `current_mapping`.`adapter_version`=`batch`.`adapter_version`
      AND `old_mapping`.`status`='superseded'
  ) THEN RAISE(ABORT, 'legacy_quarantine_source_provenance_changed') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_quarantine_assertion_delete` BEFORE DELETE ON `v2_legacy_quarantine_assertions`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `v2_legacy_migration_batches` `batch`
    WHERE `batch`.`id`=old.batch_id
      AND `batch`.`user_id`=old.user_id
      AND `batch`.`state_revision`=old.expected_revision+1
      AND `batch`.`control_status`='quarantined'
      AND `batch`.`quarantine_idempotency_key`=old.idempotency_key
  ) THEN RAISE(ABORT, 'legacy_quarantine_transition_not_committed') END;
  SELECT CASE WHEN old.expected_item_count<>(
    SELECT count(*) FROM `v2_legacy_migration_batch_items` `item`
    WHERE `item`.`batch_id`=old.batch_id AND `item`.`user_id`=old.user_id
  ) OR old.expected_envelope_count<>(
    SELECT count(DISTINCT `envelope`.`id`)
    FROM `v2_legacy_migration_batch_items` `item`
    JOIN `v2_legacy_source_envelopes` `envelope`
      ON `envelope`.`id`=`item`.`legacy_envelope_id` AND `envelope`.`user_id`=`item`.`user_id`
    WHERE `item`.`batch_id`=old.batch_id AND `item`.`user_id`=old.user_id
  ) OR old.expected_mapping_count<>(
    SELECT count(*)
    FROM `v2_legacy_source_mappings` `mapping`
    JOIN `v2_legacy_migration_batch_items` `item`
      ON `item`.`legacy_envelope_id`=`mapping`.`legacy_envelope_id` AND `item`.`user_id`=`mapping`.`user_id`
    JOIN `v2_legacy_migration_batches` `batch`
      ON `batch`.`id`=`item`.`batch_id` AND `batch`.`user_id`=`item`.`user_id`
    WHERE `item`.`batch_id`=old.batch_id AND `item`.`user_id`=old.user_id
      AND `mapping`.`adapter_version`=`batch`.`adapter_version`
  ) OR old.expected_source_count<>(
    SELECT count(DISTINCT `source`.`id`)
    FROM `v2_legacy_source_mappings` `mapping`
    JOIN `v2_legacy_migration_batch_items` `item`
      ON `item`.`legacy_envelope_id`=`mapping`.`legacy_envelope_id` AND `item`.`user_id`=`mapping`.`user_id`
    JOIN `v2_legacy_migration_batches` `batch`
      ON `batch`.`id`=`item`.`batch_id` AND `batch`.`user_id`=`item`.`user_id`
    JOIN `v2_source_items` `source`
      ON `source`.`id`=`mapping`.`source_item_id` AND `source`.`user_id`=`mapping`.`user_id`
    WHERE `item`.`batch_id`=old.batch_id AND `item`.`user_id`=old.user_id
      AND `mapping`.`adapter_version`=`batch`.`adapter_version`
  ) OR old.expected_prior_mapping_count<>(
    coalesce(json_extract((
      SELECT `batch`.`quarantine_receipt_json`
      FROM `v2_legacy_migration_batches` `batch`
      WHERE `batch`.`id`=old.batch_id AND `batch`.`user_id`=old.user_id
    ),'$.priorSourceOnlyRestored'),-1)
    + coalesce(json_extract((
      SELECT `batch`.`quarantine_receipt_json`
      FROM `v2_legacy_migration_batches` `batch`
      WHERE `batch`.`id`=old.batch_id AND `batch`.`user_id`=old.user_id
    ),'$.priorProjectedRestored'),-1)
  ) THEN RAISE(ABORT, 'legacy_quarantine_source_provenance_changed') END;
END;
--> statement-breakpoint
UPDATE `v2_legacy_migration_batches`
SET `control_status`=CASE WHEN `status`='succeeded' THEN 'complete' ELSE 'paused' END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_batch_control_insert_guard` BEFORE INSERT ON `v2_legacy_migration_batches`
WHEN new.control_status NOT IN ('paused','active','quarantining','quarantined','complete')
BEGIN
  SELECT RAISE(ABORT, 'legacy_batch_control_status_invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_batch_control_update_guard` BEFORE UPDATE OF `control_status` ON `v2_legacy_migration_batches`
WHEN new.control_status NOT IN ('paused','active','quarantining','quarantined','complete')
BEGIN
  SELECT RAISE(ABORT, 'legacy_batch_control_status_invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_mapping_knowledge_pending_control_guard` BEFORE UPDATE OF `status`,`activation_batch_id` ON `v2_legacy_source_mappings`
WHEN new.status='knowledge_pending' AND (old.status<>'knowledge_pending' OR new.activation_batch_id IS NOT old.activation_batch_id)
BEGIN
  SELECT CASE WHEN new.activation_batch_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM `v2_legacy_migration_batches` `batch`
    WHERE `batch`.`id`=new.activation_batch_id
      AND `batch`.`user_id`=new.user_id
      AND `batch`.`mode`='knowledge'
      AND `batch`.`status` IN ('approved','running')
      AND `batch`.`control_status`='active'
  ) THEN RAISE(ABORT, 'legacy_batch_control_inactive') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_mapping_superseded_basis_guard` BEFORE UPDATE OF `status`,`superseded_from_status` ON `v2_legacy_source_mappings`
WHEN new.status='superseded' AND old.status<>'superseded'
BEGIN
  SELECT CASE WHEN old.status NOT IN ('source_only','projected') OR new.superseded_from_status IS NOT old.status
    THEN RAISE(ABORT, 'legacy_superseded_basis_missing') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_batch_complete_control_guard` BEFORE UPDATE OF `control_status` ON `v2_legacy_migration_batches`
WHEN new.control_status='complete' AND old.control_status<>'complete'
BEGIN
  SELECT CASE WHEN old.control_status<>'active'
    OR new.status<>'succeeded'
    OR new.state_revision<>old.state_revision+1
    OR new.quarantine_idempotency_key IS NOT NULL
    THEN RAISE(ABORT, 'legacy_batch_completion_control_invalid') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `v2_legacy_source_mappings` `old_mapping`
    JOIN `v2_legacy_source_mappings` `current_mapping`
      ON `current_mapping`.`id`=`old_mapping`.`superseded_by_mapping_id`
     AND `current_mapping`.`user_id`=`old_mapping`.`user_id`
    WHERE `current_mapping`.`activation_batch_id`=new.id
      AND `current_mapping`.`user_id`=new.user_id
      AND `old_mapping`.`status`='superseded'
      AND `old_mapping`.`superseded_from_status` NOT IN ('source_only','projected')
  ) THEN RAISE(ABORT, 'legacy_superseded_basis_missing') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_batch_quarantine_guard` BEFORE UPDATE OF `control_status` ON `v2_legacy_migration_batches`
WHEN new.control_status='quarantined' AND old.control_status<>'quarantined'
BEGIN
  SELECT CASE WHEN old.control_status NOT IN ('paused','active','complete')
    OR new.state_revision<>old.state_revision+1
    OR new.status IS NOT old.status
    OR new.reconciliation_status IS NOT old.reconciliation_status
    OR new.reconciliation_json IS NOT old.reconciliation_json
    OR new.finished_at IS NOT old.finished_at
    OR new.reconciled_at IS NOT old.reconciled_at
    OR new.quarantine_idempotency_key IS NULL
    OR length(new.quarantine_idempotency_key)<1
    OR length(new.quarantine_idempotency_key)>128
    OR new.quarantine_reason IS NULL
    OR length(trim(new.quarantine_reason))<1
    OR length(new.quarantine_reason)>1000
    OR new.quarantine_pre_status IS NOT old.status
    OR new.quarantine_pre_control_status IS NOT old.control_status
    OR new.quarantine_receipt_json IS NULL
    OR json_valid(new.quarantine_receipt_json)<>1
    OR json_type(new.quarantine_receipt_json)<>'object'
    OR json_extract(new.quarantine_receipt_json,'$.batchId') IS NOT new.id
    OR json_extract(new.quarantine_receipt_json,'$.mode') IS NOT new.mode
    OR json_extract(new.quarantine_receipt_json,'$.preStatus') IS NOT old.status
    OR json_extract(new.quarantine_receipt_json,'$.preControlStatus') IS NOT old.control_status
    OR json_extract(new.quarantine_receipt_json,'$.idempotencyKey') IS NOT new.quarantine_idempotency_key
    OR json_extract(new.quarantine_receipt_json,'$.quarantinedAt') IS NOT new.quarantined_at
    OR json_type(new.quarantine_receipt_json,'$.restoredMappings')<>'array'
    OR json_array_length(json_extract(new.quarantine_receipt_json,'$.restoredMappings'))<>
      coalesce(json_extract(new.quarantine_receipt_json,'$.priorSourceOnlyRestored'),-1)+
      coalesce(json_extract(new.quarantine_receipt_json,'$.priorProjectedRestored'),-1)
    OR (SELECT count(DISTINCT json_extract(`entry`.`value`,'$.mappingId'))
        FROM json_each(json_extract(new.quarantine_receipt_json,'$.restoredMappings')) `entry`)<>
      json_array_length(json_extract(new.quarantine_receipt_json,'$.restoredMappings'))
    OR coalesce(json_extract(new.quarantine_receipt_json,'$.preservedItemCount'),-1)<>(
      SELECT count(*) FROM `v2_legacy_migration_batch_items` `item`
      WHERE `item`.`batch_id`=new.id AND `item`.`user_id`=new.user_id
    )
    OR coalesce(json_extract(new.quarantine_receipt_json,'$.preservedEnvelopeCount'),-1)<>(
      SELECT count(DISTINCT `item`.`legacy_envelope_id`) FROM `v2_legacy_migration_batch_items` `item`
      WHERE `item`.`batch_id`=new.id AND `item`.`user_id`=new.user_id
    )
    OR new.quarantined_at IS NULL
    THEN RAISE(ABORT, 'legacy_quarantine_receipt_invalid') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `v2_legacy_migration_batch_items` `item`
    LEFT JOIN `v2_legacy_source_envelopes` `envelope`
      ON `envelope`.`id`=`item`.`legacy_envelope_id`
     AND `envelope`.`user_id`=`item`.`user_id`
    WHERE `item`.`batch_id`=new.id
      AND `item`.`user_id`=new.user_id
      AND (
        `envelope`.`id` IS NULL
        OR `envelope`.`legacy_table`<>new.legacy_table
        OR `envelope`.`legacy_id`<>`item`.`legacy_id`
        OR `envelope`.`row_hash`<>`item`.`row_hash`
        OR `envelope`.`schema_snapshot`<>new.schema_snapshot
      )
  ) THEN RAISE(ABORT, 'legacy_quarantine_source_provenance_invalid') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `v2_legacy_source_mappings` `mapping`
    JOIN `v2_legacy_migration_batch_items` `item`
      ON `item`.`legacy_envelope_id`=`mapping`.`legacy_envelope_id`
     AND `item`.`user_id`=`mapping`.`user_id`
    LEFT JOIN `v2_source_items` `source`
      ON `source`.`id`=`mapping`.`source_item_id`
     AND `source`.`user_id`=`mapping`.`user_id`
    LEFT JOIN `v2_objects` `object`
      ON `object`.`id`=`mapping`.`projected_object_id`
     AND `object`.`user_id`=`mapping`.`user_id`
    WHERE `item`.`batch_id`=new.id
      AND `item`.`user_id`=new.user_id
      AND `mapping`.`adapter_version`=new.adapter_version
      AND (
        (`mapping`.`projection_kind`='archived_only' AND (
          `mapping`.`status`<>'archived'
          OR `mapping`.`source_item_id` IS NOT NULL
          OR `mapping`.`projected_object_id` IS NOT NULL
        ))
        OR (`mapping`.`projection_kind`<>'archived_only' AND (
          `mapping`.`source_item_id` IS NULL
          OR `source`.`id` IS NULL
          OR `mapping`.`projected_object_id` IS NULL
          OR `object`.`id` IS NULL
          OR `mapping`.`superseded_at` IS NOT NULL
          OR `mapping`.`superseded_by_mapping_id` IS NOT NULL
          OR `mapping`.`superseded_from_status` IS NOT NULL
          OR (new.mode='source_only' AND (
            `mapping`.`status`<>'source_only'
            OR `mapping`.`activation_batch_id` IS NOT NULL
            OR `object`.`lifecycle_status`<>'archived'
          ))
          OR (new.mode='knowledge' AND NOT (
            (`mapping`.`status`='source_only'
              AND `mapping`.`activation_batch_id` IS NULL
              AND `object`.`lifecycle_status`='archived')
            OR (`mapping`.`status`='projected'
              AND `mapping`.`activation_batch_id` IS NOT new.id
              AND `mapping`.`target_lifecycle_status` IN ('active','archived')
              AND `object`.`lifecycle_status`=`mapping`.`target_lifecycle_status`
              AND (`mapping`.`activation_batch_id` IS NULL OR EXISTS (
                SELECT 1 FROM `v2_legacy_migration_batches` `owner_batch`
                WHERE `owner_batch`.`id`=`mapping`.`activation_batch_id`
                  AND `owner_batch`.`user_id`=`mapping`.`user_id`
                  AND `owner_batch`.`status`='succeeded'
                  AND `owner_batch`.`control_status`='complete'
              )))
          ))
        ))
      )
  ) THEN RAISE(ABORT, 'legacy_quarantine_mapping_invalid') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `v2_legacy_source_mappings` `mapping`
    WHERE `mapping`.`user_id`=new.user_id
      AND `mapping`.`activation_batch_id`=new.id
  ) THEN RAISE(ABORT, 'legacy_quarantine_activation_pending') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `v2_legacy_source_mappings` `old_mapping`
    WHERE `old_mapping`.`user_id`=new.user_id
      AND `old_mapping`.`status`='superseded'
      AND `old_mapping`.`superseded_by_mapping_id` IN (
        SELECT `current_mapping`.`id`
        FROM `v2_legacy_source_mappings` `current_mapping`
        JOIN `v2_legacy_migration_batch_items` `item`
          ON `item`.`legacy_envelope_id`=`current_mapping`.`legacy_envelope_id`
         AND `item`.`user_id`=`current_mapping`.`user_id`
        WHERE `item`.`batch_id`=new.id
          AND `item`.`user_id`=new.user_id
          AND `current_mapping`.`adapter_version`=new.adapter_version
      )
  ) THEN RAISE(ABORT, 'legacy_quarantine_superseded_linkage_pending') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM json_each(json_extract(new.quarantine_receipt_json,'$.restoredMappings')) `entry`
    LEFT JOIN `v2_legacy_source_mappings` `mapping`
      ON `mapping`.`id`=json_extract(`entry`.`value`,'$.mappingId')
     AND `mapping`.`user_id`=new.user_id
    LEFT JOIN `v2_objects` `object`
      ON `object`.`id`=`mapping`.`projected_object_id`
     AND `object`.`user_id`=`mapping`.`user_id`
    WHERE json_extract(`entry`.`value`,'$.priorStatus') NOT IN ('source_only','projected')
      OR `mapping`.`id` IS NULL
      OR `mapping`.`status` IS NOT json_extract(`entry`.`value`,'$.priorStatus')
      OR `mapping`.`superseded_at` IS NOT NULL
      OR `mapping`.`superseded_by_mapping_id` IS NOT NULL
      OR `mapping`.`superseded_from_status` IS NOT NULL
      OR `mapping`.`projected_object_id` IS NOT json_extract(`entry`.`value`,'$.objectId')
      OR `object`.`id` IS NULL
      OR (`mapping`.`status`='source_only' AND `object`.`lifecycle_status`<>'archived')
      OR (`mapping`.`status`='projected' AND (
        `mapping`.`target_lifecycle_status` NOT IN ('active','archived')
        OR `object`.`lifecycle_status`<>`mapping`.`target_lifecycle_status`
      ))
  ) THEN RAISE(ABORT, 'legacy_quarantine_restoration_invalid') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `v2_legacy_preservation_gates` `gate`
    WHERE `gate`.`user_id`=new.user_id
      AND `gate`.`target_batch_id`=new.id
      AND `gate`.`status`='checking'
  ) THEN RAISE(ABORT, 'legacy_quarantine_gate_pending') END;
END;
