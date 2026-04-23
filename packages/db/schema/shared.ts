import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  }),
);
