ALTER TABLE "import_uploads" ADD COLUMN IF NOT EXISTS "storage_path" text;
ALTER TABLE "import_uploads" ALTER COLUMN "content" SET DEFAULT '';
