CREATE TABLE `v2_workflow_lease_assertions` (
  `assertion_id` text PRIMARY KEY NOT NULL,
  `workflow_kind` text NOT NULL CHECK (`workflow_kind` IN ('backup','restore')),
  `workflow_id` text NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `lease_token` text NOT NULL,
  `state_revision` integer NOT NULL CHECK (`state_revision`>=0),
  `expected_status` text NOT NULL,
  `next_status` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint

CREATE TRIGGER `trg_v2_workflow_lease_assertion_insert` BEFORE INSERT ON `v2_workflow_lease_assertions`
BEGIN
  SELECT CASE WHEN new.workflow_kind='backup' AND NOT EXISTS (
    SELECT 1 FROM v2_backup_snapshots s
    WHERE s.id=new.workflow_id AND s.user_id=new.user_id AND s.workflow_version>=2
      AND s.status=new.expected_status AND s.lease_token=new.lease_token
      AND s.lease_expires_at IS NOT NULL AND s.state_revision=new.state_revision
  ) THEN RAISE(ABORT, 'backup_workflow_lease_lost') END;
  SELECT CASE WHEN new.workflow_kind='restore' AND NOT EXISTS (
    SELECT 1 FROM v2_restore_batches b
    WHERE b.id=new.workflow_id AND b.user_id=new.user_id AND b.workflow_version>=2
      AND b.status=new.expected_status AND b.lease_token=new.lease_token
      AND b.lease_expires_at IS NOT NULL AND b.state_revision=new.state_revision
  ) THEN RAISE(ABORT, 'restore_workflow_lease_lost') END;
END;
--> statement-breakpoint

CREATE TRIGGER `trg_v2_workflow_lease_assertion_delete` BEFORE DELETE ON `v2_workflow_lease_assertions`
BEGIN
  SELECT CASE WHEN old.workflow_kind='backup' AND NOT EXISTS (
    SELECT 1 FROM v2_backup_snapshots s
    WHERE s.id=old.workflow_id AND s.user_id=old.user_id AND s.workflow_version>=2
      AND s.status=old.next_status AND s.lease_token IS NULL AND s.lease_expires_at IS NULL
      AND s.state_revision=old.state_revision+1
  ) THEN RAISE(ABORT, 'backup_workflow_progress_not_committed') END;
  SELECT CASE WHEN old.workflow_kind='restore' AND NOT EXISTS (
    SELECT 1 FROM v2_restore_batches b
    WHERE b.id=old.workflow_id AND b.user_id=old.user_id AND b.workflow_version>=2
      AND b.status=old.next_status AND b.lease_token IS NULL AND b.lease_expires_at IS NULL
      AND b.state_revision=old.state_revision+1
  ) THEN RAISE(ABORT, 'restore_workflow_progress_not_committed') END;
END;
--> statement-breakpoint

CREATE TABLE `v2_restore_transition_assertions` (
  `assertion_id` text PRIMARY KEY NOT NULL,
  `restore_id` text NOT NULL REFERENCES `v2_restore_batches`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `expected_revision` integer NOT NULL CHECK (`expected_revision`>=0),
  `expected_status` text NOT NULL,
  `next_status` text NOT NULL,
  `require_unleased` integer NOT NULL CHECK (`require_unleased` IN (0,1)),
  `created_at` text NOT NULL
);
--> statement-breakpoint

CREATE TRIGGER `trg_v2_restore_transition_assertion_insert` BEFORE INSERT ON `v2_restore_transition_assertions`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM v2_restore_batches b
    WHERE b.id=new.restore_id AND b.user_id=new.user_id AND b.workflow_version>=2
      AND b.status=new.expected_status AND b.state_revision=new.expected_revision
      AND (new.require_unleased=0 OR (b.lease_token IS NULL AND b.lease_expires_at IS NULL))
  ) THEN RAISE(ABORT, 'restore_transition_lost') END;
END;
--> statement-breakpoint

