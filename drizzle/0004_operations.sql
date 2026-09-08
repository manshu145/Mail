DO $$ BEGIN CREATE TYPE "domain_status" AS ENUM ('pending','ready','warning','disabled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "seed_provider" AS ENUM ('gmail','outlook','other'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "inbox_test_status" AS ENUM ('draft','running','completed','failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "placement_category" AS ENUM ('inbox','promotions','updates','spam','not_found'); EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "sending_domains" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "domain" text NOT NULL, "status" "domain_status" NOT NULL DEFAULT 'pending',
  "spf_ok" boolean NOT NULL DEFAULT false, "dkim_ok" boolean NOT NULL DEFAULT false, "dmarc_ok" boolean NOT NULL DEFAULT false,
  "tracking_domain" text, "last_checked_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "sending_domains_domain_uidx" ON "sending_domains" ("domain");

CREATE TABLE IF NOT EXISTS "worker_heartbeats" (
  "worker_name" text PRIMARY KEY, "last_seen_at" timestamptz NOT NULL DEFAULT now(), "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS "reputation_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "sending_account_id" uuid REFERENCES "sending_accounts"("id") ON DELETE CASCADE,
  "window_hours" integer NOT NULL DEFAULT 24, "sent" integer NOT NULL DEFAULT 0, "bounced" integer NOT NULL DEFAULT 0,
  "deferred" integer NOT NULL DEFAULT 0, "complaints" integer NOT NULL DEFAULT 0, "bounce_rate" real NOT NULL DEFAULT 0,
  "complaint_rate" real NOT NULL DEFAULT 0, "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "reputation_account_created_idx" ON "reputation_snapshots" ("sending_account_id", "created_at");

CREATE TABLE IF NOT EXISTS "seed_inboxes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "email" text NOT NULL, "provider" "seed_provider" NOT NULL, "label" text,
  "active" boolean NOT NULL DEFAULT true, "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "seed_inboxes_email_uidx" ON "seed_inboxes" ("email");

CREATE TABLE IF NOT EXISTS "inbox_tests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "name" text NOT NULL, "campaign_id" uuid REFERENCES "campaigns"("id") ON DELETE SET NULL,
  "status" "inbox_test_status" NOT NULL DEFAULT 'draft', "created_at" timestamptz NOT NULL DEFAULT now(), "completed_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "inbox_tests_created_idx" ON "inbox_tests" ("created_at");

CREATE TABLE IF NOT EXISTS "inbox_test_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "test_id" uuid NOT NULL REFERENCES "inbox_tests"("id") ON DELETE CASCADE,
  "seed_inbox_id" uuid NOT NULL REFERENCES "seed_inboxes"("id") ON DELETE CASCADE, "category" "placement_category" NOT NULL,
  "detail" text, "observed_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "inbox_results_test_idx" ON "inbox_test_results" ("test_id");
CREATE INDEX IF NOT EXISTS "inbox_results_category_idx" ON "inbox_test_results" ("category");
