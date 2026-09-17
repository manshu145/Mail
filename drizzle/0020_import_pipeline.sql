CREATE TABLE IF NOT EXISTS "import_uploads" (
  "job_id" uuid PRIMARY KEY REFERENCES "import_jobs"("id") ON DELETE CASCADE,
  "content" text NOT NULL,
  "headers" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "mapping" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "options" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "size_bytes" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "import_uploads_created_idx"
ON "import_uploads"("created_at");

ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "source_label" text;
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "suppressed_rows" integer NOT NULL DEFAULT 0;
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "risky_rows" integer NOT NULL DEFAULT 0;
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "validation_job_id" uuid REFERENCES "validation_jobs"("id") ON DELETE SET NULL;
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "started_at" timestamptz;

CREATE INDEX IF NOT EXISTS "import_jobs_validation_job_idx"
ON "import_jobs"("validation_job_id");