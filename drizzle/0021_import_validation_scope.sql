ALTER TABLE "import_staging_rows"
  ADD COLUMN IF NOT EXISTS "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "import_staging_job_contact_idx"
  ON "import_staging_rows"("job_id", "contact_id");

ALTER TABLE "import_jobs"
  ADD COLUMN IF NOT EXISTS "valid_rows" integer NOT NULL DEFAULT 0;

ALTER TABLE "import_jobs"
  ADD COLUMN IF NOT EXISTS "validation_invalid_rows" integer NOT NULL DEFAULT 0;
