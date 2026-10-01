CREATE VIRTUAL TABLE `v2_documents_fts` USING fts5(
  `object_id` UNINDEXED,
  `user_id` UNINDEXED,
  `title`,
  `body`,
  `source_text`,
  `entity_text`,
  tokenize='trigram'
);
--> statement-breakpoint
INSERT INTO `v2_documents_fts` (`object_id`,`user_id`,`title`,`body`,`source_text`,`entity_text`)
SELECT d.object_id,o.user_id,d.title,d.body_markdown,
  coalesce((select group_concat(coalesce(s.raw_text,''),' ') from v2_document_source_links l join v2_source_items s on s.id=l.source_item_id where l.document_object_id=d.object_id),''),
  coalesce((select group_concat(e.canonical_name,' ') from v2_relation_edges r join v2_entity_records e on e.object_id=r.object_object_id where r.subject_object_id=d.object_id and r.review_status='accepted' and r.superseded_at is null),'')
FROM v2_documents d JOIN v2_objects o ON o.id=d.object_id;
--> statement-breakpoint
CREATE TRIGGER `v2_documents_fts_ai` AFTER INSERT ON `v2_documents` BEGIN
  INSERT INTO v2_documents_fts(object_id,user_id,title,body,source_text,entity_text)
  SELECT new.object_id,o.user_id,new.title,new.body_markdown,'','' FROM v2_objects o WHERE o.id=new.object_id;
END;
--> statement-breakpoint
CREATE TRIGGER `v2_documents_fts_au` AFTER UPDATE OF title,body_markdown ON `v2_documents` BEGIN
  UPDATE v2_documents_fts SET title=new.title,body=new.body_markdown WHERE object_id=new.object_id;
END;
--> statement-breakpoint
CREATE TRIGGER `v2_documents_fts_ad` AFTER DELETE ON `v2_documents` BEGIN
  DELETE FROM v2_documents_fts WHERE object_id=old.object_id;
END;
--> statement-breakpoint
CREATE TRIGGER `v2_document_sources_fts_ai` AFTER INSERT ON `v2_document_source_links` BEGIN
  UPDATE v2_documents_fts SET source_text=coalesce((select group_concat(coalesce(s.raw_text,''),' ') from v2_document_source_links l join v2_source_items s on s.id=l.source_item_id where l.document_object_id=new.document_object_id),'') WHERE object_id=new.document_object_id;
END;
--> statement-breakpoint
CREATE TRIGGER `v2_document_sources_fts_ad` AFTER DELETE ON `v2_document_source_links` BEGIN
  UPDATE v2_documents_fts SET source_text=coalesce((select group_concat(coalesce(s.raw_text,''),' ') from v2_document_source_links l join v2_source_items s on s.id=l.source_item_id where l.document_object_id=old.document_object_id),'') WHERE object_id=old.document_object_id;
END;
--> statement-breakpoint
CREATE TRIGGER `v2_relations_fts_ai` AFTER INSERT ON `v2_relation_edges` BEGIN
  UPDATE v2_documents_fts SET entity_text=coalesce((select group_concat(e.canonical_name,' ') from v2_relation_edges r join v2_entity_records e on e.object_id=r.object_object_id where r.subject_object_id=new.subject_object_id and r.review_status='accepted' and r.superseded_at is null),'') WHERE object_id=new.subject_object_id;
END;
--> statement-breakpoint
CREATE TRIGGER `v2_relations_fts_au` AFTER UPDATE OF review_status,superseded_at,object_object_id ON `v2_relation_edges` BEGIN
  UPDATE v2_documents_fts SET entity_text=coalesce((select group_concat(e.canonical_name,' ') from v2_relation_edges r join v2_entity_records e on e.object_id=r.object_object_id where r.subject_object_id=new.subject_object_id and r.review_status='accepted' and r.superseded_at is null),'') WHERE object_id=new.subject_object_id;
END;
--> statement-breakpoint
CREATE TRIGGER `v2_relations_fts_ad` AFTER DELETE ON `v2_relation_edges` BEGIN
  UPDATE v2_documents_fts SET entity_text=coalesce((select group_concat(e.canonical_name,' ') from v2_relation_edges r join v2_entity_records e on e.object_id=r.object_object_id where r.subject_object_id=old.subject_object_id and r.review_status='accepted' and r.superseded_at is null),'') WHERE object_id=old.subject_object_id;
END;
--> statement-breakpoint
CREATE TRIGGER `v2_entities_fts_au` AFTER UPDATE OF canonical_name ON `v2_entity_records` BEGIN
  UPDATE v2_documents_fts SET entity_text=coalesce((select group_concat(e.canonical_name,' ') from v2_relation_edges r join v2_entity_records e on e.object_id=r.object_object_id where r.subject_object_id=v2_documents_fts.object_id and r.review_status='accepted' and r.superseded_at is null),'') WHERE object_id in (select subject_object_id from v2_relation_edges where object_object_id=new.object_id and review_status='accepted' and superseded_at is null);
END;
--> statement-breakpoint
CREATE TABLE `v2_saved_views` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `view_key` text NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `icon_key` text NOT NULL,
  `query_plan_json` text NOT NULL,
  `display_json` text NOT NULL,
  `source` text NOT NULL CHECK (`source` in ('user_created','system_seed','ai_suggested')),
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` in ('active','archived')),
  `pinned` integer NOT NULL DEFAULT 0 CHECK (`pinned` in (0,1)),
  `pin_order` integer,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_v2_saved_view_user_key` ON `v2_saved_views` (`user_id`,`view_key`);
--> statement-breakpoint
CREATE INDEX `idx_v2_saved_view_user_status_pin` ON `v2_saved_views` (`user_id`,`status`,`pinned`,`pin_order`);
