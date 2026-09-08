import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["owner", "admin", "operator"]);
export const userStatus = pgEnum("user_status", ["active", "disabled"]);
export const contactStatus = pgEnum("contact_status", ["active", "archived"]);
export const validationStatus = pgEnum("validation_status", ["pending", "valid", "invalid", "unknown", "error"]);
export const suppressionReason = pgEnum("suppression_reason", ["unsubscribe", "hard_bounce", "manual", "invalid", "complaint", "policy"]);
export const importStatus = pgEnum("import_status", ["pending", "processing", "completed", "failed"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull().default("operator"),
  status: userStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const contacts = pgTable("contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  normalizedEmail: text("normalized_email").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  status: contactStatus("status").notNull().default("active"),
  validationStatus: validationStatus("validation_status").notNull().default("pending"),
  source: text("source").notNull().default("manual"),
  attributes: jsonb("attributes").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("contacts_normalized_email_uidx").on(table.normalizedEmail),
  index("contacts_status_idx").on(table.status),
  index("contacts_validation_status_idx").on(table.validationStatus),
  index("contacts_created_at_idx").on(table.createdAt),
]);

export const lists = pgTable("lists", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isDynamic: boolean("is_dynamic").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("lists_name_uidx").on(table.name)]);

export const contactLists = pgTable("contact_lists", {
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  listId: uuid("list_id").notNull().references(() => lists.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.contactId, table.listId] }), index("contact_lists_list_idx").on(table.listId)]);

export const tags = pgTable("tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("tags_name_uidx").on(table.name)]);

export const contactTags = pgTable("contact_tags", {
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.contactId, table.tagId] }), index("contact_tags_tag_idx").on(table.tagId)]);

export const suppressions = pgTable("suppressions", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  normalizedEmail: text("normalized_email").notNull(),
  reason: suppressionReason("reason").notNull(),
  source: text("source").notNull().default("manual"),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("suppressions_normalized_email_uidx").on(table.normalizedEmail), index("suppressions_reason_idx").on(table.reason)]);

export const importJobs = pgTable("import_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  filename: text("filename").notNull(),
  status: importStatus("status").notNull().default("pending"),
  totalRows: integer("total_rows").notNull().default(0),
  importedRows: integer("imported_rows").notNull().default(0),
  duplicateRows: integer("duplicate_rows").notNull().default(0),
  invalidRows: integer("invalid_rows").notNull().default(0),
  errorMessage: text("error_message"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [index("import_jobs_status_idx").on(table.status), index("import_jobs_created_at_idx").on(table.createdAt)]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  metadataJson: text("metadata_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
