import { boolean, index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { campaigns, sendingAccounts } from "./schema";

export const domainStatus = pgEnum("domain_status", ["pending", "ready", "warning", "disabled"]);
export const seedProvider = pgEnum("seed_provider", ["gmail", "outlook", "other"]);
export const inboxTestStatus = pgEnum("inbox_test_status", ["draft", "running", "completed", "failed"]);
export const placementCategory = pgEnum("placement_category", ["inbox", "promotions", "updates", "spam", "not_found"]);

export const sendingDomains = pgTable("sending_domains", {
  id: uuid("id").defaultRandom().primaryKey(),
  domain: text("domain").notNull(),
  status: domainStatus("status").notNull().default("pending"),
  spfOk: boolean("spf_ok").notNull().default(false),
  dkimOk: boolean("dkim_ok").notNull().default(false),
  dmarcOk: boolean("dmarc_ok").notNull().default(false),
  trackingDomain: text("tracking_domain"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("sending_domains_domain_uidx").on(table.domain)]);

export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerName: text("worker_name").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
});

export const reputationSnapshots = pgTable("reputation_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  sendingAccountId: uuid("sending_account_id").references(() => sendingAccounts.id, { onDelete: "cascade" }),
  windowHours: integer("window_hours").notNull().default(24),
  sent: integer("sent").notNull().default(0),
  bounced: integer("bounced").notNull().default(0),
  deferred: integer("deferred").notNull().default(0),
  complaints: integer("complaints").notNull().default(0),
  bounceRate: real("bounce_rate").notNull().default(0),
  complaintRate: real("complaint_rate").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("reputation_account_created_idx").on(table.sendingAccountId, table.createdAt)]);

export const seedInboxes = pgTable("seed_inboxes", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  provider: seedProvider("provider").notNull(),
  label: text("label"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("seed_inboxes_email_uidx").on(table.email)]);

export const inboxTests = pgTable("inbox_tests", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  status: inboxTestStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [index("inbox_tests_created_idx").on(table.createdAt)]);

export const inboxTestResults = pgTable("inbox_test_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  testId: uuid("test_id").notNull().references(() => inboxTests.id, { onDelete: "cascade" }),
  seedInboxId: uuid("seed_inbox_id").notNull().references(() => seedInboxes.id, { onDelete: "cascade" }),
  category: placementCategory("category").notNull(),
  detail: text("detail"),
  observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("inbox_results_test_idx").on(table.testId), index("inbox_results_category_idx").on(table.category)]);
