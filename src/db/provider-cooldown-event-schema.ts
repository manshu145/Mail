import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sendingAccounts } from "./schema";
import { providerCooldowns } from "./operations-schema";

export const providerCooldownEvents = pgTable("provider_cooldown_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  cooldownId: uuid("cooldown_id").references(() => providerCooldowns.id, { onDelete: "set null" }),
  sendingAccountId: uuid("sending_account_id").notNull().references(() => sendingAccounts.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  eventType: text("event_type").notNull(),
  reason: text("reason"),
  response: text("response"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("provider_cooldown_events_account_provider_idx").on(table.sendingAccountId, table.provider, table.occurredAt),
  index("provider_cooldown_events_type_idx").on(table.eventType, table.occurredAt),
]);
