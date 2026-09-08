CREATE TABLE IF NOT EXISTS "import_staging_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "import_jobs"("id") ON DELETE CASCADE,
  "row_number" integer NOT NULL,
  "payload" jsonb NOT NULL,
  "processed" boolean DEFAULT false NOT NULL,
  "result" text,
  "detail" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "import_staging_job_processed_idx" ON "import_staging_rows" ("job_id", "processed");
CREATE INDEX IF NOT EXISTS "import_staging_result_idx" ON "import_staging_rows" ("result");
