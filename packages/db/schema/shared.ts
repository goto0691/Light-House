import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { id, timestamps, userId } from "./_helpers";

export const tags = sqliteTable(
  "tags",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    color: text("color"),
    parentId: text("parent_id"),
    usageCount: integer("usage_count").default(0),
    ...timestamps,
  },
  (table) => ({
    userSlugIndex: index("idx_tag_user_slug").on(table.userId, table.slug),
    parentIndex: index("idx_tag_parent").on(table.parentId),
  }),
);

export const taggings = sqliteTable(
  "taggings",
  {
    id: id(),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    taggableType: text("taggable_type").notNull(),
    taggableId: text("taggable_id").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    polyIndex: index("idx_taggings_poly").on(table.taggableType, table.taggableId),
    tagIndex: index("idx_taggings_tag").on(table.tagId),
  }),
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: id(),
    userId: userId(),
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    kind: text("kind").notNull(),
    r2Key: text("r2_key").notNull(),
    cdnUrl: text("cdn_url").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    meta: text("meta"),
    ...timestamps,
  },
  (table) => ({
    ownerIndex: index("idx_attach_owner").on(table.ownerType, table.ownerId),
    userIndex: index("idx_attach_user").on(table.userId),
  }),
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: id(),
    userId: userId(),
    importBatchId: text("import_batch_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    snapshot: text("snapshot"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    entityIndex: index("idx_audit_entity").on(table.entityType, table.entityId),
    userTimeIndex: index("idx_audit_user_time").on(table.userId, table.createdAt),
    importBatchIndex: index("idx_audit_batch").on(table.userId, table.importBatchId),
  }),
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: id(),
    userId: userId(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    readAt: text("read_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    userReadIndex: index("idx_notification_user_read").on(table.userId, table.readAt, table.createdAt),
    entityIndex: index("idx_notification_entity").on(table.entityType, table.entityId),
  }),
);

export const savedViews = sqliteTable(
  "saved_views",
  {
    id: id(),
    userId: userId(),
    domain: text("domain").notNull(),
    scope: text("scope").notNull(),
    name: text("name").notNull(),
    icon: text("icon"),
    searchQuery: text("search_query"),
    filterState: text("filter_state"),
    sortState: text("sort_state"),
    viewKey: text("view_key"),
    isDefault: integer("is_default", { mode: "boolean" }).default(false),
    displayOrder: integer("display_order").default(0),
    ...timestamps,
  },
  (table) => ({
    userDomainScopeIndex: index("idx_saved_view_user_domain_scope").on(table.userId, table.domain, table.scope),
    userDefaultIndex: index("idx_saved_view_user_default").on(table.userId, table.isDefault),
  }),
);

export const widgetLayouts = sqliteTable(
  "widget_layouts",
  {
    id: id(),
    userId: userId(),
    pageKey: text("page_key").notNull(),
    widgetKey: text("widget_key").notNull(),
    titleOverride: text("title_override"),
    layout: text("layout").notNull(),
    isHidden: integer("is_hidden", { mode: "boolean" }).default(false),
    displayOrder: integer("display_order").default(0),
    ...timestamps,
  },
  (table) => ({
    userPageIndex: index("idx_widget_layout_user_page").on(table.userId, table.pageKey),
    widgetKeyIndex: index("idx_widget_layout_widget").on(table.userId, table.pageKey, table.widgetKey),
  }),
);

export const shortcutBindings = sqliteTable(
  "shortcut_bindings",
  {
    id: id(),
    userId: userId(),
    category: text("category").notNull(),
    actionKey: text("action_key").notNull(),
    label: text("label").notNull(),
    binding: text("binding").notNull(),
    isEnabled: integer("is_enabled", { mode: "boolean" }).default(true),
    isCustom: integer("is_custom", { mode: "boolean" }).default(true),
    displayOrder: integer("display_order").default(0),
    ...timestamps,
  },
  (table) => ({
    userCategoryIndex: index("idx_shortcut_user_category").on(table.userId, table.category),
    actionKeyIndex: index("idx_shortcut_action_key").on(table.userId, table.actionKey),
  }),
);

