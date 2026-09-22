import { index, integer, jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
  status: text("status").notNull().default("warning"),
  checks: jsonb("checks").$type<Array<Record<string, unknown>>>().notNull().default([]),
  blockingIssues: jsonb("blocking_issues").$type<string[]>().notNull().default([]),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("campaign_preflights_checked_idx").on(table.checkedAt)]);

export const campaignDeliverySafety = pgTable("campaign_delivery_safety", {
  campaignId: uuid("campaign_id").primaryKey().references(() => campaigns.id, { onDelete: "cascade" }),
  phase: integer("phase").notNull().default(0),
  releaseLimit: integer("release_limit").notNull().default(0),
  state: text("state").notNull().default("canary"),
  sampleCount: integer("sample_count").notNull().default(0),
  bouncedCount: integer("bounced_count").notNull().default(0),
  bounceRate: real("bounce_rate").notNull().default(0),
  reason: text("reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("campaign_delivery_safety_state_idx").on(table.state, table.updatedAt)]);
