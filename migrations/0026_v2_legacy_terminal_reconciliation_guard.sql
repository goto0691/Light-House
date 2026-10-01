CREATE TRIGGER `trg_v2_legacy_batch_terminal_reconciliation_guard` BEFORE UPDATE OF `status` ON `v2_legacy_migration_batches`
WHEN new.status='succeeded'
BEGIN
  SELECT CASE WHEN new.mode='knowledge' AND (
    json_valid(new.reconciliation_json)<>1
    OR coalesce(json_extract(new.reconciliation_json,'$.knowledge_pending_count'),-1)<>0
    OR EXISTS (
      SELECT 1
      FROM `v2_legacy_source_mappings` `mapping`
      JOIN `v2_legacy_migration_batch_items` `item`
        ON `item`.`legacy_envelope_id`=`mapping`.`legacy_envelope_id`
       AND `item`.`user_id`=`mapping`.`user_id`
      WHERE `item`.`batch_id`=new.id
        AND `item`.`user_id`=new.user_id
        AND `mapping`.`adapter_version`=new.adapter_version
        AND `mapping`.`status`='knowledge_pending'
    )
  ) THEN RAISE(ABORT, 'legacy_knowledge_pending_not_zero') END;

  SELECT CASE WHEN
    json_valid(new.manifest_json)<>1
    OR json_type(new.manifest_json)<>'array'
    OR json_array_length(new.manifest_json)<>new.input_rows
  THEN RAISE(ABORT, 'legacy_projection_receipt_mismatch') END;

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
  ) THEN RAISE(ABORT, 'legacy_projection_receipt_mismatch') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `v2_legacy_migration_batch_items` `item`
    WHERE `item`.`batch_id`=new.id
      AND `item`.`user_id`=new.user_id
      AND (
        `item`.`projection_hash` IS NOT (
          SELECT json_extract(`entry`.`value`,'$.projectionHash')
          FROM json_each(new.manifest_json) `entry`
          WHERE cast(`entry`.`key` AS integer)=`item`.`position`
        )
        OR json(`item`.`projections_json`) IS NOT json((
          SELECT json_extract(`entry`.`value`,'$.projections')
          FROM json_each(new.manifest_json) `entry`
          WHERE cast(`entry`.`key` AS integer)=`item`.`position`
        ))
      )
  ) THEN RAISE(ABORT, 'legacy_projection_receipt_mismatch') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `v2_legacy_source_mappings` `mapping`
    JOIN `v2_legacy_migration_batch_items` `item`
      ON `item`.`legacy_envelope_id`=`mapping`.`legacy_envelope_id`
     AND `item`.`user_id`=`mapping`.`user_id`
    LEFT JOIN `v2_objects` `object`
      ON `object`.`id`=`mapping`.`projected_object_id`
     AND `object`.`user_id`=`mapping`.`user_id`
    WHERE `item`.`batch_id`=new.id
      AND `item`.`user_id`=new.user_id
      AND `mapping`.`adapter_version`=new.adapter_version
      AND `mapping`.`projection_kind`<>'archived_only'
      AND (
        `mapping`.`projected_object_id` IS NULL
        OR `object`.`id` IS NULL
        OR (`mapping`.`status` IN ('source_only','knowledge_pending','superseded') AND `object`.`lifecycle_status`<>'archived')
        OR (`mapping`.`status`='projected' AND (
          `mapping`.`target_lifecycle_status` IS NULL
          OR `mapping`.`target_lifecycle_status` NOT IN ('active','archived')
          OR `object`.`lifecycle_status`<>`mapping`.`target_lifecycle_status`
        ))
      )
  ) THEN RAISE(ABORT, 'legacy_mapping_lifecycle_invalid') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `v2_legacy_source_mappings` `old_mapping`
    JOIN `v2_legacy_source_mappings` `current_mapping`
      ON `current_mapping`.`id`=`old_mapping`.`superseded_by_mapping_id`
     AND `current_mapping`.`user_id`=`old_mapping`.`user_id`
    LEFT JOIN `v2_objects` `old_object`
      ON `old_object`.`id`=`old_mapping`.`projected_object_id`
     AND `old_object`.`user_id`=`old_mapping`.`user_id`
    WHERE `current_mapping`.`activation_batch_id`=new.id
      AND `current_mapping`.`user_id`=new.user_id
      AND `old_mapping`.`status`='superseded'
      AND (
        `old_mapping`.`projected_object_id` IS NULL
        OR `old_object`.`id` IS NULL
        OR `old_object`.`lifecycle_status`<>'archived'
      )
  ) THEN RAISE(ABORT, 'legacy_mapping_lifecycle_invalid') END;
END;
