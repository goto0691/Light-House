import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { id, timestamps, userId } from "./_helpers";
import { people } from "./prm";

export const zettels = sqliteTable(
  "zettels",
  {
    id: id(),
    userId: userId(),
    notionSourceId: text("notion_source_id"),
    importBatchId: text("import_batch_id"),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    content: text("content"),
    contentText: text("content_text"),
    summary: text("summary"),
    type: text("type").notNull().default("fleeting"),
    category: text("category"),
    source: text("source"),
    sourceUrl: text("source_url"),
    vectorId: text("vector_id"),
    vectorHash: text("vector_hash"),
    pinned: integer("pinned", { mode: "boolean" }).default(false),
    ...timestamps,
  },
  (table) => ({
    userTypeIndex: index("idx_zettel_user_type").on(table.userId, table.type),
    slugUnique: index("idx_zettel_slug").on(table.userId, table.slug),
    notionSourceIndex: index("idx_zettel_notion_source").on(table.userId, table.notionSourceId),
  }),
);

export const zettelLinks = sqliteTable(
  "zettel_links",
  {
    id: id(),
    sourceId: text("source_id")
      .notNull()
      .references(() => zettels.id, { onDelete: "cascade" }),
    targetId: text("target_id")
      .notNull()
      .references(() => zettels.id, { onDelete: "cascade" }),
    context: text("context"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    sourceIndex: index("idx_zlink_source").on(table.sourceId),
    targetIndex: index("idx_zlink_target").on(table.targetId),
  }),
);

export const mediaLogs = sqliteTable(
  "media_logs",
  {
    id: id(),
    userId: userId(),
    notionSourceId: text("notion_source_id"),
    importBatchId: text("import_batch_id"),
    mediaType: text("media_type").notNull(),
    title: text("title").notNull(),
    originalTitle: text("original_title"),
    platformOrPublisher: text("platform_or_publisher"),
    creator: text("creator"),
    studio: text("studio"),
    genre: text("genre"),
    releaseYear: integer("release_year"),
    status: text("status").notNull().default("backlog"),
    rating: real("rating"),
    evaluation: text("evaluation"),
    review: text("review"),
    content: text("content"),
    playTime: integer("play_time"),
    author: text("author"),
    pages: integer("pages"),
    screenKind: text("screen_kind"),
    rewatchValue: integer("rewatch_value", { mode: "boolean" }).default(false),
    coverImageUrl: text("cover_image_url"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    ...timestamps,
  },
  (table) => ({
    userTypeStatusIndex: index("idx_media_user_type_status").on(table.userId, table.mediaType, table.status),
    notionSourceIndex: index("idx_media_notion_source").on(table.userId, table.notionSourceId),
  }),
);

export const assets = sqliteTable("assets", {
  id: id(),
  userId: userId(),
  category: text("category").notNull(),
  name: text("name").notNull(),
  brand: text("brand"),
  modelName: text("model_name"),
  acquiredDate: text("acquired_date"),
  acquiredPrice: integer("acquired_price"),
  currentCondition: text("current_condition"),
  notes: text("notes"),
  coverImageUrl: text("cover_image_url"),
  ...timestamps,
});

export const places = sqliteTable("places", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  address: text("address"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  mapUrl: text("map_url"),
  firstVisitedAt: text("first_visited_at"),
  lastVisitedAt: text("last_visited_at"),
  visitCount: integer("visit_count").default(0),
  averageRating: real("average_rating"),
  notes: text("notes"),
  ...timestamps,
});

export const placeVisits = sqliteTable("place_visits", {
  id: id(),
  placeId: text("place_id")
    .notNull()
    .references(() => places.id, { onDelete: "cascade" }),
  visitedAt: text("visited_at").notNull(),
  rating: real("rating"),
  review: text("review"),
  companionIds: text("companion_ids"),
  expense: integer("expense"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const zettelMediaRelations = sqliteTable(
  "zettel_media_relations",
  {
    zettelId: text("zettel_id")
      .notNull()
      .references(() => zettels.id, { onDelete: "cascade" }),
    mediaId: text("media_id")
      .notNull()
      .references(() => mediaLogs.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    pk: index("pk_zettel_media").on(table.zettelId, table.mediaId),
  }),
);

export const zettelPeopleRelations = sqliteTable(
  "zettel_people_relations",
  {
    zettelId: text("zettel_id")
      .notNull()
      .references(() => zettels.id, { onDelete: "cascade" }),
    personId: text("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    context: text("context"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    pk: index("pk_zettel_people").on(table.zettelId, table.personId),
  }),
);

export const mediaPeopleRelations = sqliteTable("media_people_relations", {
  mediaId: text("media_id")
    .notNull()
    .references(() => mediaLogs.id, { onDelete: "cascade" }),
  personId: text("person_id")
    .notNull()
    .references(() => people.id, { onDelete: "cascade" }),
  context: text("context"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
