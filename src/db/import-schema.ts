import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { importJobs } from "./schema";
import type { ImportRow } from "../lib/contact-utils";

export const importStagingRows = pgTable("import_staging_rows", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => importJobs.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number").notNull(),
  payload: jsonb("payload").$type<ImportRow>().notNull(),
  processed: boolean("processed").notNull().default(false),
  result: text("result"),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("import_staging_job_processed_idx").on(table.jobId, table.processed), index("import_staging_result_idx").on(table.result)]);
