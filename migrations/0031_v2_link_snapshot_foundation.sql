CREATE TABLE v2_link_snapshots (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE cascade,
  document_object_id text NOT NULL REFERENCES v2_objects(id) ON DELETE cascade,
  capture_id text NOT NULL REFERENCES v2_capture_bundles(id) ON DELETE cascade,
  parent_snapshot_id text REFERENCES v2_link_snapshots(id),
  snapshot_version integer NOT NULL CHECK (snapshot_version >= 1),
  manifest_version text NOT NULL CHECK (manifest_version = 'link-source-manifest.v1'),
  manifest_hash text NOT NULL CHECK (length(manifest_hash)=64),
  acquisition_method text NOT NULL CHECK (acquisition_method IN ('user_paste','user_upload','api','public_fetch')),
  adapter_version text NOT NULL,
  capture_state text NOT NULL CHECK (capture_state IN ('link_only','partial','captured','needs_input','unavailable')),
  coverage_json text NOT NULL CHECK (json_valid(coverage_json)),
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_v2_link_snapshot_version ON v2_link_snapshots(document_object_id,snapshot_version);
--> statement-breakpoint
CREATE INDEX idx_v2_link_snapshot_owner_document ON v2_link_snapshots(user_id,document_object_id,created_at);
--> statement-breakpoint
CREATE TABLE v2_link_snapshot_sources (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE cascade,
  snapshot_id text NOT NULL REFERENCES v2_link_snapshots(id) ON DELETE cascade,
  source_item_id text NOT NULL REFERENCES v2_source_items(id),
  member_key text NOT NULL,
  source_order integer NOT NULL CHECK (source_order >= 0),
  source_fingerprint text NOT NULL CHECK (length(source_fingerprint)=64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_v2_link_snapshot_member_key ON v2_link_snapshot_sources(snapshot_id,member_key);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_v2_link_snapshot_member_order ON v2_link_snapshot_sources(snapshot_id,source_order);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_v2_link_snapshot_member_source ON v2_link_snapshot_sources(snapshot_id,source_item_id);
--> statement-breakpoint
CREATE INDEX idx_v2_link_snapshot_member_owner ON v2_link_snapshot_sources(user_id,snapshot_id);
--> statement-breakpoint
ALTER TABLE v2_documents ADD COLUMN current_link_snapshot_id text;
--> statement-breakpoint
ALTER TABLE v2_documents ADD COLUMN link_snapshot_version integer NOT NULL DEFAULT 0 CHECK (link_snapshot_version >= 0);
--> statement-breakpoint
ALTER TABLE v2_documents ADD COLUMN published_link_run_id text;
--> statement-breakpoint
ALTER TABLE v2_processing_jobs ADD COLUMN input_link_snapshot_id text REFERENCES v2_link_snapshots(id);
--> statement-breakpoint
ALTER TABLE v2_processing_jobs ADD COLUMN input_source_manifest_hash text;
--> statement-breakpoint
ALTER TABLE v2_processing_jobs ADD COLUMN input_source_manifest_version text;
--> statement-breakpoint
CREATE INDEX idx_v2_job_link_snapshot ON v2_processing_jobs(user_id,input_link_snapshot_id,status);
--> statement-breakpoint
CREATE TABLE v2_link_fragments (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE cascade,
  document_object_id text NOT NULL REFERENCES v2_objects(id) ON DELETE cascade,
  snapshot_id text NOT NULL REFERENCES v2_link_snapshots(id) ON DELETE cascade,
  primary_member_id text NOT NULL REFERENCES v2_link_snapshot_sources(id),
  processing_run_id text REFERENCES v2_processing_runs(id),
  fragment_key text NOT NULL,
  role text NOT NULL CHECK (role IN ('prompt','negative_prompt','parameters','quote','insight','visual_tip','transcript','caption')),
  source_class text NOT NULL CHECK (source_class IN ('source_extract','ai_interpretation','user_assertion')),
  text_start integer,
  text_end integer,
  raw_text text,
  raw_text_hash text,
  derived_text text,
  details_json text NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  completeness text NOT NULL CHECK (completeness IN ('complete','partial','truncated','ocr_unverified','selection_unverified','unknown')),
  display_order integer NOT NULL CHECK (display_order >= 0),
  review_status text NOT NULL CHECK (review_status IN ('proposed','confirmed','rejected','superseded')),
  locked_by_user integer NOT NULL DEFAULT 0 CHECK (locked_by_user IN (0,1)),
  state_version integer NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  created_at text NOT NULL,
  CHECK ((text_start IS NULL AND text_end IS NULL) OR (text_start IS NOT NULL AND text_end IS NOT NULL AND text_start >= 0 AND text_end > text_start)),
  CHECK ((raw_text IS NULL AND raw_text_hash IS NULL) OR (raw_text IS NOT NULL AND raw_text_hash IS NOT NULL AND length(raw_text_hash)=64)),
  CHECK (source_class<>'source_extract' OR (raw_text IS NOT NULL AND raw_text_hash IS NOT NULL AND text_start IS NOT NULL AND text_end IS NOT NULL AND derived_text IS NULL)),
  CHECK (source_class<>'ai_interpretation' OR (raw_text IS NULL AND raw_text_hash IS NULL AND text_start IS NULL AND text_end IS NULL AND derived_text IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_v2_link_fragment_run_key ON v2_link_fragments(processing_run_id,fragment_key);
--> statement-breakpoint
CREATE INDEX idx_v2_link_fragment_document ON v2_link_fragments(user_id,document_object_id,processing_run_id,display_order);
--> statement-breakpoint
CREATE TABLE v2_link_fragment_evidence (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE cascade,
  fragment_id text NOT NULL REFERENCES v2_link_fragments(id) ON DELETE cascade,
  member_id text NOT NULL REFERENCES v2_link_snapshot_sources(id),
  relation_kind text NOT NULL CHECK (relation_kind IN ('example','supports','continuation','variant')),
  evidence_method text NOT NULL CHECK (evidence_method IN ('explicit','author_continuation','user_confirmed','ai_proposed','unresolved')),
  text_start integer,
  text_end integer,
  image_region_json text CHECK (image_region_json IS NULL OR json_valid(image_region_json)),
  start_seconds real,
  end_seconds real,
  display_order integer NOT NULL CHECK (display_order >= 0),
  locked_by_user integer NOT NULL DEFAULT 0 CHECK (locked_by_user IN (0,1)),
  state_version integer NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  created_at text NOT NULL,
  CHECK ((text_start IS NULL AND text_end IS NULL) OR (text_start IS NOT NULL AND text_end IS NOT NULL AND text_start >= 0 AND text_end > text_start)),
  CHECK ((start_seconds IS NULL AND end_seconds IS NULL) OR (start_seconds IS NOT NULL AND end_seconds IS NOT NULL AND start_seconds >= 0 AND end_seconds > start_seconds))
);
--> statement-breakpoint
CREATE INDEX idx_v2_link_fragment_evidence_order ON v2_link_fragment_evidence(fragment_id,display_order);
--> statement-breakpoint
CREATE TRIGGER trg_v2_link_snapshot_owner BEFORE INSERT ON v2_link_snapshots BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM v2_documents d JOIN v2_objects o ON o.id=d.object_id
    JOIN v2_capture_bundles c ON c.id=d.capture_id AND c.user_id=o.user_id
    WHERE d.object_id=NEW.document_object_id AND d.capture_id=NEW.capture_id AND o.user_id=NEW.user_id
  ) THEN RAISE(ABORT,'link_snapshot_owner_mismatch') END;
  SELECT CASE WHEN NOT ((NEW.parent_snapshot_id IS NULL AND NEW.snapshot_version=1) OR EXISTS (
    SELECT 1 FROM v2_link_snapshots p WHERE p.id=NEW.parent_snapshot_id AND p.user_id=NEW.user_id
      AND p.document_object_id=NEW.document_object_id AND p.capture_id=NEW.capture_id AND p.snapshot_version=NEW.snapshot_version-1
  )) THEN RAISE(ABORT,'link_snapshot_parent_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_link_snapshot_immutable BEFORE UPDATE ON v2_link_snapshots BEGIN SELECT RAISE(ABORT,'link_snapshot_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_link_snapshot_source_owner BEFORE INSERT ON v2_link_snapshot_sources BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM v2_link_snapshots snapshot JOIN v2_source_items source ON source.id=NEW.source_item_id
      AND source.user_id=snapshot.user_id AND source.capture_id=snapshot.capture_id
    JOIN v2_document_source_links link ON link.document_object_id=snapshot.document_object_id AND link.source_item_id=source.id
    WHERE snapshot.id=NEW.snapshot_id AND snapshot.user_id=NEW.user_id
  ) THEN RAISE(ABORT,'link_snapshot_source_owner_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_link_snapshot_source_immutable BEFORE UPDATE ON v2_link_snapshot_sources BEGIN SELECT RAISE(ABORT,'link_snapshot_source_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_link_job_snapshot_insert BEFORE INSERT ON v2_processing_jobs WHEN NEW.stage='link_analyze' BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_link_snapshots s WHERE s.id=NEW.input_link_snapshot_id
    AND s.user_id=NEW.user_id AND s.document_object_id=NEW.object_id AND s.capture_id=NEW.capture_id
    AND s.manifest_hash=NEW.input_source_manifest_hash AND s.manifest_version=NEW.input_source_manifest_version)
    THEN RAISE(ABORT,'link_job_snapshot_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_link_job_snapshot_update BEFORE UPDATE OF stage,input_link_snapshot_id,input_source_manifest_hash,input_source_manifest_version,user_id,object_id,capture_id ON v2_processing_jobs WHEN NEW.stage='link_analyze' BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_link_snapshots s WHERE s.id=NEW.input_link_snapshot_id
    AND s.user_id=NEW.user_id AND s.document_object_id=NEW.object_id AND s.capture_id=NEW.capture_id
    AND s.manifest_hash=NEW.input_source_manifest_hash AND s.manifest_version=NEW.input_source_manifest_version)
    THEN RAISE(ABORT,'link_job_snapshot_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_link_fragment_owner BEFORE INSERT ON v2_link_fragments BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_link_snapshots s JOIN v2_link_snapshot_sources m ON m.snapshot_id=s.id AND m.user_id=s.user_id
    WHERE s.id=NEW.snapshot_id AND s.user_id=NEW.user_id AND s.document_object_id=NEW.document_object_id AND m.id=NEW.primary_member_id)
    THEN RAISE(ABORT,'link_fragment_owner_mismatch') END;
  SELECT CASE WHEN NEW.processing_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v2_processing_runs r JOIN v2_processing_jobs j ON j.id=r.job_id AND j.user_id=r.user_id
    WHERE r.id=NEW.processing_run_id AND r.user_id=NEW.user_id AND j.stage='link_analyze' AND j.object_id=NEW.document_object_id AND j.input_link_snapshot_id=NEW.snapshot_id
  ) THEN RAISE(ABORT,'link_fragment_run_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_link_fragment_immutable BEFORE UPDATE ON v2_link_fragments
WHEN NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.document_object_id IS NOT OLD.document_object_id
 OR NEW.snapshot_id IS NOT OLD.snapshot_id OR NEW.primary_member_id IS NOT OLD.primary_member_id OR NEW.processing_run_id IS NOT OLD.processing_run_id
 OR NEW.fragment_key IS NOT OLD.fragment_key OR NEW.role IS NOT OLD.role OR NEW.source_class IS NOT OLD.source_class
 OR NEW.text_start IS NOT OLD.text_start OR NEW.text_end IS NOT OLD.text_end OR NEW.raw_text IS NOT OLD.raw_text OR NEW.raw_text_hash IS NOT OLD.raw_text_hash
 OR NEW.derived_text IS NOT OLD.derived_text OR NEW.details_json IS NOT OLD.details_json OR NEW.completeness IS NOT OLD.completeness OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'link_fragment_content_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_link_fragment_evidence_owner BEFORE INSERT ON v2_link_fragment_evidence BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v2_link_fragments f JOIN v2_link_snapshot_sources m ON m.snapshot_id=f.snapshot_id AND m.user_id=f.user_id
    WHERE f.id=NEW.fragment_id AND f.user_id=NEW.user_id AND m.id=NEW.member_id)
    THEN RAISE(ABORT,'link_fragment_evidence_owner_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_link_fragment_evidence_immutable BEFORE UPDATE ON v2_link_fragment_evidence
WHEN NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.fragment_id IS NOT OLD.fragment_id OR NEW.member_id IS NOT OLD.member_id
 OR NEW.relation_kind IS NOT OLD.relation_kind OR NEW.text_start IS NOT OLD.text_start OR NEW.text_end IS NOT OLD.text_end
 OR NEW.image_region_json IS NOT OLD.image_region_json OR NEW.start_seconds IS NOT OLD.start_seconds OR NEW.end_seconds IS NOT OLD.end_seconds OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'link_fragment_evidence_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_change_link_snapshot_insert AFTER INSERT ON v2_link_snapshots BEGIN
  INSERT INTO v2_change_events(user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at) VALUES(NEW.user_id,'link_snapshot',NEW.id,CAST(NEW.snapshot_version AS text),'upsert',NEW.manifest_hash,NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_change_link_snapshot_delete AFTER DELETE ON v2_link_snapshots BEGIN
  INSERT INTO v2_change_events(user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at) VALUES(OLD.user_id,'link_snapshot',OLD.id,CAST(OLD.snapshot_version AS text),'tombstone',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_change_link_snapshot_source_insert AFTER INSERT ON v2_link_snapshot_sources BEGIN
  INSERT INTO v2_change_events(user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at) SELECT NEW.user_id,'link_snapshot_source',NEW.id,'1','upsert',NEW.source_fingerprint,created_at FROM v2_link_snapshots WHERE id=NEW.snapshot_id;
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_change_link_snapshot_source_delete AFTER DELETE ON v2_link_snapshot_sources BEGIN
  INSERT INTO v2_change_events(user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at) VALUES(OLD.user_id,'link_snapshot_source',OLD.id,'1','tombstone',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_change_link_fragment_insert AFTER INSERT ON v2_link_fragments BEGIN
  INSERT INTO v2_change_events(user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at) VALUES(NEW.user_id,'link_fragment',NEW.id,CAST(NEW.state_version AS text),'upsert',NEW.raw_text_hash,NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_change_link_fragment_update AFTER UPDATE ON v2_link_fragments BEGIN
  INSERT INTO v2_change_events(user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at) VALUES(NEW.user_id,'link_fragment',NEW.id,CAST(NEW.state_version AS text),'upsert',NEW.raw_text_hash,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_change_link_fragment_delete AFTER DELETE ON v2_link_fragments BEGIN
  INSERT INTO v2_change_events(user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at) VALUES(OLD.user_id,'link_fragment',OLD.id,CAST(OLD.state_version AS text),'tombstone',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_change_link_fragment_evidence_insert AFTER INSERT ON v2_link_fragment_evidence BEGIN
  INSERT INTO v2_change_events(user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at) VALUES(NEW.user_id,'link_fragment_evidence',NEW.id,CAST(NEW.state_version AS text),'upsert',NULL,NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_change_link_fragment_evidence_update AFTER UPDATE ON v2_link_fragment_evidence BEGIN
  INSERT INTO v2_change_events(user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at) VALUES(NEW.user_id,'link_fragment_evidence',NEW.id,CAST(NEW.state_version AS text),'upsert',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_change_link_fragment_evidence_delete AFTER DELETE ON v2_link_fragment_evidence BEGIN
  INSERT INTO v2_change_events(user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at) VALUES(OLD.user_id,'link_fragment_evidence',OLD.id,CAST(OLD.state_version AS text),'tombstone',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
-- SQLite cannot alter a CHECK constraint. Preserve all active invocation leases
-- and recreate the five dependent visibility/lifecycle guards from migration 0029.
DROP TRIGGER trg_v2_legacy_mapping_invocation_insert_guard;
--> statement-breakpoint
DROP TRIGGER trg_v2_legacy_mapping_invocation_update_guard;
--> statement-breakpoint
DROP TRIGGER trg_v2_legacy_mapping_invocation_delete_guard;
--> statement-breakpoint
DROP TRIGGER trg_v2_object_invocation_lifecycle_guard;
--> statement-breakpoint
DROP TRIGGER trg_v2_object_invocation_delete_guard;
--> statement-breakpoint
CREATE TABLE v2_provider_invocation_leases_next (
  job_id text PRIMARY KEY NOT NULL REFERENCES v2_processing_jobs(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES v2_processing_runs(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_id text NOT NULL REFERENCES v2_objects(id) ON DELETE CASCADE,
  lease_owner text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('analyze','grounded_enrich','link_analyze')),
  expires_at text NOT NULL,
  acquired_at text NOT NULL,
  updated_at text NOT NULL
);
--> statement-breakpoint
INSERT INTO v2_provider_invocation_leases_next(job_id,run_id,user_id,object_id,lease_owner,stage,expires_at,acquired_at,updated_at)
SELECT job_id,run_id,user_id,object_id,lease_owner,stage,expires_at,acquired_at,updated_at FROM v2_provider_invocation_leases;
--> statement-breakpoint
DROP TABLE v2_provider_invocation_leases;
--> statement-breakpoint
ALTER TABLE v2_provider_invocation_leases_next RENAME TO v2_provider_invocation_leases;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_v2_provider_invocation_run ON v2_provider_invocation_leases(run_id);
--> statement-breakpoint
CREATE INDEX idx_v2_provider_invocation_object_expiry ON v2_provider_invocation_leases(user_id,object_id,expires_at);
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_mapping_invocation_insert_guard`
BEFORE INSERT ON `v2_legacy_source_mappings`
WHEN new.projected_object_id IS NOT NULL AND new.status IS NOT 'projected'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM `v2_provider_invocation_leases` `lease`
    JOIN `v2_objects` `object` ON `object`.`id`=new.projected_object_id
      AND `object`.`user_id`=new.user_id AND `object`.`lifecycle_status`='active'
    WHERE `lease`.`user_id`=new.user_id AND `lease`.`object_id`=new.projected_object_id
      AND `lease`.`expires_at`>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  ) THEN RAISE(ABORT, 'legacy_provider_invocation_active') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_mapping_invocation_update_guard`
BEFORE UPDATE OF `status`,`projected_object_id`,`user_id` ON `v2_legacy_source_mappings`
WHEN (old.status='projected' AND old.projected_object_id IS NOT NULL AND (
  new.status IS NOT 'projected' OR new.projected_object_id IS NOT old.projected_object_id OR new.user_id IS NOT old.user_id
)) OR (new.projected_object_id IS NOT NULL AND new.status IS NOT 'projected')
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM `v2_provider_invocation_leases` `lease`
    WHERE `lease`.`expires_at`>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (
      (old.status='projected' AND old.projected_object_id=`lease`.`object_id` AND old.user_id=`lease`.`user_id` AND (
        new.status IS NOT 'projected' OR new.projected_object_id IS NOT old.projected_object_id OR new.user_id IS NOT old.user_id
      )) OR (new.projected_object_id=`lease`.`object_id` AND new.user_id=`lease`.`user_id` AND EXISTS (
        SELECT 1 FROM `v2_objects` `object` WHERE `object`.`id`=new.projected_object_id
          AND `object`.`user_id`=new.user_id AND `object`.`lifecycle_status`='active'
      ))
    )
  ) THEN RAISE(ABORT, 'legacy_provider_invocation_active') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_legacy_mapping_invocation_delete_guard`
BEFORE DELETE ON `v2_legacy_source_mappings`
WHEN old.status='projected' AND old.projected_object_id IS NOT NULL
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM `v2_provider_invocation_leases` `lease`
    WHERE `lease`.`user_id`=old.user_id AND `lease`.`object_id`=old.projected_object_id
      AND `lease`.`expires_at`>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  ) THEN RAISE(ABORT, 'legacy_provider_invocation_active') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_object_invocation_lifecycle_guard`
BEFORE UPDATE OF `lifecycle_status` ON `v2_objects`
WHEN old.lifecycle_status='active' AND new.lifecycle_status<>'active'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM `v2_provider_invocation_leases` `lease`
    WHERE `lease`.`user_id`=old.user_id AND `lease`.`object_id`=old.id
      AND `lease`.`expires_at`>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  ) THEN RAISE(ABORT, 'legacy_provider_invocation_active') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_v2_object_invocation_delete_guard`
BEFORE DELETE ON `v2_objects`
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM `v2_provider_invocation_leases` `lease`
    WHERE `lease`.`user_id`=old.user_id AND `lease`.`object_id`=old.id
      AND `lease`.`expires_at`>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  ) THEN RAISE(ABORT, 'legacy_provider_invocation_active') END;
END;
--> statement-breakpoint

-- Keep the exact legacy backup receipt allowlist aligned with the canonical
-- link tables. Owner, snapshot, object-key, and deletion-state guards remain.
INSERT INTO `v2_backup_retention_known_metadata_paths` (`path`) VALUES
  ('sources/link-snapshots.jsonl'),
  ('sources/link-snapshot-sources.jsonl'),
  ('objects/link-fragments.jsonl'),
  ('objects/link-fragment-evidence.jsonl')
ON CONFLICT (`path`) DO NOTHING;
