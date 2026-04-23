import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { id, timestamps } from "./_helpers";

export const users = sqliteTable(
  "users",
  {
    id: id(),
    email: text("email").unique().notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    hashedPassword: text("hashed_password"),
    locale: text("locale").default("ko-KR"),
    timezone: text("timezone").default("Asia/Seoul"),
    preferences: text("preferences"),
    ...timestamps,
  },
  (table) => ({
    emailIndex: index("idx_users_email").on(table.email),
  }),
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
});