export const backupSnapshots = sqliteTable(
  "backup_snapshots",
  {
    id: id(),
    userId: userId(),
    provider: text("provider").notNull().default("r2"),
    bucketKey: text("bucket_key").notNull(),
    format: text("format").notNull().default("zip"),
    status: text("status").notNull().default("ready"),
    sizeBytes: integer("size_bytes"),
    checksum: text("checksum"),
    expiresAt: text("expires_at"),
    restoredAt: text("restored_at"),
    meta: text("meta"),
    ...timestamps,
  },
  (table) => ({
    userCreatedIndex: index("idx_backup_snapshot_user_created").on(table.userId, table.createdAt),
    bucketKeyIndex: index("idx_backup_snapshot_bucket_key").on(table.bucketKey),
  }),
);

export const importJobs = sqliteTable(
  "import_jobs",
  {
    id: id(),
    userId: userId(),
    sourceType: text("source_type").notNull(),
    fileName: text("file_name").notNull(),
    status: text("status").notNull().default("queued"),
    mappingConfig: text("mapping_config"),
    previewSummary: text("preview_summary"),
    resultSummary: text("result_summary"),
    progressPercent: integer("progress_percent").default(0),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    ...timestamps,
  },
  (table) => ({
    userStatusIndex: index("idx_import_job_user_status").on(table.userId, table.status),
    userCreatedIndex: index("idx_import_job_user_created").on(table.userId, table.createdAt),
  }),
);

export const sourceDocuments = sqliteTable(
  "source_documents",
  {
    id: id(),
    userId: userId(),
    sourceType: text("source_type").notNull().default("notion"),
    sourceId: text("source_id").notNull(),
    importBatchId: text("import_batch_id"),
    sourceDatabase: text("source_database"),
    title: text("title").notNull(),
    documentRole: text("document_role"),
    canonicalEntityType: text("canonical_entity_type"),
    canonicalEntityId: text("canonical_entity_id"),
    status: text("status").notNull().default("active"),
    url: text("url"),
    rawProperties: text("raw_properties"),
    rawContentPreview: text("raw_content_preview"),
    resolvedAt: text("resolved_at"),
    ...timestamps,
  },
  (table) => ({
    userSourceIndex: index("idx_source_document_user_source").on(table.userId, table.sourceType, table.sourceId),
    canonicalIndex: index("idx_source_document_canonical").on(table.canonicalEntityType, table.canonicalEntityId),
    userDatabaseIndex: index("idx_source_document_user_database").on(table.userId, table.sourceDatabase),
    userRoleIndex: index("idx_source_document_user_role").on(table.userId, table.documentRole),
  }),
);

export const sourceDocumentProperties = sqliteTable(
  "source_document_properties",
  {
    id: id(),
    sourceDocumentId: text("source_document_id")
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: "cascade" }),
    propertyKey: text("property_key").notNull(),
    propertyName: text("property_name").notNull(),
    propertyType: text("property_type"),
    valueText: text("value_text"),
    valueJson: text("value_json"),
    normalizedValue: text("normalized_value"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    sourcePropertyIndex: index("idx_source_property_source_key").on(table.sourceDocumentId, table.propertyKey),
    normalizedIndex: index("idx_source_property_normalized").on(table.normalizedValue),
  }),
);

export const sourceDocumentRelations = sqliteTable(
  "source_document_relations",
  {
    id: id(),
    sourceDocumentId: text("source_document_id")
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: "cascade" }),
    relationName: text("relation_name").notNull(),
    targetSourceId: text("target_source_id"),
    targetTitle: text("target_title"),
    resolvedEntityType: text("resolved_entity_type"),
    resolvedEntityId: text("resolved_entity_id"),
    confidence: real("confidence"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    sourceRelationIndex: index("idx_source_relation_source").on(table.sourceDocumentId),
    resolvedEntityIndex: index("idx_source_relation_resolved").on(table.resolvedEntityType, table.resolvedEntityId),
  }),
);
