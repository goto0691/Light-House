import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { id, timestamps, userId } from "./_helpers";
import { people } from "./prm";
import { sourceDocuments } from "./shared";

export const dailyLogs = sqliteTable(
  "daily_logs",
  {
    id: id(),
    userId: userId(),
    notionSourceId: text("notion_source_id"),
    importBatchId: text("import_batch_id"),
    sourceDocumentId: text("source_document_id").references(() => sourceDocuments.id, { onDelete: "set null" }),
    date: text("date").notNull(),
    mood: integer("mood"),
    energyLevel: integer("energy_level"),
    emotions: text("emotions"),
    gratitude: text("gratitude"),
    journal: text("journal"),
    meditation: text("meditation"),
    meditationVerse: text("meditation_verse"),
    aiSummary: text("ai_summary"),
    ...timestamps,
  },
  (table) => ({
    userDateUnique: index("idx_dl_user_date").on(table.userId, table.date),
    notionSourceIndex: index("idx_dl_notion_source").on(table.userId, table.notionSourceId),
  }),
);

export const dailyLogEntries = sqliteTable(
  "daily_log_entries",
  {
    id: id(),
    userId: userId(),
    dailyLogId: text("daily_log_id")
      .notNull()
      .references(() => dailyLogs.id, { onDelete: "cascade" }),
    sourceDocumentId: text("source_document_id").references(() => sourceDocuments.id, { onDelete: "set null" }),
    kind: text("kind").notNull().default("journal"),
    title: text("title"),
    date: text("date").notNull(),
    body: text("body"),
    emotion: text("emotion"),
    eventSummary: text("event_summary"),
    verse: text("verse"),
    background: text("background"),
    tagsSnapshot: text("tags_snapshot"),
    ...timestamps,
  },
  (table) => ({
    dailyLogIndex: index("idx_daily_entry_log").on(table.dailyLogId),
    userDateKindIndex: index("idx_daily_entry_user_date_kind").on(table.userId, table.date, table.kind),
    sourceDocumentIndex: index("idx_daily_entry_source_document").on(table.sourceDocumentId),
  }),
);

export const dailyEntryPeopleRelations = sqliteTable(
  "daily_entry_people_relations",
  {
    dailyEntryId: text("daily_entry_id")
      .notNull()
      .references(() => dailyLogEntries.id, { onDelete: "cascade" }),
    personId: text("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    context: text("context"),
    sourceDocumentId: text("source_document_id").references(() => sourceDocuments.id, { onDelete: "set null" }),
    confidence: real("confidence"),
    rawValue: text("raw_value"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    pk: index("pk_daily_entry_people").on(table.dailyEntryId, table.personId),
    personIndex: index("idx_daily_entry_people_person").on(table.personId),
    sourceDocumentIndex: index("idx_daily_entry_people_source_document").on(table.sourceDocumentId),
  }),
);

export const dailyLogPeopleRelations = sqliteTable(
  "daily_log_people_relations",
  {
    dailyLogId: text("daily_log_id")
      .notNull()
      .references(() => dailyLogs.id, { onDelete: "cascade" }),
    personId: text("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    context: text("context"),
    sourceDocumentId: text("source_document_id").references(() => sourceDocuments.id, { onDelete: "set null" }),
    confidence: real("confidence"),
    rawValue: text("raw_value"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    pk: index("pk_daily_log_people").on(table.dailyLogId, table.personId),
    personIndex: index("idx_daily_log_people_person").on(table.personId),
    sourceDocumentIndex: index("idx_daily_log_people_source_document").on(table.sourceDocumentId),
  }),
);

export const habits = sqliteTable(
  "habits",
  {
    id: id(),
    userId: userId(),
    title: text("title").notNull(),
    description: text("description"),
    type: text("type").notNull().default("boolean"),
    targetValue: integer("target_value"),
    unit: text("unit"),
    icon: text("icon"),
    color: text("color"),
    schedule: text("schedule"),
    isActive: integer("is_active", { mode: "boolean" }).default(true),
    displayOrder: integer("display_order").default(0),
    ...timestamps,
  },
  (table) => ({
    userActiveIndex: index("idx_habit_user_active").on(table.userId, table.isActive),
  }),
);

export const habitLogs = sqliteTable(
  "habit_logs",
  {
    id: id(),
    userId: userId(),
    habitId: text("habit_id")
      .notNull()
      .references(() => habits.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    value: integer("value").notNull(),
    note: text("note"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    habitDateIndex: index("idx_hl_habit_date").on(table.habitId, table.date),
    userDateIndex: index("idx_hl_user_date").on(table.userId, table.date),
  }),
);

export const workouts = sqliteTable(
  "workouts",
  {
    id: id(),
    userId: userId(),
    notionSourceId: text("notion_source_id"),
    importBatchId: text("import_batch_id"),
    sourceDocumentId: text("source_document_id").references(() => sourceDocuments.id, { onDelete: "set null" }),
    title: text("title"),
    date: text("date").notNull(),
    categories: text("categories").notNull(),
    durationMinutes: integer("duration_minutes"),
    intensity: integer("intensity"),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => ({
    userDateIndex: index("idx_wo_user_date").on(table.userId, table.date),
    notionSourceIndex: index("idx_wo_notion_source").on(table.userId, table.notionSourceId),
    sourceDocumentIndex: index("idx_wo_source_document").on(table.sourceDocumentId),
  }),
);

export const healthMetrics = sqliteTable(
  "health_metrics",
  {
    id: id(),
    userId: userId(),
    date: text("date").notNull(),
    sleepHours: real("sleep_hours"),
    sleepQuality: integer("sleep_quality"),
    weight: real("weight"),
    restingHeartRate: integer("resting_heart_rate"),
    deepWorkMinutes: integer("deep_work_minutes"),
    stepsCount: integer("steps_count"),
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString())
      .$onUpdate(() => new Date().toISOString()),
  },
  (table) => ({
    userDateIndex: index("idx_hm_user_date").on(table.userId, table.date),
  }),
);

export const careerHistory = sqliteTable(
  "career_history",
  {
    id: id(),
    userId: userId(),
    notionSourceId: text("notion_source_id"),
    importBatchId: text("import_batch_id"),
    sourceDocumentId: text("source_document_id").references(() => sourceDocuments.id, { onDelete: "set null" }),
    organization: text("organization").notNull(),
    role: text("role").notNull(),
    category: text("category").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    location: text("location"),
    description: text("description"),
    highlights: text("highlights"),
    coverImageUrl: text("cover_image_url"),
    ...timestamps,
  },
  (table) => ({
    userStartIndex: index("idx_career_user_start").on(table.userId, table.startDate),
    notionSourceIndex: index("idx_career_notion_source").on(table.userId, table.notionSourceId),
    sourceDocumentIndex: index("idx_career_source_document").on(table.sourceDocumentId),
  }),
);
