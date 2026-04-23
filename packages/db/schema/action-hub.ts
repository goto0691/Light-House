import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { id, timestamps, userId } from "./_helpers";
import { people } from "./prm";
import { zettels } from "./vault";

export const projects = sqliteTable(
  "projects",
  {
    id: id(),
    userId: userId(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    icon: text("icon"),
    color: text("color"),
    kind: text("kind").notNull().default("project"),
    status: text("status").notNull().default("active"),
    category: text("category"),
    startDate: text("start_date"),
    targetDate: text("target_date"),
    progress: integer("progress").default(0),
    pinned: integer("pinned", { mode: "boolean" }).default(false),
    displayOrder: integer("display_order").default(0),
    ...timestamps,
  },
  (table) => ({
    userStatusIndex: index("idx_proj_user_status").on(table.userId, table.status),
    slugUnique: index("idx_proj_slug").on(table.userId, table.slug),
  }),
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: id(),
    userId: userId(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind").notNull().default("development"),
    content: text("content"),
    status: text("status").notNull().default("todo"),
    priority: text("priority").notNull().default("P2"),
    brainEnergy: text("brain_energy").notNull().default("normal"),
    startAt: text("start_at"),
    dueAt: text("due_at"),
    completedAt: text("completed_at"),
    displayOrder: integer("display_order").default(0),
    wordCount: integer("word_count"),
    episodeNumber: integer("episode_number"),
    ...timestamps,
  },
  (table) => ({
    projectIndex: index("idx_task_project").on(table.projectId),
    userStatusIndex: index("idx_task_user_status").on(table.userId, table.status),
    dueIndex: index("idx_task_due").on(table.dueAt),
    kindIndex: index("idx_task_kind").on(table.kind),
  }),
);

export const checklists = sqliteTable(
  "checklists",
  {
    id: id(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    isCompleted: integer("is_completed", { mode: "boolean" }).default(false),
    displayOrder: integer("display_order").default(0),
    completedAt: text("completed_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    taskIndex: index("idx_checklist_task").on(table.taskId),
  }),
);

export const taskPeopleRelations = sqliteTable(
  "task_people_relations",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    personId: text("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    roleContext: text("role_context"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    pk: index("pk_task_people").on(table.taskId, table.personId),
  }),
);

export const taskZettelRelations = sqliteTable(
  "task_zettel_relations",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    zettelId: text("zettel_id")
      .notNull()
      .references(() => zettels.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    pk: index("pk_task_zettel").on(table.taskId, table.zettelId),
  }),
);
