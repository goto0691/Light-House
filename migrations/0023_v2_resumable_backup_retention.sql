CREATE TABLE `v2_backup_retention_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `idempotency_key` text NOT NULL,
  `status` text NOT NULL DEFAULT 'running' CHECK (`status` IN ('running','succeeded','failed')),
  `phase` text NOT NULL DEFAULT 'inventory' CHECK (`phase` IN ('inventory','ancestor_closure','pruning','gc_references','gc_deleting','complete')),
  `cursor_json` text NOT NULL DEFAULT '{}',
  `state_revision` integer NOT NULL DEFAULT 0,
  `failure_code` text,
  `started_at` text NOT NULL,
  `last_progress_at` text NOT NULL,
  `finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_backup_retention_user_idempotency` ON `v2_backup_retention_runs` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_v2_backup_retention_resume` ON `v2_backup_retention_runs` (`status`,`last_progress_at`,`user_id`);
--> statement-breakpoint

CREATE TABLE `v2_backup_retention_keep` (
  `run_id` text NOT NULL REFERENCES `v2_backup_retention_runs`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `snapshot_id` text NOT NULL REFERENCES `v2_backup_snapshots`(`id`) ON DELETE CASCADE,
  `reason` text NOT NULL,
  `chain_checked` integer NOT NULL DEFAULT 0 CHECK (`chain_checked` IN (0,1)),
  `created_at` text NOT NULL,
  PRIMARY KEY (`run_id`,`snapshot_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_backup_retention_keep_chain` ON `v2_backup_retention_keep` (`run_id`,`chain_checked`,`snapshot_id`);
--> statement-breakpoint

CREATE TABLE `v2_backup_retention_snapshot_work` (
  `run_id` text NOT NULL REFERENCES `v2_backup_retention_runs`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `snapshot_id` text NOT NULL REFERENCES `v2_backup_snapshots`(`id`) ON DELETE CASCADE,
  `status` text NOT NULL DEFAULT 'receipting' CHECK (`status` IN ('receipting','deleting_objects','marking_blobs','finalizing','complete','cancelled')),
  `cursor_json` text NOT NULL DEFAULT '{}',
  `created_at` text NOT NULL,
  `completed_at` text,
  PRIMARY KEY (`run_id`,`snapshot_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_backup_retention_snapshot_work_resume` ON `v2_backup_retention_snapshot_work` (`run_id`,`status`,`snapshot_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_backup_retention_active_snapshot_work` ON `v2_backup_retention_snapshot_work` (`snapshot_id`) WHERE `status` NOT IN ('complete','cancelled');
--> statement-breakpoint

CREATE TABLE `v2_backup_retention_object_receipts` (
  `run_id` text NOT NULL REFERENCES `v2_backup_retention_runs`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `snapshot_id` text NOT NULL REFERENCES `v2_backup_snapshots`(`id`) ON DELETE CASCADE,
  `object_key` text NOT NULL,
  `object_kind` text NOT NULL CHECK (`object_kind` IN ('metadata','manifest')),
  `status` text NOT NULL DEFAULT 'pending' CHECK (`status` IN ('pending','deleted')),
  `created_at` text NOT NULL,
  `deleted_at` text,
  PRIMARY KEY (`run_id`,`object_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_backup_retention_object_resume` ON `v2_backup_retention_object_receipts` (`run_id`,`snapshot_id`,`status`,`object_key`);
--> statement-breakpoint

CREATE TABLE `v2_backup_retention_known_metadata_paths` (
  `path` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
INSERT INTO `v2_backup_retention_known_metadata_paths` (`path`) VALUES
  ('attachments/metadata.jsonl'),
  ('migration/legacy-migration-batch-items.jsonl'),
  ('migration/legacy-migration-batches.jsonl'),
  ('migration/legacy-source-envelopes.jsonl'),
  ('migration/legacy-source-mappings.jsonl'),
  ('objects/analysis-proposals.jsonl'),
  ('objects/deletion-tombstones.jsonl'),
  ('objects/document-revisions.jsonl'),
  ('objects/document-source-links.jsonl'),
  ('objects/documents.jsonl'),
  ('objects/entities.jsonl'),
  ('objects/events.jsonl'),
  ('objects/evidence-refs.jsonl'),
  ('objects/grounding-requests.jsonl'),
  ('objects/grounding-results.jsonl'),
  ('objects/objects.jsonl'),
  ('objects/processing-jobs.jsonl'),
  ('objects/processing-runs.jsonl'),
  ('objects/property-values.jsonl'),
  ('objects/relations.jsonl'),
  ('objects/review-items.jsonl'),
  ('objects/review-receipts.jsonl'),
  ('objects/type-assignments.jsonl'),
  ('registries/fields.jsonl'),
  ('registries/predicates.jsonl'),
  ('registries/presentation-profiles.jsonl'),
  ('registries/template-pattern-observations.jsonl'),
  ('registries/template-versions.jsonl'),
  ('registries/templates.jsonl'),
  ('registries/types.jsonl'),
  ('registries/units.jsonl'),
  ('sources/captures.jsonl'),
  ('sources/source-attachment-links.jsonl'),
  ('sources/source-items.jsonl'),
  ('sources/template-input-values.jsonl'),
  ('sources/template-sessions.jsonl'),
  ('sources/template-source-links.jsonl'),
  ('views/rediscovery-preferences.jsonl'),
  ('views/saved-views.jsonl');
--> statement-breakpoint

CREATE TABLE `v2_backup_maintenance_state` (
  `id` integer PRIMARY KEY NOT NULL CHECK (`id`=1),
  `last_user_id` text,
  `state_revision` integer NOT NULL DEFAULT 0,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `v2_backup_maintenance_state` (`id`,`last_user_id`,`state_revision`,`updated_at`)
VALUES (1,NULL,0,'1970-01-01T00:00:00.000Z');
--> statement-breakpoint

ALTER TABLE `v2_backup_blob_gc_marks` ADD COLUMN `delete_token` text;
--> statement-breakpoint
ALTER TABLE `v2_backup_blob_gc_marks` ADD COLUMN `delete_claimed_at` text;
--> statement-breakpoint
CREATE INDEX `idx_v2_backup_blob_gc_claim` ON `v2_backup_blob_gc_marks` (`delete_token`,`deleted_at`,`unreferenced_since`);
--> statement-breakpoint
ALTER TABLE `v2_backup_snapshots` ADD COLUMN `prune_run_id` text;
--> statement-breakpoint
CREATE INDEX `idx_v2_backup_prune_owner` ON `v2_backup_snapshots` (`user_id`,`status`,`prune_run_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_backup_prune_run_active` ON `v2_backup_snapshots` (`prune_run_id`) WHERE `prune_run_id` IS NOT NULL;
--> statement-breakpoint

CREATE TRIGGER `trg_v2_backup_retention_keep_user_guard` BEFORE INSERT ON `v2_backup_retention_keep`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_backup_retention_runs r WHERE r.id=new.run_id AND r.user_id=new.user_id) THEN RAISE(ABORT, 'backup_retention_keep_user_mismatch') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_backup_snapshots s WHERE s.id=new.snapshot_id AND s.user_id=new.user_id) THEN RAISE(ABORT, 'backup_retention_keep_snapshot_mismatch') END;
  SELECT CASE WHEN EXISTS (
    WITH RECURSIVE chain(id) AS (
      SELECT new.snapshot_id
      UNION
      SELECT s.base_snapshot_id FROM v2_backup_snapshots s JOIN chain c ON s.id=c.id
      WHERE s.user_id=new.user_id AND s.base_snapshot_id IS NOT NULL
    )
    SELECT 1 FROM chain c JOIN v2_backup_retention_snapshot_work w ON w.snapshot_id=c.id
    WHERE w.user_id=new.user_id AND w.status IN ('deleting_objects','marking_blobs','finalizing')
  ) THEN RAISE(ABORT, 'backup_dependency_retention_in_progress') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_retention_run_dependency_seed` AFTER INSERT ON `v2_backup_retention_runs`
WHEN new.status='running'
BEGIN
  INSERT INTO `v2_backup_retention_keep` (`run_id`,`user_id`,`snapshot_id`,`reason`,`chain_checked`,`created_at`)
  SELECT new.id,new.user_id,s.base_snapshot_id,'active_backup_base',0,new.started_at
  FROM `v2_backup_snapshots` s
  WHERE s.user_id=new.user_id AND s.status='building' AND s.base_snapshot_id IS NOT NULL
  ON CONFLICT (`run_id`,`snapshot_id`) DO NOTHING;
  INSERT INTO `v2_backup_retention_keep` (`run_id`,`user_id`,`snapshot_id`,`reason`,`chain_checked`,`created_at`)
  SELECT new.id,new.user_id,b.source_ref,'active_restore_source',0,new.started_at
  FROM `v2_restore_batches` b
  WHERE b.user_id=new.user_id AND b.source_kind='backup' AND b.source_ref IS NOT NULL
    AND b.status NOT IN ('succeeded','failed','rolled_back','rollback_conflicted')
  ON CONFLICT (`run_id`,`snapshot_id`) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_retention_work_user_guard` BEFORE INSERT ON `v2_backup_retention_snapshot_work`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_backup_retention_runs r WHERE r.id=new.run_id AND r.user_id=new.user_id) THEN RAISE(ABORT, 'backup_retention_work_user_mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM v2_backup_snapshots s
    WHERE s.id=new.snapshot_id AND s.user_id=new.user_id AND s.status='pruning' AND s.prune_run_id=new.run_id
  ) THEN RAISE(ABORT, 'backup_retention_work_snapshot_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_retention_work_state_guard` BEFORE UPDATE OF `run_id`,`user_id`,`snapshot_id`,`status` ON `v2_backup_retention_snapshot_work`
WHEN new.status NOT IN ('complete','cancelled')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM v2_backup_retention_runs r
    JOIN v2_backup_snapshots s ON s.id=new.snapshot_id AND s.user_id=new.user_id
    WHERE r.id=new.run_id AND r.user_id=new.user_id AND r.status='running'
      AND s.status='pruning' AND s.prune_run_id=new.run_id
  ) THEN RAISE(ABORT, 'backup_retention_work_snapshot_mismatch') END;
  SELECT CASE WHEN old.status='receipting' AND new.status='deleting_objects' AND EXISTS (
    WITH RECURSIVE protected(id) AS (
      SELECT s.base_snapshot_id FROM v2_backup_snapshots s
      WHERE s.user_id=new.user_id AND s.status='building' AND s.base_snapshot_id IS NOT NULL
      UNION
      SELECT b.source_ref FROM v2_restore_batches b
      WHERE b.user_id=new.user_id AND b.source_kind='backup' AND b.source_ref IS NOT NULL
        AND b.status NOT IN ('succeeded','failed','rolled_back','rollback_conflicted')
      UNION
      SELECT k.snapshot_id FROM v2_backup_retention_keep k
      JOIN v2_backup_retention_runs r ON r.id=k.run_id
      WHERE k.user_id=new.user_id AND r.status='running'
      UNION
      SELECT s.base_snapshot_id FROM v2_backup_snapshots s JOIN protected p ON s.id=p.id
      WHERE s.user_id=new.user_id AND s.base_snapshot_id IS NOT NULL
    )
    SELECT 1 FROM protected WHERE id=new.snapshot_id
  ) THEN RAISE(ABORT, 'backup_retention_dependency_changed') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_retention_object_user_guard` BEFORE INSERT ON `v2_backup_retention_object_receipts`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_backup_retention_snapshot_work w WHERE w.run_id=new.run_id AND w.snapshot_id=new.snapshot_id AND w.user_id=new.user_id) THEN RAISE(ABORT, 'backup_retention_object_user_mismatch') END;
  SELECT CASE WHEN new.object_kind='manifest' AND NOT EXISTS (
    SELECT 1 FROM v2_backup_snapshots s
    WHERE s.id=new.snapshot_id AND s.user_id=new.user_id
      AND s.manifest_object_key=new.object_key
      AND substr(new.object_key,1,6)='users/'
      AND substr(new.object_key,-length('/backups/snapshots/' || s.id || '/manifest.json'))='/backups/snapshots/' || s.id || '/manifest.json'
      AND length(new.object_key)>6+length('/backups/snapshots/' || s.id || '/manifest.json')
      AND instr(substr(new.object_key,7,length(new.object_key)-6-length('/backups/snapshots/' || s.id || '/manifest.json')),'/')=0
  ) THEN RAISE(ABORT, 'backup_retention_object_key_invalid') END;
  SELECT CASE WHEN new.object_kind='metadata' AND NOT EXISTS (
    SELECT 1 FROM v2_backup_snapshots s
    WHERE s.id=new.snapshot_id AND s.user_id=new.user_id AND (
      EXISTS (SELECT 1 FROM v2_backup_metadata_files f WHERE f.snapshot_id=s.id AND f.user_id=s.user_id AND f.object_key=new.object_key)
      OR (s.workflow_version<2 AND substr(s.manifest_object_key,1,6)='users/'
        AND substr(s.manifest_object_key,-length('/backups/snapshots/' || s.id || '/manifest.json'))='/backups/snapshots/' || s.id || '/manifest.json'
        AND length(s.manifest_object_key)>6+length('/backups/snapshots/' || s.id || '/manifest.json')
        AND instr(substr(s.manifest_object_key,7,length(s.manifest_object_key)-6-length('/backups/snapshots/' || s.id || '/manifest.json')),'/')=0
        AND EXISTS (
          SELECT 1 FROM v2_backup_retention_known_metadata_paths p
          WHERE new.object_key=substr(s.manifest_object_key,1,length(s.manifest_object_key)-length('manifest.json')) || 'metadata/' || p.path
        ))
    )
  ) THEN RAISE(ABORT, 'backup_retention_object_key_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_retention_object_update_guard` BEFORE UPDATE ON `v2_backup_retention_object_receipts`
BEGIN
  SELECT CASE WHEN new.run_id<>old.run_id OR new.user_id<>old.user_id OR new.snapshot_id<>old.snapshot_id OR new.object_key<>old.object_key OR new.object_kind<>old.object_kind THEN RAISE(ABORT, 'backup_retention_object_identity_immutable') END;
  SELECT CASE WHEN old.status='deleted' AND new.status<>'deleted' THEN RAISE(ABORT, 'backup_retention_object_status_invalid') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_backup_retention_snapshot_work w WHERE w.run_id=new.run_id AND w.snapshot_id=new.snapshot_id AND w.user_id=new.user_id) THEN RAISE(ABORT, 'backup_retention_object_user_mismatch') END;
  SELECT CASE WHEN new.object_kind='manifest' AND NOT EXISTS (
    SELECT 1 FROM v2_backup_snapshots s
    WHERE s.id=new.snapshot_id AND s.user_id=new.user_id
      AND s.manifest_object_key=new.object_key
      AND substr(new.object_key,1,6)='users/'
      AND substr(new.object_key,-length('/backups/snapshots/' || s.id || '/manifest.json'))='/backups/snapshots/' || s.id || '/manifest.json'
      AND length(new.object_key)>6+length('/backups/snapshots/' || s.id || '/manifest.json')
      AND instr(substr(new.object_key,7,length(new.object_key)-6-length('/backups/snapshots/' || s.id || '/manifest.json')),'/')=0
  ) THEN RAISE(ABORT, 'backup_retention_object_key_invalid') END;
  SELECT CASE WHEN new.object_kind='metadata' AND NOT EXISTS (
    SELECT 1 FROM v2_backup_snapshots s
    WHERE s.id=new.snapshot_id AND s.user_id=new.user_id AND (
      EXISTS (SELECT 1 FROM v2_backup_metadata_files f WHERE f.snapshot_id=s.id AND f.user_id=s.user_id AND f.object_key=new.object_key)
      OR (s.workflow_version<2 AND substr(s.manifest_object_key,1,6)='users/'
        AND substr(s.manifest_object_key,-length('/backups/snapshots/' || s.id || '/manifest.json'))='/backups/snapshots/' || s.id || '/manifest.json'
        AND length(s.manifest_object_key)>6+length('/backups/snapshots/' || s.id || '/manifest.json')
        AND instr(substr(s.manifest_object_key,7,length(s.manifest_object_key)-6-length('/backups/snapshots/' || s.id || '/manifest.json')),'/')=0
        AND EXISTS (
          SELECT 1 FROM v2_backup_retention_known_metadata_paths p
          WHERE new.object_key=substr(s.manifest_object_key,1,length(s.manifest_object_key)-length('manifest.json')) || 'metadata/' || p.path
        ))
    )
  ) THEN RAISE(ABORT, 'backup_retention_object_key_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_blob_ref_owner_insert_guard` BEFORE INSERT ON `v2_backup_blob_refs`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_backup_snapshots s WHERE s.id=new.snapshot_id AND s.user_id=new.user_id) THEN RAISE(ABORT, 'backup_blob_ref_owner_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_blob_ref_owner_update_guard` BEFORE UPDATE OF `snapshot_id`,`user_id` ON `v2_backup_blob_refs`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_backup_snapshots s WHERE s.id=new.snapshot_id AND s.user_id=new.user_id) THEN RAISE(ABORT, 'backup_blob_ref_owner_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_blob_ref_gc_guard` BEFORE INSERT ON `v2_backup_blob_refs`
WHEN EXISTS (
  SELECT 1 FROM `v2_backup_blob_gc_marks` g
  WHERE g.user_id=new.user_id AND g.sha256=new.sha256 AND g.deleted_at IS NULL AND g.delete_token IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'backup_blob_gc_in_progress');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_retention_protect_new_base` AFTER INSERT ON `v2_backup_snapshots`
WHEN new.status='building' AND new.base_snapshot_id IS NOT NULL
BEGIN
  INSERT INTO `v2_backup_retention_keep` (`run_id`,`user_id`,`snapshot_id`,`reason`,`chain_checked`,`created_at`)
  SELECT r.id,new.user_id,new.base_snapshot_id,'active_backup_base',0,new.created_at
  FROM `v2_backup_retention_runs` r
  WHERE r.user_id=new.user_id AND r.status='running'
  ON CONFLICT (`run_id`,`snapshot_id`) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_retention_protect_new_snapshot` AFTER INSERT ON `v2_backup_snapshots`
WHEN new.status='succeeded'
BEGIN
  INSERT INTO `v2_backup_retention_keep` (`run_id`,`user_id`,`snapshot_id`,`reason`,`chain_checked`,`created_at`)
  SELECT r.id,new.user_id,new.id,'concurrent_snapshot',0,new.created_at
  FROM `v2_backup_retention_runs` r
  WHERE r.user_id=new.user_id AND r.status='running'
  ON CONFLICT (`run_id`,`snapshot_id`) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_retention_protect_newly_retained` AFTER UPDATE OF `status`,`pinned`,`retention_class` ON `v2_backup_snapshots`
WHEN new.status='succeeded' AND (
  old.status<>'succeeded' OR (old.pinned=0 AND new.pinned=1) OR (old.retention_class<>'manual' AND new.retention_class='manual')
)
BEGIN
  INSERT INTO `v2_backup_retention_keep` (`run_id`,`user_id`,`snapshot_id`,`reason`,`chain_checked`,`created_at`)
  SELECT r.id,new.user_id,new.id,
    CASE WHEN new.pinned=1 THEN 'pinned' WHEN new.retention_class='manual' THEN 'manual' ELSE 'concurrent_snapshot' END,
    0,new.created_at
  FROM `v2_backup_retention_runs` r
  WHERE r.user_id=new.user_id AND r.status='running'
  ON CONFLICT (`run_id`,`snapshot_id`) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_dependency_insert_guard` BEFORE INSERT ON `v2_backup_snapshots`
WHEN new.status IN ('building','succeeded') AND new.base_snapshot_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM v2_backup_snapshots s WHERE s.id=new.base_snapshot_id AND s.user_id=new.user_id
      AND s.pruned_at IS NULL AND s.status IN ('succeeded','pruning')
  ) THEN RAISE(ABORT, 'backup_base_unavailable') END;
  SELECT CASE WHEN EXISTS (
    WITH RECURSIVE chain(id) AS (
      SELECT new.base_snapshot_id
      UNION
      SELECT s.base_snapshot_id FROM v2_backup_snapshots s JOIN chain c ON s.id=c.id
      WHERE s.user_id=new.user_id AND s.base_snapshot_id IS NOT NULL
    )
    SELECT 1 FROM chain c JOIN v2_backup_retention_snapshot_work w ON w.snapshot_id=c.id
    WHERE w.user_id=new.user_id AND w.status IN ('deleting_objects','marking_blobs','finalizing')
  ) THEN RAISE(ABORT, 'backup_dependency_retention_in_progress') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_dependency_update_guard` BEFORE UPDATE OF `user_id`,`status`,`base_snapshot_id` ON `v2_backup_snapshots`
WHEN new.status IN ('building','succeeded') AND new.base_snapshot_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM v2_backup_snapshots s WHERE s.id=new.base_snapshot_id AND s.user_id=new.user_id
      AND s.pruned_at IS NULL AND s.status IN ('succeeded','pruning')
  ) THEN RAISE(ABORT, 'backup_base_unavailable') END;
  SELECT CASE WHEN EXISTS (
    WITH RECURSIVE chain(id) AS (
      SELECT new.base_snapshot_id
      UNION
      SELECT s.base_snapshot_id FROM v2_backup_snapshots s JOIN chain c ON s.id=c.id
      WHERE s.user_id=new.user_id AND s.base_snapshot_id IS NOT NULL
    )
    SELECT 1 FROM chain c JOIN v2_backup_retention_snapshot_work w ON w.snapshot_id=c.id
    WHERE w.user_id=new.user_id AND w.status IN ('deleting_objects','marking_blobs','finalizing')
  ) THEN RAISE(ABORT, 'backup_dependency_retention_in_progress') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_retention_protect_updated_base` AFTER UPDATE OF `user_id`,`status`,`base_snapshot_id` ON `v2_backup_snapshots`
WHEN new.status='building' AND new.base_snapshot_id IS NOT NULL
BEGIN
  INSERT INTO `v2_backup_retention_keep` (`run_id`,`user_id`,`snapshot_id`,`reason`,`chain_checked`,`created_at`)
  SELECT r.id,new.user_id,new.base_snapshot_id,'active_backup_base',0,coalesce(new.last_progress_at,new.created_at)
  FROM `v2_backup_retention_runs` r
  WHERE r.user_id=new.user_id AND r.status='running'
  ON CONFLICT (`run_id`,`snapshot_id`) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_restore_source_insert_guard` BEFORE INSERT ON `v2_restore_batches`
WHEN new.source_kind='backup' AND new.status NOT IN ('succeeded','failed','rolled_back','rollback_conflicted')
BEGIN
  SELECT CASE WHEN EXISTS (
    WITH RECURSIVE chain(id) AS (
      SELECT new.source_ref
      UNION
      SELECT s.base_snapshot_id FROM v2_backup_snapshots s JOIN chain c ON s.id=c.id
      WHERE s.user_id=new.user_id AND s.base_snapshot_id IS NOT NULL
    )
    SELECT 1 FROM chain c JOIN v2_backup_retention_snapshot_work w ON w.snapshot_id=c.id
    WHERE w.user_id=new.user_id AND w.status IN ('deleting_objects','marking_blobs','finalizing')
  ) THEN RAISE(ABORT, 'backup_restore_source_retention_in_progress') END;
  SELECT CASE WHEN new.source_ref IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2_backup_snapshots s WHERE s.id=new.source_ref AND s.user_id=new.user_id AND s.status='succeeded' AND s.pruned_at IS NULL
  ) THEN RAISE(ABORT, 'backup_restore_source_unavailable') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_restore_source_update_guard` BEFORE UPDATE OF `user_id`,`source_kind`,`source_ref`,`status` ON `v2_restore_batches`
WHEN new.source_kind='backup' AND new.status NOT IN ('succeeded','failed','rolled_back','rollback_conflicted')
BEGIN
  SELECT CASE WHEN EXISTS (
    WITH RECURSIVE chain(id) AS (
      SELECT new.source_ref
      UNION
      SELECT s.base_snapshot_id FROM v2_backup_snapshots s JOIN chain c ON s.id=c.id
      WHERE s.user_id=new.user_id AND s.base_snapshot_id IS NOT NULL
    )
    SELECT 1 FROM chain c JOIN v2_backup_retention_snapshot_work w ON w.snapshot_id=c.id
    WHERE w.user_id=new.user_id AND w.status IN ('deleting_objects','marking_blobs','finalizing')
  ) THEN RAISE(ABORT, 'backup_restore_source_retention_in_progress') END;
  SELECT CASE WHEN new.source_ref IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2_backup_snapshots s WHERE s.id=new.source_ref AND s.user_id=new.user_id AND s.status='succeeded' AND s.pruned_at IS NULL
  ) THEN RAISE(ABORT, 'backup_restore_source_unavailable') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_restore_source_insert_keep` AFTER INSERT ON `v2_restore_batches`
WHEN new.source_kind='backup' AND new.source_ref IS NOT NULL AND new.status NOT IN ('succeeded','failed','rolled_back','rollback_conflicted')
BEGIN
  INSERT INTO `v2_backup_retention_keep` (`run_id`,`user_id`,`snapshot_id`,`reason`,`chain_checked`,`created_at`)
  SELECT r.id,new.user_id,new.source_ref,'active_restore_source',0,new.created_at
  FROM `v2_backup_retention_runs` r
  WHERE r.user_id=new.user_id AND r.status='running'
  ON CONFLICT (`run_id`,`snapshot_id`) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_restore_source_update_keep` AFTER UPDATE OF `user_id`,`source_kind`,`source_ref`,`status` ON `v2_restore_batches`
WHEN new.source_kind='backup' AND new.source_ref IS NOT NULL AND new.status NOT IN ('succeeded','failed','rolled_back','rollback_conflicted')
BEGIN
  INSERT INTO `v2_backup_retention_keep` (`run_id`,`user_id`,`snapshot_id`,`reason`,`chain_checked`,`created_at`)
  SELECT r.id,new.user_id,new.source_ref,'active_restore_source',0,new.created_at
  FROM `v2_backup_retention_runs` r
  WHERE r.user_id=new.user_id AND r.status='running'
  ON CONFLICT (`run_id`,`snapshot_id`) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_snapshot_prune_state_insert_guard` BEFORE INSERT ON `v2_backup_snapshots`
BEGIN
  SELECT CASE WHEN (new.status='pruning' AND new.prune_run_id IS NULL) OR (new.status<>'pruning' AND new.prune_run_id IS NOT NULL) THEN RAISE(ABORT, 'backup_prune_owner_invalid') END;
  SELECT CASE WHEN new.status='pruning' AND NOT EXISTS (
    SELECT 1 FROM v2_backup_retention_runs r WHERE r.id=new.prune_run_id AND r.user_id=new.user_id AND r.status='running'
  ) THEN RAISE(ABORT, 'backup_prune_owner_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_snapshot_prune_state_update_guard` BEFORE UPDATE OF `status`,`prune_run_id` ON `v2_backup_snapshots`
BEGIN
  SELECT CASE WHEN (new.status='pruning' AND new.prune_run_id IS NULL) OR (new.status<>'pruning' AND new.prune_run_id IS NOT NULL) THEN RAISE(ABORT, 'backup_prune_owner_invalid') END;
  SELECT CASE WHEN new.status='pruning' AND NOT EXISTS (
    SELECT 1 FROM v2_backup_retention_runs r WHERE r.id=new.prune_run_id AND r.user_id=new.user_id AND r.status='running'
  ) THEN RAISE(ABORT, 'backup_prune_owner_invalid') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM v2_backup_retention_snapshot_work w
    WHERE w.snapshot_id=new.id AND w.status NOT IN ('complete','cancelled')
      AND (new.status<>'pruning' OR w.run_id<>new.prune_run_id)
  ) THEN RAISE(ABORT, 'backup_prune_owner_invalid') END;
  SELECT CASE WHEN new.status='pruning' AND EXISTS (
    WITH RECURSIVE protected(id) AS (
      SELECT s.base_snapshot_id FROM v2_backup_snapshots s
      WHERE s.user_id=new.user_id AND s.status='building' AND s.base_snapshot_id IS NOT NULL
      UNION
      SELECT b.source_ref FROM v2_restore_batches b
      WHERE b.user_id=new.user_id AND b.source_kind='backup' AND b.source_ref IS NOT NULL
        AND b.status NOT IN ('succeeded','failed','rolled_back','rollback_conflicted')
      UNION
      SELECT k.snapshot_id FROM v2_backup_retention_keep k
      JOIN v2_backup_retention_runs r ON r.id=k.run_id
      WHERE k.user_id=new.user_id AND r.status='running'
      UNION
      SELECT s.base_snapshot_id FROM v2_backup_snapshots s JOIN protected p ON s.id=p.id
      WHERE s.user_id=new.user_id AND s.base_snapshot_id IS NOT NULL
    )
    SELECT 1 FROM protected WHERE id=new.id
  ) THEN RAISE(ABORT, 'backup_retention_dependency_changed') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_retention_run_terminal_guard` BEFORE UPDATE OF `status` ON `v2_backup_retention_runs`
WHEN old.status='running' AND new.status<>'running'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM v2_backup_snapshots s WHERE s.prune_run_id=old.id AND s.status='pruning'
  ) OR EXISTS (
    SELECT 1 FROM v2_backup_retention_snapshot_work w
    WHERE w.run_id=old.id AND w.status NOT IN ('complete','cancelled')
  ) THEN RAISE(ABORT, 'backup_retention_terminal_orphan') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_backup_retention_run_delete_guard` BEFORE DELETE ON `v2_backup_retention_runs`
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM v2_backup_snapshots s WHERE s.prune_run_id=old.id AND s.status='pruning'
  ) OR EXISTS (
    SELECT 1 FROM v2_backup_retention_snapshot_work w
    WHERE w.run_id=old.id AND w.status NOT IN ('complete','cancelled')
  ) THEN RAISE(ABORT, 'backup_retention_terminal_orphan') END;
END;
