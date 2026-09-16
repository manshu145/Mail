ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "list_id" uuid;
DO $$ BEGIN
  ALTER TABLE "import_jobs"
  ADD CONSTRAINT "import_jobs_list_id_lists_id_fk"
  FOREIGN KEY ("list_id") REFERENCES "lists"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "import_jobs_list_id_idx" ON "import_jobs" ("list_id");
