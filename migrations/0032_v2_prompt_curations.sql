CREATE TABLE v2_link_curation_revisions (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE cascade,
  document_object_id text NOT NULL REFERENCES v2_objects(id) ON DELETE cascade,
  snapshot_id text NOT NULL REFERENCES v2_link_snapshots(id),
  group_key text NOT NULL CHECK (length(trim(group_key)) BETWEEN 1 AND 200),
  revision_number integer NOT NULL CHECK (revision_number >= 1),
  parent_revision_id text REFERENCES v2_link_curation_revisions(id),
  based_on_revision_id text REFERENCES v2_link_curation_revisions(id),
  change_reason text NOT NULL CHECK (change_reason IN ('create','edit','undo','archive','unarchive','migrate')),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  relation_kind text NOT NULL CHECK (relation_kind IN ('continuation','collection','alternatives')),
  relationship_confirmation text NOT NULL CHECK (relationship_confirmation IN ('unconfirmed','user_confirmed')),
  order_confirmation text NOT NULL CHECK (order_confirmation IN ('unconfirmed','user_confirmed')),
  status text NOT NULL CHECK (status IN ('active','archived')),
  separator text NOT NULL CHECK (separator=char(10)),
  manifest_version text NOT NULL CHECK (manifest_version='prompt-curation-manifest.v1'),
  render_version text NOT NULL CHECK (render_version='prompt-curation-render.v1'),
  manifest_json text NOT NULL CHECK (json_valid(manifest_json)),
  manifest_hash text NOT NULL CHECK (length(manifest_hash)=64 AND manifest_hash NOT GLOB '*[^a-f0-9]*'),
  created_at text NOT NULL,
  UNIQUE(document_object_id,group_key,revision_number)
);
--> statement-breakpoint
CREATE INDEX idx_v2_link_curation_owner_group ON v2_link_curation_revisions(user_id,document_object_id,group_key,revision_number);
--> statement-breakpoint
CREATE TABLE v2_link_curation_items (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE cascade,
  curation_revision_id text NOT NULL REFERENCES v2_link_curation_revisions(id) ON DELETE cascade,
  item_key text NOT NULL CHECK (length(trim(item_key)) BETWEEN 1 AND 200),
  fragment_id text NOT NULL REFERENCES v2_link_fragments(id),
  copy_role text NOT NULL CHECK (copy_role IN ('prompt','negative_prompt','parameters')),
  position integer NOT NULL CHECK (position BETWEEN 0 AND 63),
  fragment_state_version integer NOT NULL CHECK (fragment_state_version >= 1),
  UNIQUE(curation_revision_id,item_key),
  UNIQUE(curation_revision_id,copy_role,position)
);
--> statement-breakpoint
CREATE INDEX idx_v2_link_curation_item_fragment ON v2_link_curation_items(fragment_id);
--> statement-breakpoint
CREATE TABLE v2_link_curation_examples (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE cascade,
  curation_revision_id text NOT NULL REFERENCES v2_link_curation_revisions(id) ON DELETE cascade,
  example_key text NOT NULL CHECK (length(trim(example_key)) BETWEEN 1 AND 200),
  item_id text REFERENCES v2_link_curation_items(id),
  member_id text NOT NULL REFERENCES v2_link_snapshot_sources(id),
  attachment_id text NOT NULL REFERENCES v2_attachment_reservations(id),
  position integer NOT NULL CHECK (position BETWEEN 0 AND 63),
  evidence_method text NOT NULL CHECK (evidence_method IN ('unresolved','user_confirmed')),
  UNIQUE(curation_revision_id,example_key),
  UNIQUE(curation_revision_id,position)
);
--> statement-breakpoint
CREATE TRIGGER trg_v2_link_curation_revision_insert BEFORE INSERT ON v2_link_curation_revisions BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM v2_link_snapshots s JOIN v2_objects o ON o.id=s.document_object_id
    WHERE s.id=NEW.snapshot_id AND s.user_id=NEW.user_id AND o.user_id=NEW.user_id AND s.document_object_id=NEW.document_object_id
  ) THEN RAISE(ABORT,'prompt_curation_owner_mismatch') END;
  SELECT CASE WHEN NOT ((NEW.parent_revision_id IS NULL AND NEW.revision_number=1) OR EXISTS (
    SELECT 1 FROM v2_link_curation_revisions p WHERE p.id=NEW.parent_revision_id AND p.user_id=NEW.user_id
      AND p.document_object_id=NEW.document_object_id AND p.snapshot_id=NEW.snapshot_id AND p.group_key=NEW.group_key AND p.revision_number=NEW.revision_number-1
  )) THEN RAISE(ABORT,'prompt_curation_parent_mismatch') END;
  -- Existing-only references and immutable rows preclude self/forward cycles.
  SELECT CASE WHEN NEW.based_on_revision_id IS NOT NULL AND (NEW.based_on_revision_id=NEW.id OR NOT EXISTS (
    SELECT 1 FROM v2_link_curation_revisions b WHERE b.id=NEW.based_on_revision_id AND b.user_id=NEW.user_id AND b.document_object_id=NEW.document_object_id
  )) THEN RAISE(ABORT,'prompt_curation_basis_mismatch') END;
  SELECT CASE WHEN json_extract(NEW.manifest_json,'$.manifestVersion') IS NOT NEW.manifest_version
    OR json_extract(NEW.manifest_json,'$.renderVersion') IS NOT NEW.render_version
    OR json_extract(NEW.manifest_json,'$.snapshotManifestHash') IS NOT (SELECT manifest_hash FROM v2_link_snapshots WHERE id=NEW.snapshot_id)
    OR json_extract(NEW.manifest_json,'$.title') IS NOT NEW.title OR json_extract(NEW.manifest_json,'$.relationKind') IS NOT NEW.relation_kind
    OR json_extract(NEW.manifest_json,'$.relationshipConfirmation') IS NOT NEW.relationship_confirmation
    OR json_extract(NEW.manifest_json,'$.orderConfirmation') IS NOT NEW.order_confirmation OR json_extract(NEW.manifest_json,'$.separator') IS NOT NEW.separator
    OR json_type(NEW.manifest_json,'$.items') IS NOT 'array' OR json_array_length(NEW.manifest_json,'$.items') NOT BETWEEN 1 AND 64
    OR json_type(NEW.manifest_json,'$.examples') IS NOT 'array' OR json_array_length(NEW.manifest_json,'$.examples') NOT BETWEEN 0 AND 64
    THEN RAISE(ABORT,'prompt_curation_manifest_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_link_curation_item_insert BEFORE INSERT ON v2_link_curation_items BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM v2_link_curation_revisions c JOIN v2_link_fragments f ON f.id=NEW.fragment_id
      AND f.user_id=c.user_id AND f.document_object_id=c.document_object_id AND f.snapshot_id=c.snapshot_id
    JOIN v2_link_snapshot_sources m ON m.id=f.primary_member_id AND m.snapshot_id=c.snapshot_id AND m.user_id=c.user_id
    JOIN json_each(c.manifest_json,'$.items') j
    WHERE c.id=NEW.curation_revision_id AND c.user_id=NEW.user_id AND f.source_class='source_extract' AND f.role=NEW.copy_role
      AND NEW.fragment_state_version<=f.state_version
      AND json_extract(j.value,'$.itemKey')=NEW.item_key AND json_extract(j.value,'$.role')=NEW.copy_role AND json_extract(j.value,'$.position')=NEW.position
      AND json_extract(j.value,'$.memberKey')=m.member_key AND json_extract(j.value,'$.sourceFingerprint')=m.source_fingerprint
      AND json_extract(j.value,'$.textStart')=f.text_start AND json_extract(j.value,'$.textEnd')=f.text_end AND json_extract(j.value,'$.rawTextHash')=f.raw_text_hash
      AND json_extract(j.value,'$.completeness')=f.completeness
  ) THEN RAISE(ABORT,'prompt_curation_item_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_link_curation_example_insert BEFORE INSERT ON v2_link_curation_examples BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM v2_link_curation_revisions c JOIN v2_link_snapshot_sources m ON m.id=NEW.member_id AND m.user_id=c.user_id AND m.snapshot_id=c.snapshot_id
    JOIN v2_source_attachment_links l ON l.source_item_id=m.source_item_id AND l.attachment_id=NEW.attachment_id AND l.user_id=c.user_id
    JOIN v2_attachment_reservations a ON a.id=l.attachment_id AND a.user_id=c.user_id AND a.status='committed' AND a.committed_at IS NOT NULL
    LEFT JOIN v2_link_curation_items i ON i.id=NEW.item_id AND i.curation_revision_id=c.id AND i.user_id=c.user_id
    JOIN json_each(c.manifest_json,'$.examples') j
    WHERE c.id=NEW.curation_revision_id AND c.user_id=NEW.user_id AND a.mime_type GLOB 'image/*'
      AND (NEW.item_id IS NULL OR i.id IS NOT NULL) AND (c.relation_kind<>'alternatives' OR i.id IS NOT NULL)
      AND json_extract(j.value,'$.exampleKey')=NEW.example_key AND json_extract(j.value,'$.itemKey') IS i.item_key
      AND json_extract(j.value,'$.memberKey')=m.member_key AND json_extract(j.value,'$.sourceFingerprint')=m.source_fingerprint
      AND json_extract(j.value,'$.sha256')=replace(a.sha256,'sha256:','') AND json_extract(j.value,'$.mimeType')=a.mime_type AND json_extract(j.value,'$.sizeBytes')=a.size_bytes
      AND json_extract(j.value,'$.position')=NEW.position AND json_extract(j.value,'$.evidenceMethod')=NEW.evidence_method
  ) THEN RAISE(ABORT,'prompt_curation_example_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_link_curation_revision_immutable BEFORE UPDATE ON v2_link_curation_revisions BEGIN SELECT RAISE(ABORT,'prompt_curation_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_link_curation_item_immutable BEFORE UPDATE ON v2_link_curation_items BEGIN SELECT RAISE(ABORT,'prompt_curation_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_link_curation_example_immutable BEFORE UPDATE ON v2_link_curation_examples BEGIN SELECT RAISE(ABORT,'prompt_curation_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_change_link_curation_revision_insert AFTER INSERT ON v2_link_curation_revisions BEGIN
  INSERT INTO v2_change_events(user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at) VALUES(NEW.user_id,'link_curation_revision',NEW.id,CAST(NEW.revision_number AS text),'upsert',NEW.manifest_hash,NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_change_link_curation_revision_delete AFTER DELETE ON v2_link_curation_revisions BEGIN
  INSERT INTO v2_change_events(user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at) VALUES(OLD.user_id,'link_curation_revision',OLD.id,CAST(OLD.revision_number AS text),'tombstone',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_change_link_curation_item_insert AFTER INSERT ON v2_link_curation_items BEGIN
  INSERT INTO v2_change_events(user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at) SELECT NEW.user_id,'link_curation_item',NEW.id,'1','upsert',NULL,created_at FROM v2_link_curation_revisions WHERE id=NEW.curation_revision_id;
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_change_link_curation_item_delete AFTER DELETE ON v2_link_curation_items BEGIN
  INSERT INTO v2_change_events(user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at) VALUES(OLD.user_id,'link_curation_item',OLD.id,'1','tombstone',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_change_link_curation_example_insert AFTER INSERT ON v2_link_curation_examples BEGIN
  INSERT INTO v2_change_events(user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at) SELECT NEW.user_id,'link_curation_example',NEW.id,'1','upsert',NULL,created_at FROM v2_link_curation_revisions WHERE id=NEW.curation_revision_id;
END;
--> statement-breakpoint
CREATE TRIGGER trg_v2_change_link_curation_example_delete AFTER DELETE ON v2_link_curation_examples BEGIN
  INSERT INTO v2_change_events(user_id,aggregate_kind,aggregate_id,revision_or_version,operation,content_hash,occurred_at) VALUES(OLD.user_id,'link_curation_example',OLD.id,'1','tombstone',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
INSERT INTO v2_backup_retention_known_metadata_paths(path) VALUES
 ('objects/link-curation-revisions.jsonl'),('objects/link-curation-items.jsonl'),('objects/link-curation-examples.jsonl')
ON CONFLICT(path) DO NOTHING;
