import { integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { campaigns, lists } from "./schema";

export const segmentField = pgEnum("segment_field", ["email_domain", "validation_status", "contact_status", "custom_attribute"]);
export const segmentOperator = pgEnum("segment_operator", ["equals", "not_equals"]);

export const segmentDefinitions = pgTable("segment_definitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  listId: uuid("list_id").notNull().references(() => lists.id, { onDelete: "cascade" }),
  field: segmentField("field").notNull(),
  attributeKey: text("attribute_key"),
  operator: segmentOperator("operator").notNull().default("equals"),
  value: text("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("segment_definitions_list_uidx").on(table.listId)]);

export const engagementSegmentDefinitions = pgTable("engagement_segment_definitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  listId: uuid("list_id").notNull().references(() => lists.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  ruleType: text("rule_type").notNull(),
  windowDays: integer("window_days"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("engagement_segment_definitions_list_uidx").on(table.listId)]);
