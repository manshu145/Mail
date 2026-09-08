DO $$ BEGIN CREATE TYPE "segment_field" AS ENUM ('email_domain','validation_status','contact_status'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "segment_operator" AS ENUM ('equals','not_equals'); EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE TABLE IF NOT EXISTS "segment_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "list_id" uuid NOT NULL REFERENCES "lists"("id") ON DELETE CASCADE,
  "field" "segment_field" NOT NULL,
  "operator" "segment_operator" NOT NULL DEFAULT 'equals',
  "value" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "segment_definitions_list_uidx" ON "segment_definitions" ("list_id");
