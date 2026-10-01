CREATE TABLE `v2_restore_uploads` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `idempotency_key` text NOT NULL,
  `file_name` text NOT NULL,
  `expected_size_bytes` integer NOT NULL,
  `expected_archive_sha256` text NOT NULL,
  `part_size_bytes` integer NOT NULL DEFAULT 8388608,
  `expected_part_count` integer NOT NULL,
  `status` text NOT NULL DEFAULT 'uploading',
  `phase` text NOT NULL DEFAULT 'receiving',
  `cursor_json` text NOT NULL DEFAULT '{}',
  `uploaded_bytes` integer NOT NULL DEFAULT 0,
  `hash_verified_bytes` integer NOT NULL DEFAULT 0,
  `final_object_key` text NOT NULL,
  `multipart_upload_id` text,
  `restore_batch_id` text REFERENCES `v2_restore_batches`(`id`) ON DELETE SET NULL,
  `state_revision` integer NOT NULL DEFAULT 0,
  `lease_token` text,
  `lease_expires_at` text,
  `failure_code` text,
  `created_at` text NOT NULL,
  `last_progress_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_restore_upload_user_idempotency` ON `v2_restore_uploads` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_v2_restore_upload_resume` ON `v2_restore_uploads` (`user_id`,`status`,`lease_expires_at`,`last_progress_at`);
--> statement-breakpoint
CREATE INDEX `idx_v2_restore_upload_expiry` ON `v2_restore_uploads` (`status`,`expires_at`,`lease_expires_at`);
--> statement-breakpoint

CREATE TABLE `v2_restore_upload_parts` (
  `upload_id` text NOT NULL REFERENCES `v2_restore_uploads`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `part_number` integer NOT NULL,
  `size_bytes` integer NOT NULL,
  `sha256` text NOT NULL,
  `temp_object_key` text NOT NULL,
  `multipart_etag` text,
  `created_at` text NOT NULL,
  `temp_deleted_at` text,
  PRIMARY KEY (`upload_id`,`part_number`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_restore_upload_part_resume` ON `v2_restore_upload_parts` (`upload_id`,`multipart_etag`,`part_number`);
--> statement-breakpoint
CREATE INDEX `idx_v2_restore_upload_part_cleanup` ON `v2_restore_upload_parts` (`upload_id`,`temp_deleted_at`,`part_number`);
--> statement-breakpoint

