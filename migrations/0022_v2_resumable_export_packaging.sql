ALTER TABLE `v2_export_jobs` ADD COLUMN `workflow_version` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `v2_export_jobs` ADD COLUMN `build_phase` text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE `v2_export_jobs` ADD COLUMN `cursor_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE `v2_export_jobs` ADD COLUMN `state_revision` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `v2_export_jobs` ADD COLUMN `lease_token` text;
--> statement-breakpoint
ALTER TABLE `v2_export_jobs` ADD COLUMN `lease_expires_at` text;
--> statement-breakpoint
ALTER TABLE `v2_export_jobs` ADD COLUMN `last_progress_at` text;
--> statement-breakpoint
ALTER TABLE `v2_export_jobs` ADD COLUMN `upload_id` text;
--> statement-breakpoint
ALTER TABLE `v2_export_jobs` ADD COLUMN `next_part_number` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `v2_export_jobs` ADD COLUMN `pending_object_key` text;
--> statement-breakpoint
ALTER TABLE `v2_export_jobs` ADD COLUMN `pending_size_bytes` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `v2_export_jobs` ADD COLUMN `pending_sha256` text;
--> statement-breakpoint
ALTER TABLE `v2_export_jobs` ADD COLUMN `zip_size_bytes` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `v2_export_jobs` ADD COLUMN `zip_sha256_state_json` text;
--> statement-breakpoint
ALTER TABLE `v2_export_jobs` ADD COLUMN `entry_count` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX `idx_v2_export_resume` ON `v2_export_jobs` (`user_id`,`status`,`build_phase`,`lease_expires_at`,`last_progress_at`);
--> statement-breakpoint

CREATE TABLE `v2_export_files` (
  `export_id` text NOT NULL REFERENCES `v2_export_jobs`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `ordinal` integer NOT NULL,
  `entry_kind` text NOT NULL,
  `table_name` text,
  `source_ref` text,
  `path` text NOT NULL,
  `media_type` text NOT NULL,
  `include_in_manifest` integer NOT NULL DEFAULT 1,
  `local_offset` integer NOT NULL,
  `size_bytes` integer NOT NULL,
  `crc32` integer NOT NULL,
  `sha256` text NOT NULL,
  `record_count` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL,
  `completed_at` text NOT NULL,
  PRIMARY KEY (`export_id`,`path`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_export_file_ordinal` ON `v2_export_files` (`export_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `idx_v2_export_file_manifest` ON `v2_export_files` (`export_id`,`include_in_manifest`,`ordinal`);
--> statement-breakpoint

CREATE TABLE `v2_export_multipart_parts` (
  `export_id` text NOT NULL REFERENCES `v2_export_jobs`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `part_number` integer NOT NULL,
  `etag` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `sha256` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`export_id`,`part_number`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_export_part_resume` ON `v2_export_multipart_parts` (`export_id`,`part_number`);
--> statement-breakpoint

-- Pending objects are constrained to the global export-pending/ R2 prefix so
-- operators can apply a short-lived lifecycle rule or a bounded list sweep.
CREATE TABLE `v2_export_pending_segments` (
  `export_id` text NOT NULL REFERENCES `v2_export_jobs`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `object_key` text NOT NULL,
  `lease_token` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `sha256` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`export_id`,`object_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_export_pending_segment_cleanup` ON `v2_export_pending_segments` (`export_id`,`created_at`,`object_key`);
--> statement-breakpoint

CREATE TRIGGER `trg_v2_export_workflow_integrity_insert` BEFORE INSERT ON `v2_export_jobs`
WHEN new.workflow_version>=2
BEGIN
  SELECT CASE WHEN new.build_phase NOT IN ('staging','packaging','central_directory','finalizing','verifying','failure_cleanup','complete') OR json_valid(new.cursor_json)<>1 THEN RAISE(ABORT, 'export_cursor_invalid') END;
  SELECT CASE WHEN new.state_revision<0 OR new.next_part_number<1 OR new.next_part_number>10001 OR new.pending_size_bytes<0 OR new.zip_size_bytes<0 OR new.zip_size_bytes>4294967295 OR new.entry_count<0 OR new.entry_count>65535 THEN RAISE(ABORT, 'export_progress_invalid') END;
  SELECT CASE WHEN (new.lease_token IS NULL)<>(new.lease_expires_at IS NULL) THEN RAISE(ABORT, 'export_lease_invalid') END;
  SELECT CASE WHEN (new.pending_size_bytes=0 AND (new.pending_object_key IS NOT NULL OR new.pending_sha256 IS NOT NULL)) OR (new.pending_size_bytes>0 AND (new.pending_object_key IS NULL OR new.pending_sha256 IS NULL OR length(new.pending_sha256)<>64 OR new.pending_sha256 GLOB '*[^0-9a-f]*')) THEN RAISE(ABORT, 'export_pending_segment_invalid') END;
  SELECT CASE WHEN new.zip_sha256_state_json IS NOT NULL AND (json_valid(new.zip_sha256_state_json)<>1 OR json_type(new.zip_sha256_state_json,'$.words')<>'array' OR json_array_length(json_extract(new.zip_sha256_state_json,'$.words'))<>8 OR EXISTS (SELECT 1 FROM json_each(json_extract(new.zip_sha256_state_json,'$.words')) word WHERE word.type<>'integer' OR cast(word.value AS integer)<0 OR cast(word.value AS integer)>4294967295) OR json_type(new.zip_sha256_state_json,'$.bufferHex')<>'text' OR length(json_extract(new.zip_sha256_state_json,'$.bufferHex'))>126 OR length(json_extract(new.zip_sha256_state_json,'$.bufferHex'))%2<>0 OR json_extract(new.zip_sha256_state_json,'$.bufferHex') GLOB '*[^0-9a-f]*' OR json_type(new.zip_sha256_state_json,'$.totalBytes')<>'integer' OR cast(json_extract(new.zip_sha256_state_json,'$.totalBytes') AS integer)<>new.zip_size_bytes) THEN RAISE(ABORT, 'export_hash_state_invalid') END;
  SELECT CASE WHEN new.build_phase NOT IN ('staging','failure_cleanup') AND new.status<>'failed' AND new.zip_sha256_state_json IS NULL THEN RAISE(ABORT, 'export_hash_state_missing') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_export_workflow_integrity_update` BEFORE UPDATE ON `v2_export_jobs`
WHEN new.workflow_version>=2
BEGIN
  SELECT CASE WHEN new.build_phase NOT IN ('staging','packaging','central_directory','finalizing','verifying','failure_cleanup','complete') OR json_valid(new.cursor_json)<>1 THEN RAISE(ABORT, 'export_cursor_invalid') END;
  SELECT CASE WHEN new.state_revision<0 OR new.next_part_number<1 OR new.next_part_number>10001 OR new.pending_size_bytes<0 OR new.zip_size_bytes<0 OR new.zip_size_bytes>4294967295 OR new.entry_count<0 OR new.entry_count>65535 THEN RAISE(ABORT, 'export_progress_invalid') END;
  SELECT CASE WHEN (new.lease_token IS NULL)<>(new.lease_expires_at IS NULL) THEN RAISE(ABORT, 'export_lease_invalid') END;
  SELECT CASE WHEN (new.pending_size_bytes=0 AND (new.pending_object_key IS NOT NULL OR new.pending_sha256 IS NOT NULL)) OR (new.pending_size_bytes>0 AND (new.pending_object_key IS NULL OR new.pending_sha256 IS NULL OR length(new.pending_sha256)<>64 OR new.pending_sha256 GLOB '*[^0-9a-f]*')) THEN RAISE(ABORT, 'export_pending_segment_invalid') END;
  SELECT CASE WHEN new.zip_sha256_state_json IS NOT NULL AND (json_valid(new.zip_sha256_state_json)<>1 OR json_type(new.zip_sha256_state_json,'$.words')<>'array' OR json_array_length(json_extract(new.zip_sha256_state_json,'$.words'))<>8 OR EXISTS (SELECT 1 FROM json_each(json_extract(new.zip_sha256_state_json,'$.words')) word WHERE word.type<>'integer' OR cast(word.value AS integer)<0 OR cast(word.value AS integer)>4294967295) OR json_type(new.zip_sha256_state_json,'$.bufferHex')<>'text' OR length(json_extract(new.zip_sha256_state_json,'$.bufferHex'))>126 OR length(json_extract(new.zip_sha256_state_json,'$.bufferHex'))%2<>0 OR json_extract(new.zip_sha256_state_json,'$.bufferHex') GLOB '*[^0-9a-f]*' OR json_type(new.zip_sha256_state_json,'$.totalBytes')<>'integer' OR cast(json_extract(new.zip_sha256_state_json,'$.totalBytes') AS integer)<>new.zip_size_bytes) THEN RAISE(ABORT, 'export_hash_state_invalid') END;
  SELECT CASE WHEN new.build_phase NOT IN ('staging','failure_cleanup') AND new.status<>'failed' AND new.zip_sha256_state_json IS NULL THEN RAISE(ABORT, 'export_hash_state_missing') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_export_succeeded_guard` BEFORE UPDATE OF `status` ON `v2_export_jobs`
WHEN new.workflow_version>=2 AND new.status='succeeded'
BEGIN
  SELECT CASE WHEN new.build_phase<>'complete' OR new.upload_id IS NULL OR new.pending_size_bytes<>0 OR new.pending_object_key IS NOT NULL OR new.pending_sha256 IS NOT NULL OR EXISTS (SELECT 1 FROM v2_export_pending_segments s WHERE s.export_id=new.id) OR new.bundle_object_key IS NULL OR new.bundle_sha256 IS NULL OR length(new.bundle_sha256)<>64 OR new.bundle_sha256 GLOB '*[^0-9a-f]*' OR new.bundle_size_bytes IS NULL OR new.bundle_size_bytes<>new.zip_size_bytes OR new.manifest_json IS NULL OR json_valid(new.manifest_json)<>1 OR new.finished_at IS NULL OR new.expires_at IS NULL OR new.lease_token IS NOT NULL OR new.lease_expires_at IS NOT NULL THEN RAISE(ABORT, 'export_completion_receipt_incomplete') END;
  SELECT CASE WHEN (SELECT count(*) FROM v2_export_multipart_parts p WHERE p.export_id=new.id) NOT BETWEEN 1 AND 10000 OR new.next_part_number<>(SELECT count(*)+1 FROM v2_export_multipart_parts p WHERE p.export_id=new.id) OR (SELECT min(p.part_number) FROM v2_export_multipart_parts p WHERE p.export_id=new.id)<>1 OR (SELECT max(p.part_number) FROM v2_export_multipart_parts p WHERE p.export_id=new.id)<>(SELECT count(*) FROM v2_export_multipart_parts p WHERE p.export_id=new.id) OR EXISTS (SELECT 1 FROM v2_export_multipart_parts p WHERE p.export_id=new.id AND (p.user_id<>new.user_id OR p.part_number<1 OR p.size_bytes<=0 OR length(p.sha256)<>64 OR p.sha256 GLOB '*[^0-9a-f]*')) OR EXISTS (SELECT 1 FROM v2_export_multipart_parts p WHERE p.export_id=new.id AND p.part_number<(SELECT max(last_part.part_number) FROM v2_export_multipart_parts last_part WHERE last_part.export_id=new.id) AND p.size_bytes<>8388608) OR (SELECT coalesce(sum(p.size_bytes),0) FROM v2_export_multipart_parts p WHERE p.export_id=new.id)<>new.zip_size_bytes THEN RAISE(ABORT, 'export_multipart_receipt_incomplete') END;
  SELECT CASE WHEN new.entry_count<>(SELECT count(*) FROM v2_export_files f WHERE f.export_id=new.id) OR (new.entry_count>0 AND ((SELECT min(f.ordinal) FROM v2_export_files f WHERE f.export_id=new.id)<>0 OR (SELECT max(f.ordinal) FROM v2_export_files f WHERE f.export_id=new.id)<>new.entry_count-1)) OR EXISTS (SELECT 1 FROM v2_export_files f WHERE f.export_id=new.id AND (f.user_id<>new.user_id OR f.ordinal<0 OR f.path='' OR f.media_type='' OR f.local_offset<0 OR f.local_offset>=new.zip_size_bytes OR f.size_bytes<0 OR f.record_count<0 OR f.crc32<0 OR f.crc32>4294967295 OR f.local_offset+30+length(cast(f.path AS blob))+f.size_bytes+16>new.zip_size_bytes OR length(f.sha256)<>64 OR f.sha256 GLOB '*[^0-9a-f]*')) THEN RAISE(ABORT, 'export_file_receipt_incomplete') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_export_file_user_guard` BEFORE INSERT ON `v2_export_files`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_export_jobs j WHERE j.id=new.export_id AND j.user_id=new.user_id AND j.workflow_version>=2) THEN RAISE(ABORT, 'export_file_user_mismatch') END;
  SELECT CASE WHEN new.ordinal<0 OR new.ordinal>65534 OR new.path='' OR new.media_type='' OR new.local_offset<0 OR new.size_bytes<0 OR new.record_count<0 OR new.crc32<0 OR new.crc32>4294967295 OR new.include_in_manifest NOT IN (0,1) OR length(new.sha256)<>64 OR new.sha256 GLOB '*[^0-9a-f]*' THEN RAISE(ABORT, 'export_file_receipt_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_export_part_user_guard` BEFORE INSERT ON `v2_export_multipart_parts`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_export_jobs j WHERE j.id=new.export_id AND j.user_id=new.user_id AND j.workflow_version>=2) THEN RAISE(ABORT, 'export_part_user_mismatch') END;
  SELECT CASE WHEN new.part_number<1 OR new.part_number>10000 OR new.size_bytes<=0 OR new.etag='' OR length(new.sha256)<>64 OR new.sha256 GLOB '*[^0-9a-f]*' THEN RAISE(ABORT, 'export_part_receipt_invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_export_pending_segment_guard` BEFORE INSERT ON `v2_export_pending_segments`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_export_jobs j WHERE j.id=new.export_id AND j.user_id=new.user_id AND j.workflow_version>=2) THEN RAISE(ABORT, 'export_pending_segment_user_mismatch') END;
  SELECT CASE WHEN new.object_key NOT LIKE 'export-pending/%' OR new.lease_token='' OR new.size_bytes<=0 OR length(new.sha256)<>64 OR new.sha256 GLOB '*[^0-9a-f]*' THEN RAISE(ABORT, 'export_pending_segment_receipt_invalid') END;
END;
