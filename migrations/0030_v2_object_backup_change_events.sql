CREATE TRIGGER `trg_v2_change_object_insert` AFTER INSERT ON `v2_objects`
BEGIN
  INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`)
  VALUES (new.user_id,'object',new.id,null,'upsert',null,new.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_object_update` AFTER UPDATE ON `v2_objects`
WHEN old.user_id IS NOT new.user_id OR old.object_kind IS NOT new.object_kind
  OR old.lifecycle_status IS NOT new.lifecycle_status OR old.canonical_object_id IS NOT new.canonical_object_id
  OR old.created_at IS NOT new.created_at OR old.updated_at IS NOT new.updated_at OR old.deleted_at IS NOT new.deleted_at
BEGIN
  INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`)
  SELECT old.user_id,'object',old.id,null,'tombstone',null,new.updated_at
  WHERE old.user_id IS NOT new.user_id AND EXISTS (SELECT 1 FROM users WHERE id=old.user_id);
  INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`)
  VALUES (new.user_id,'object',new.id,null,'upsert',null,new.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_change_object_delete` AFTER DELETE ON `v2_objects`
BEGIN
  INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`)
  SELECT old.user_id,'object',old.id,null,'tombstone',null,coalesce(old.deleted_at,old.updated_at)
  WHERE EXISTS (SELECT 1 FROM users WHERE id=old.user_id);
END;
--> statement-breakpoint
CREATE INDEX `idx_v2_objects_user_updated_id` ON `v2_objects` (`user_id`,`updated_at` DESC,`id` DESC);
--> statement-breakpoint
-- Each committed revision gets its own outbox receipt. Reusing one capture
-- row would let an older dispatch acknowledge a newly queued edit.
DROP INDEX `uq_v2_outbox_capture_event`;
--> statement-breakpoint
CREATE INDEX `idx_v2_outbox_capture_event` ON `v2_processing_outbox` (`capture_id`,`event_type`);
--> statement-breakpoint
-- Refresh existing object parents in the next incremental snapshot too; some
-- entities/events may have been created before these triggers existed.
INSERT INTO `v2_change_events` (`user_id`,`aggregate_kind`,`aggregate_id`,`revision_or_version`,`operation`,`content_hash`,`occurred_at`)
SELECT user_id,'object',id,null,'upsert',null,updated_at FROM `v2_objects`;
