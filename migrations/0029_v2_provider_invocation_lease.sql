CREATE TABLE `v2_provider_invocation_leases` (
  `job_id` text PRIMARY KEY NOT NULL REFERENCES `v2_processing_jobs`(`id`) ON DELETE CASCADE,
  `run_id` text NOT NULL REFERENCES `v2_processing_runs`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `object_id` text NOT NULL REFERENCES `v2_objects`(`id`) ON DELETE CASCADE,
  `lease_owner` text NOT NULL,
  `stage` text NOT NULL CHECK (`stage` IN ('analyze','grounded_enrich')),
  `expires_at` text NOT NULL,
  `acquired_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_provider_invocation_run`
ON `v2_provider_invocation_leases` (`run_id`);
--> statement-breakpoint
CREATE INDEX `idx_v2_provider_invocation_object_expiry`
ON `v2_provider_invocation_leases` (`user_id`,`object_id`,`expires_at`);
--> statement-breakpoint
DROP INDEX `uq_v2_property_current_accepted`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_property_current_accepted`
ON `v2_property_values` (`user_id`,`owner_object_id`,`field_definition_id`)
WHERE `review_status`='accepted' AND `superseded_at` IS NULL;
--> statement-breakpoint
DROP INDEX `uq_v2_object_type_assignment`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_object_type_assignment`
ON `v2_object_type_assignments` (`user_id`,`object_id`,`type_definition_id`);
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_mapping_invocation_insert_guard`
BEFORE INSERT ON `v2_legacy_source_mappings`
WHEN new.projected_object_id IS NOT NULL AND new.status IS NOT 'projected'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `v2_provider_invocation_leases` `lease`
    JOIN `v2_objects` `object`
      ON `object`.`id`=new.projected_object_id
     AND `object`.`user_id`=new.user_id
     AND `object`.`lifecycle_status`='active'
    WHERE `lease`.`user_id`=new.user_id
      AND `lease`.`object_id`=new.projected_object_id
      AND `lease`.`expires_at`>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  ) THEN RAISE(ABORT, 'legacy_provider_invocation_active') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_mapping_invocation_update_guard`
BEFORE UPDATE OF `status`,`projected_object_id`,`user_id` ON `v2_legacy_source_mappings`
WHEN (
  old.status='projected'
  AND old.projected_object_id IS NOT NULL
  AND (
    new.status IS NOT 'projected'
    OR new.projected_object_id IS NOT old.projected_object_id
    OR new.user_id IS NOT old.user_id
  )
) OR (new.projected_object_id IS NOT NULL AND new.status IS NOT 'projected')
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `v2_provider_invocation_leases` `lease`
    WHERE `lease`.`expires_at`>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND (
        (old.status='projected'
          AND old.projected_object_id=`lease`.`object_id`
          AND old.user_id=`lease`.`user_id`
          AND (
            new.status IS NOT 'projected'
            OR new.projected_object_id IS NOT old.projected_object_id
            OR new.user_id IS NOT old.user_id
          ))
        OR (
          new.projected_object_id=`lease`.`object_id`
          AND new.user_id=`lease`.`user_id`
          AND EXISTS (
            SELECT 1 FROM `v2_objects` `object`
            WHERE `object`.`id`=new.projected_object_id
              AND `object`.`user_id`=new.user_id
              AND `object`.`lifecycle_status`='active'
          )
        )
      )
  ) THEN RAISE(ABORT, 'legacy_provider_invocation_active') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_mapping_invocation_delete_guard`
BEFORE DELETE ON `v2_legacy_source_mappings`
WHEN old.status='projected' AND old.projected_object_id IS NOT NULL
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `v2_provider_invocation_leases` `lease`
    WHERE `lease`.`user_id`=old.user_id
      AND `lease`.`object_id`=old.projected_object_id
      AND `lease`.`expires_at`>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  ) THEN RAISE(ABORT, 'legacy_provider_invocation_active') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_object_invocation_lifecycle_guard`
BEFORE UPDATE OF `lifecycle_status` ON `v2_objects`
WHEN old.lifecycle_status='active' AND new.lifecycle_status<>'active'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `v2_provider_invocation_leases` `lease`
    WHERE `lease`.`user_id`=old.user_id
      AND `lease`.`object_id`=old.id
      AND `lease`.`expires_at`>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  ) THEN RAISE(ABORT, 'legacy_provider_invocation_active') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_object_invocation_delete_guard`
BEFORE DELETE ON `v2_objects`
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `v2_provider_invocation_leases` `lease`
    WHERE `lease`.`user_id`=old.user_id
      AND `lease`.`object_id`=old.id
      AND `lease`.`expires_at`>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  ) THEN RAISE(ABORT, 'legacy_provider_invocation_active') END;
END;
