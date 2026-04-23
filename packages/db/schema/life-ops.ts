import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { id, timestamps, userId } from "./_helpers";

export const dailyLogs = sqliteTable(
  "daily_logs",
  {
    id: id(),
    userId: userId(),
    notionSourceId: text("notion_source_id"),
    importBatchId: text("import_batch_id"),
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
  }),
);
