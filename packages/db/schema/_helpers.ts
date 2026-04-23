import { text } from "drizzle-orm/sqlite-core";

import { ulid } from "ulidx";

export const id = () => text("id").primaryKey().$defaultFn(() => ulid());

export const userId = () => text("user_id").notNull();

export const timestamps = {
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString())
    .$onUpdate(() => new Date().toISOString()),
  deletedAt: text("deleted_at"),
};
