import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { id, timestamps, userId } from "./_helpers";

export const quickCaptures = sqliteTable(
  "quick_captures",
  {
    id: id(),
    userId: userId(),
    rawText: text("raw_text").notNull(),
    status: text("status").notNull().default("pending"),
    suggestedDomain: text("suggested_domain"),
    suggestedFields: text("suggested_fields"),
    confidence: real("confidence"),
    routedEntityType: text("routed_entity_type"),
    routedEntityId: text("routed_entity_id"),
    ...timestamps,
  },
  (table) => ({
    userStatusIndex: index("idx_qc_user_status").on(table.userId, table.status),
  }),
);

export const aiConversations = sqliteTable(
  "ai_conversations",
  {
    id: id(),
    userId: userId(),
    purpose: text("purpose").notNull(),
    input: text("input").notNull(),
    output: text("output").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    userTimeIndex: index("idx_ai_user_time").on(table.userId, table.createdAt),
  }),
);
