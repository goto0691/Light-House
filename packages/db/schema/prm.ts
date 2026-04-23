import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { id, timestamps, userId } from "./_helpers";

export const people = sqliteTable(
  "people",
  {
    id: id(),
    userId: userId(),
    notionSourceId: text("notion_source_id"),
    importBatchId: text("import_batch_id"),
    name: text("name").notNull(),
    nickname: text("nickname"),
    birthDate: text("birth_date"),
    photoUrl: text("photo_url"),
    groups: text("groups"),
    dunbarLayer: integer("dunbar_layer"),
    intimacy: integer("intimacy"),
    coreValue: text("core_value"),
    bio: text("bio"),
    lastContactedAt: text("last_contacted_at"),
    contactCadenceDays: integer("contact_cadence_days"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    socialLinks: text("social_links"),
    status: text("status").notNull().default("active"),
    isFavorite: integer("is_favorite", { mode: "boolean" }).default(false),
    ...timestamps,
  },
  (table) => ({
    userStatusIndex: index("idx_person_user_status").on(table.userId, table.status),
    layerIndex: index("idx_person_layer").on(table.userId, table.dunbarLayer),
    lastContactIndex: index("idx_person_last_contact").on(table.lastContactedAt),
    notionSourceIndex: index("idx_person_notion_source").on(table.userId, table.notionSourceId),
  }),
);

export const interactions = sqliteTable(
  "interactions",
  {
    id: id(),
    userId: userId(),
    notionSourceId: text("notion_source_id"),
    importBatchId: text("import_batch_id"),
    personId: text("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    occurredAt: text("occurred_at").notNull(),
    type: text("type").notNull().default("meeting"),
    intensity: integer("intensity"),
    summary: text("summary"),
    content: text("content"),
    protocol: text("protocol"),
    placeId: text("place_id"),
    ...timestamps,
  },
  (table) => ({
    personTimeIndex: index("idx_intr_person_time").on(table.personId, table.occurredAt),
  }),
);

export const gifts = sqliteTable(
  "gifts",
  {
    id: id(),
    userId: userId(),
    personId: text("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),
    title: text("title").notNull(),
    occurredAt: text("occurred_at").notNull(),
    reason: text("reason"),
    cost: integer("cost"),
    satisfaction: text("satisfaction"),
    options: text("options"),
    imageUrl: text("image_url"),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => ({
    personIndex: index("idx_gift_person").on(table.personId),
    notionSourceIndex: index("idx_gift_notion_source").on(table.userId, table.notionSourceId),
  }),
);

export const networkEdges = sqliteTable(
  "network_edges",
  {
    id: id(),
    userId: userId(),
    sourcePersonId: text("source_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    targetPersonId: text("target_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    relationType: text("relation_type"),
    strength: integer("strength"),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => ({
    sourceIndex: index("idx_edge_source").on(table.sourcePersonId),
    targetIndex: index("idx_edge_target").on(table.targetPersonId),
  }),
);
