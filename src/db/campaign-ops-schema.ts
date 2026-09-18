import { index, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaigns, lists } from "./schema";

export const campaignPreflights = pgTable("campaign_preflights", {
  campaignId: uuid("campaign_id").primaryKey().references(() => campaigns.id, { onDelete: "cascade" }),
  listId: uuid("list_id").references(() => lists.id, { onDelete: "set null" }),
  rawCount: integer("raw_count").notNull().default(0),
  eligibleCount: integer("eligible_count").notNull().default(0),
  suppressedCount: integer("suppressed_count").notNull().default(0),
  invalidCount: integer("invalid_count").notNull().default(0),
  validCount: integer("valid_count").notNull().default(0),
  pendingCount: integer("pending_count").notNull().default(0),
  unknownCount: integer("unknown_count").notNull().default(0),
  awaitingValidationCount: integer("awaiting_validation_count").notNull().default(0),
  validationPolicyVersion: integer("validation_policy_version").notNull().default(1),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("campaign_preflights_checked_idx").on(table.checkedAt)]);
