DO $$ BEGIN
  CREATE TYPE "contact_status" AS ENUM ('active','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "validation_status" AS ENUM ('pending','valid','invalid','unknown','error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "suppression_reason" AS ENUM ('unsubscribe','hard_bounce','manual','invalid','complaint','policy');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "import_status" AS ENUM ('pending','processing','completed','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "normalized_email" text NOT NULL,
  "first_name" text,
  "last_name" text,
  "status" "contact_status" DEFAULT 'active' NOT NULL,
  "validation_status" "validation_status" DEFAULT 'pending' NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,
  "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_normalized_email_uidx" ON "contacts" ("normalized_email");
CREATE INDEX IF NOT EXISTS "contacts_status_idx" ON "contacts" ("status");
CREATE INDEX IF NOT EXISTS "contacts_validation_status_idx" ON "contacts" ("validation_status");
CREATE INDEX IF NOT EXISTS "contacts_created_at_idx" ON "contacts" ("created_at");

CREATE TABLE IF NOT EXISTS "lists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "is_dynamic" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "lists_name_uidx" ON "lists" ("name");

CREATE TABLE IF NOT EXISTS "contact_lists" (
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "list_id" uuid NOT NULL REFERENCES "lists"("id") ON DELETE CASCADE,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("contact_id", "list_id")
);
CREATE INDEX IF NOT EXISTS "contact_lists_list_idx" ON "contact_lists" ("list_id");

CREATE TABLE IF NOT EXISTS "tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "tags_name_uidx" ON "tags" ("name");

CREATE TABLE IF NOT EXISTS "contact_tags" (
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "tag_id" uuid NOT NULL REFERENCES "tags"("id") ON DELETE CASCADE,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("contact_id", "tag_id")
);
CREATE INDEX IF NOT EXISTS "contact_tags_tag_idx" ON "contact_tags" ("tag_id");

CREATE TABLE IF NOT EXISTS "suppressions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "normalized_email" text NOT NULL,
  "reason" "suppression_reason" NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
  "note" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "suppressions_normalized_email_uidx" ON "suppressions" ("normalized_email");
CREATE INDEX IF NOT EXISTS "suppressions_reason_idx" ON "suppressions" ("reason");

CREATE TABLE IF NOT EXISTS "import_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "filename" text NOT NULL,
  "status" "import_status" DEFAULT 'pending' NOT NULL,
  "total_rows" integer DEFAULT 0 NOT NULL,
  "imported_rows" integer DEFAULT 0 NOT NULL,
  "duplicate_rows" integer DEFAULT 0 NOT NULL,
  "invalid_rows" integer DEFAULT 0 NOT NULL,
  "error_message" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "import_jobs_status_idx" ON "import_jobs" ("status");
CREATE INDEX IF NOT EXISTS "import_jobs_created_at_idx" ON "import_jobs" ("created_at");
