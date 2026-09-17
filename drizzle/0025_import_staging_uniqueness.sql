CREATE UNIQUE INDEX IF NOT EXISTS "import_staging_job_row_uidx"
ON "import_staging_rows" ("job_id", "row_number");
