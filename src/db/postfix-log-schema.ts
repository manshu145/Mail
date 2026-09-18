import { sql } from "drizzle-orm";
import { bigint, bigserial, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
export const postfixLogCheckpoints = pgTable("postfix_log_checkpoints", {
  fileKey: text("file_key").primaryKey(),
  byteOffset: bigint("byte_offset", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const postfixLogInbox = pgTable("postfix_log_inbox", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  fileKey: text("file_key").notNull(), lineKey: text("line_key").notNull(),
  queueId: text("queue_id").notNull(), messageId: uuid("message_id"), outcome: text("outcome"),
  rawLine: text("raw_line").notNull(), processedAt: timestamp("processed_at", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.fileKey, t.lineKey),
  index("postfix_log_pending_idx").on(t.nextAttemptAt, t.id).where(sql`${t.outcome} is not null and ${t.processedAt} is null`),
  index("postfix_log_mapping_idx").on(t.queueId, t.id.desc()).where(sql`${t.messageId} is not null`),
]);
