import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { contacts, importJobs } from "./schema";
import type { ImportRow } from "../lib/contact-utils";

export type ImportMapping = Record<string, string>;
export type ImportOptions = {
  consentSource: string;
  consentStatus: "confirmed" | "unconfirmed";
  defaultSource?: string;
  defaultCategory?: string;
  defaultTags?: string[];
  listId?: string | null;
  queueValidation?: boolean;
};

export const importStagingRows = pgTable("import_staging_rows", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => importJobs.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  rowNumber: integer("row_number").notNull(),
  payload: jsonb("payload").$type<ImportRow>().notNull(),
  processed: boolean("processed").notNull().default(false),
  result: text("result"),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("import_staging_job_processed_idx").on(table.jobId, table.processed),
  index("import_staging_result_idx").on(table.result),
  index("import_staging_job_contact_idx").on(table.jobId, table.contactId),
]);

export const importUploads = pgTable("import_uploads", {
  jobId: uuid("job_id").primaryKey().references(() => importJobs.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  headers: jsonb("headers").$type<string[]>().notNull().default([]),
  mapping: jsonb("mapping").$type<ImportMapping>().notNull().default({}),
  options: jsonb("options").$type<ImportOptions>().notNull().default({ consentSource: "", consentStatus: "unconfirmed" }),
  sizeBytes: integer("size_bytes").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("import_uploads_created_idx").on(table.createdAt)]);