CREATE TRIGGER `trg_v2_restore_upload_integrity_insert` BEFORE INSERT ON `v2_restore_uploads`
BEGIN
  SELECT CASE WHEN new.file_name='' OR length(new.file_name)>255 THEN RAISE(ABORT, 'restore_upload_name_invalid') END;
  SELECT CASE WHEN new.expected_size_bytes<=0 OR new.expected_size_bytes>=4294967296 THEN RAISE(ABORT, 'restore_upload_size_invalid') END;
  SELECT CASE WHEN new.part_size_bytes<>8388608 OR new.expected_part_count<>((new.expected_size_bytes+new.part_size_bytes-1)/new.part_size_bytes) OR new.expected_part_count<1 OR new.expected_part_count>512 THEN RAISE(ABORT, 'restore_upload_parts_invalid') END;
  SELECT CASE WHEN length(new.expected_archive_sha256)<>64 OR new.expected_archive_sha256 GLOB '*[^0-9a-f]*' THEN RAISE(ABORT, 'restore_upload_hash_invalid') END;
  SELECT CASE WHEN json_valid(new.cursor_json)<>1 OR new.uploaded_bytes<0 OR new.uploaded_bytes>new.expected_size_bytes OR new.hash_verified_bytes<0 OR new.hash_verified_bytes>new.expected_size_bytes OR new.state_revision<0 THEN RAISE(ABORT, 'restore_upload_progress_invalid') END;
  SELECT CASE WHEN (new.lease_token IS NULL)<>(new.lease_expires_at IS NULL) THEN RAISE(ABORT, 'restore_upload_lease_invalid') END;
  SELECT CASE WHEN new.restore_batch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM v2_restore_batches b WHERE b.id=new.restore_batch_id AND b.user_id=new.user_id) THEN RAISE(ABORT, 'restore_upload_batch_user_mismatch') END;
  SELECT CASE WHEN NOT (
    (new.status='uploading' AND new.phase='receiving') OR
    (new.status='verifying' AND new.phase='hashing') OR
    (new.status='assembling' AND new.phase IN ('creating_multipart','uploading_parts','completing','staging')) OR
    (new.status='cleaning' AND new.phase='cleanup') OR
    (new.status='staged' AND new.phase='complete') OR
    (new.status='aborting' AND new.phase='aborting') OR
    (new.status IN ('aborted','expired','failed') AND new.phase='complete')
  ) THEN RAISE(ABORT, 'restore_upload_state_invalid') END;
  SELECT CASE WHEN new.status='staged' AND (
    new.restore_batch_id IS NULL OR new.uploaded_bytes<>new.expected_size_bytes OR new.hash_verified_bytes<>new.expected_size_bytes OR
    new.lease_token IS NOT NULL OR new.finished_at IS NULL OR
    (SELECT count(*) FROM v2_restore_upload_parts p WHERE p.upload_id=new.id)<>new.expected_part_count OR
    EXISTS (SELECT 1 FROM v2_restore_upload_parts p WHERE p.upload_id=new.id AND (p.multipart_etag IS NULL OR p.temp_deleted_at IS NULL))
  ) THEN RAISE(ABORT, 'restore_upload_staged_incomplete') END;
  SELECT CASE WHEN new.status IN ('aborted','expired','failed') AND (
    new.multipart_upload_id IS NOT NULL OR new.lease_token IS NOT NULL OR new.finished_at IS NULL OR
    EXISTS (SELECT 1 FROM v2_restore_upload_parts p WHERE p.upload_id=new.id AND p.temp_deleted_at IS NULL)
  ) THEN RAISE(ABORT, 'restore_upload_terminal_incomplete') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_restore_upload_integrity_update` BEFORE UPDATE ON `v2_restore_uploads`
BEGIN
  SELECT CASE WHEN new.file_name='' OR length(new.file_name)>255 THEN RAISE(ABORT, 'restore_upload_name_invalid') END;
  SELECT CASE WHEN new.expected_size_bytes<=0 OR new.expected_size_bytes>=4294967296 THEN RAISE(ABORT, 'restore_upload_size_invalid') END;
  SELECT CASE WHEN new.part_size_bytes<>8388608 OR new.expected_part_count<>((new.expected_size_bytes+new.part_size_bytes-1)/new.part_size_bytes) OR new.expected_part_count<1 OR new.expected_part_count>512 THEN RAISE(ABORT, 'restore_upload_parts_invalid') END;
  SELECT CASE WHEN length(new.expected_archive_sha256)<>64 OR new.expected_archive_sha256 GLOB '*[^0-9a-f]*' THEN RAISE(ABORT, 'restore_upload_hash_invalid') END;
  SELECT CASE WHEN json_valid(new.cursor_json)<>1 OR new.uploaded_bytes<0 OR new.uploaded_bytes>new.expected_size_bytes OR new.hash_verified_bytes<0 OR new.hash_verified_bytes>new.expected_size_bytes OR new.state_revision<0 THEN RAISE(ABORT, 'restore_upload_progress_invalid') END;
  SELECT CASE WHEN (new.lease_token IS NULL)<>(new.lease_expires_at IS NULL) THEN RAISE(ABORT, 'restore_upload_lease_invalid') END;
  SELECT CASE WHEN new.restore_batch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM v2_restore_batches b WHERE b.id=new.restore_batch_id AND b.user_id=new.user_id) THEN RAISE(ABORT, 'restore_upload_batch_user_mismatch') END;
  SELECT CASE WHEN NOT (
    (new.status='uploading' AND new.phase='receiving') OR
    (new.status='verifying' AND new.phase='hashing') OR
    (new.status='assembling' AND new.phase IN ('creating_multipart','uploading_parts','completing','staging')) OR
    (new.status='cleaning' AND new.phase='cleanup') OR
    (new.status='staged' AND new.phase='complete') OR
    (new.status='aborting' AND new.phase='aborting') OR
    (new.status IN ('aborted','expired','failed') AND new.phase='complete')
  ) THEN RAISE(ABORT, 'restore_upload_state_invalid') END;
  SELECT CASE WHEN new.status='staged' AND (
    new.restore_batch_id IS NULL OR new.uploaded_bytes<>new.expected_size_bytes OR new.hash_verified_bytes<>new.expected_size_bytes OR
    new.lease_token IS NOT NULL OR new.finished_at IS NULL OR
    (SELECT count(*) FROM v2_restore_upload_parts p WHERE p.upload_id=new.id)<>new.expected_part_count OR
    EXISTS (SELECT 1 FROM v2_restore_upload_parts p WHERE p.upload_id=new.id AND (p.multipart_etag IS NULL OR p.temp_deleted_at IS NULL))
  ) THEN RAISE(ABORT, 'restore_upload_staged_incomplete') END;
  SELECT CASE WHEN new.status IN ('aborted','expired','failed') AND (
    new.multipart_upload_id IS NOT NULL OR new.lease_token IS NOT NULL OR new.finished_at IS NULL OR
    EXISTS (SELECT 1 FROM v2_restore_upload_parts p WHERE p.upload_id=new.id AND p.temp_deleted_at IS NULL)
  ) THEN RAISE(ABORT, 'restore_upload_terminal_incomplete') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_restore_upload_part_guard` BEFORE INSERT ON `v2_restore_upload_parts`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_restore_uploads u WHERE u.id=new.upload_id AND u.user_id=new.user_id) THEN RAISE(ABORT, 'restore_upload_part_user_mismatch') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_restore_uploads u WHERE u.id=new.upload_id AND u.status='uploading' AND u.phase='receiving') THEN RAISE(ABORT, 'restore_upload_part_state_invalid') END;
  SELECT CASE WHEN new.part_number<1 OR new.part_number>(SELECT expected_part_count FROM v2_restore_uploads WHERE id=new.upload_id) THEN RAISE(ABORT, 'restore_upload_part_number_invalid') END;
  SELECT CASE WHEN new.size_bytes<>(SELECT CASE WHEN new.part_number<expected_part_count THEN part_size_bytes ELSE expected_size_bytes-(expected_part_count-1)*part_size_bytes END FROM v2_restore_uploads WHERE id=new.upload_id) THEN RAISE(ABORT, 'restore_upload_part_size_invalid') END;
  SELECT CASE WHEN length(new.sha256)<>64 OR new.sha256 GLOB '*[^0-9a-f]*' OR new.temp_object_key='' THEN RAISE(ABORT, 'restore_upload_part_receipt_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_restore_upload_part_immutable` BEFORE UPDATE ON `v2_restore_upload_parts`
BEGIN
  SELECT CASE WHEN
    new.upload_id<>old.upload_id OR new.user_id<>old.user_id OR new.part_number<>old.part_number OR
    new.size_bytes<>old.size_bytes OR new.sha256<>old.sha256 OR new.temp_object_key<>old.temp_object_key OR
    new.created_at<>old.created_at
  THEN RAISE(ABORT, 'restore_upload_part_receipt_immutable') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_restore_uploads u WHERE u.id=new.upload_id AND u.user_id=new.user_id) THEN RAISE(ABORT, 'restore_upload_part_user_mismatch') END;
END;