CREATE TRIGGER `trg_v2_restore_transition_assertion_delete` BEFORE DELETE ON `v2_restore_transition_assertions`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM v2_restore_batches b
    WHERE b.id=old.restore_id AND b.user_id=old.user_id
      AND b.status=old.next_status AND b.state_revision=old.expected_revision+1
      AND b.lease_token IS NULL AND b.lease_expires_at IS NULL
  ) THEN RAISE(ABORT, 'restore_transition_not_committed') END;
END;
--> statement-breakpoint

CREATE TABLE `v2_restore_generation_cleanup_receipts` (
  `restore_id` text NOT NULL REFERENCES `v2_restore_batches`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `object_key` text NOT NULL,
  `armed_at` text,
  `not_before` text,
  `first_deleted_at` text,
  `delete_attempt_count` integer NOT NULL DEFAULT 0 CHECK (`delete_attempt_count`>=0),
  `created_at` text NOT NULL,
  PRIMARY KEY (`restore_id`,`object_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_restore_generation_cleanup_due` ON `v2_restore_generation_cleanup_receipts` (`not_before`,`restore_id`);
--> statement-breakpoint
CREATE TRIGGER `trg_v2_restore_generation_cleanup_insert` BEFORE INSERT ON `v2_restore_generation_cleanup_receipts`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_restore_batches b WHERE b.id=new.restore_id AND b.user_id=new.user_id)
    THEN RAISE(ABORT, 'restore_generation_owner_invalid') END;
  SELECT CASE WHEN new.object_key NOT LIKE '%/restore-generations/%' OR instr(new.object_key,'/restore-generations/' || new.restore_id || '/')=0
    THEN RAISE(ABORT, 'restore_generation_key_invalid') END;
  SELECT CASE WHEN instr(new.object_key,'/attempts/')=0 OR NOT EXISTS (
    SELECT 1 FROM v2_restore_batches b
    WHERE b.id=new.restore_id AND b.user_id=new.user_id AND b.lease_token IS NOT NULL
      AND substr(new.object_key,length(new.object_key)-length(b.lease_token)+1)=b.lease_token
  ) THEN RAISE(ABORT, 'restore_generation_lease_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_restore_generation_cleanup_update` BEFORE UPDATE ON `v2_restore_generation_cleanup_receipts`
BEGIN
  SELECT CASE WHEN new.restore_id<>old.restore_id OR new.user_id<>old.user_id OR new.object_key<>old.object_key OR new.created_at<>old.created_at
    THEN RAISE(ABORT, 'restore_generation_receipt_immutable') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_restore_batches b WHERE b.id=new.restore_id AND b.user_id=new.user_id)
    THEN RAISE(ABORT, 'restore_generation_owner_invalid') END;
  SELECT CASE WHEN new.object_key NOT LIKE '%/restore-generations/%' OR instr(new.object_key,'/restore-generations/' || new.restore_id || '/')=0
    THEN RAISE(ABORT, 'restore_generation_key_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_restore_generation_adoption_insert` BEFORE INSERT ON `v2_attachment_reservations`
WHEN new.object_key LIKE '%/restore-generations/%/attempts/%'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM v2_restore_generation_cleanup_receipts r
    WHERE r.user_id=new.user_id AND r.object_key=new.object_key AND r.armed_at IS NULL
  ) THEN RAISE(ABORT, 'restore_generation_adoption_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_restore_generation_adoption_update` BEFORE UPDATE OF object_key,user_id ON `v2_attachment_reservations`
WHEN new.object_key LIKE '%/restore-generations/%/attempts/%' AND (new.object_key<>old.object_key OR new.user_id<>old.user_id)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM v2_restore_generation_cleanup_receipts r
    WHERE r.user_id=new.user_id AND r.object_key=new.object_key AND r.armed_at IS NULL
  ) THEN RAISE(ABORT, 'restore_generation_adoption_invalid') END;
END;
