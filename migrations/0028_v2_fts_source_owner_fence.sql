DROP TRIGGER IF EXISTS `v2_document_sources_fts_ai`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `v2_document_sources_fts_ad`;
--> statement-breakpoint
UPDATE `v2_documents_fts`
SET `source_text`=coalesce((
  SELECT group_concat(coalesce(s.raw_text,''),' ')
  FROM v2_document_source_links l
  JOIN v2_source_items s ON s.id=l.source_item_id
  JOIN v2_objects owner ON owner.id=l.document_object_id AND owner.user_id=s.user_id
  WHERE l.document_object_id=v2_documents_fts.object_id
),'');
--> statement-breakpoint
CREATE TRIGGER `v2_document_sources_fts_ai` AFTER INSERT ON `v2_document_source_links` BEGIN
  UPDATE v2_documents_fts
  SET source_text=coalesce((
    SELECT group_concat(coalesce(s.raw_text,''),' ')
    FROM v2_document_source_links l
    JOIN v2_source_items s ON s.id=l.source_item_id
    JOIN v2_objects owner ON owner.id=l.document_object_id AND owner.user_id=s.user_id
    WHERE l.document_object_id=new.document_object_id
  ),'')
  WHERE object_id=new.document_object_id;
END;
--> statement-breakpoint
CREATE TRIGGER `v2_document_sources_fts_ad` AFTER DELETE ON `v2_document_source_links` BEGIN
  UPDATE v2_documents_fts
  SET source_text=coalesce((
    SELECT group_concat(coalesce(s.raw_text,''),' ')
    FROM v2_document_source_links l
    JOIN v2_source_items s ON s.id=l.source_item_id
    JOIN v2_objects owner ON owner.id=l.document_object_id AND owner.user_id=s.user_id
    WHERE l.document_object_id=old.document_object_id
  ),'')
  WHERE object_id=old.document_object_id;
END;
