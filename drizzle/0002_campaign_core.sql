DO $$ BEGIN CREATE TYPE "campaign_status" AS ENUM ('draft','scheduled','queued','sending','paused','completed','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "message_status" AS ENUM ('queued','ready_for_transport','sending','mta_accepted','deferred','delivered','bounced','failed','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "sending_account_status" AS ENUM ('active','paused','disabled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "job_status" AS ENUM ('pending','processing','completed','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL UNIQUE,
  "subject" text,
  "html_body" text NOT NULL DEFAULT '',
  "text_body" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "sending_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL UNIQUE,
  "from_name" text NOT NULL,
  "from_email" text NOT NULL,
  "reply_to" text,
  "transport_type" text NOT NULL DEFAULT 'postfix',
  "status" "sending_account_status" NOT NULL DEFAULT 'active',
  "hourly_limit" integer NOT NULL DEFAULT 500,
  "daily_limit" integer NOT NULL DEFAULT 1000,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "subject" text NOT NULL,
  "preheader" text,
  "from_name" text,
  "from_email" text,
  "template_id" uuid REFERENCES "templates"("id") ON DELETE SET NULL,
  "list_id" uuid REFERENCES "lists"("id") ON DELETE SET NULL,
  "sending_account_id" uuid REFERENCES "sending_accounts"("id") ON DELETE SET NULL,
  "status" "campaign_status" NOT NULL DEFAULT 'draft',
  "track_opens" boolean NOT NULL DEFAULT true,
  "track_clicks" boolean NOT NULL DEFAULT true,
  "scheduled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "campaigns_status_idx" ON "campaigns"("status");
CREATE INDEX IF NOT EXISTS "campaigns_created_at_idx" ON "campaigns"("created_at");

CREATE TABLE IF NOT EXISTS "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "recipient_email" text NOT NULL,
  "status" "message_status" NOT NULL DEFAULT 'queued',
  "provider_message_id" text,
  "last_error" text,
  "queued_at" timestamptz NOT NULL DEFAULT now(),
  "accepted_at" timestamptz,
  "delivered_at" timestamptz,
  "bounced_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "messages_campaign_idx" ON "messages"("campaign_id");
CREATE INDEX IF NOT EXISTS "messages_status_idx" ON "messages"("status");

CREATE TABLE IF NOT EXISTS "message_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "message_id" uuid NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "message_events_message_idx" ON "message_events"("message_id");
CREATE INDEX IF NOT EXISTS "message_events_created_idx" ON "message_events"("created_at");

CREATE TABLE IF NOT EXISTS "validation_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "status" "job_status" NOT NULL DEFAULT 'pending',
  "scope" text NOT NULL DEFAULT 'gmail',
  "total_rows" integer NOT NULL DEFAULT 0,
  "processed_rows" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "validation_jobs_status_idx" ON "validation_jobs"("status");

CREATE TABLE IF NOT EXISTS "validation_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_id" uuid REFERENCES "validation_jobs"("id") ON DELETE CASCADE,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "status" "validation_status" NOT NULL,
  "detail" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "validation_results_job_idx" ON "validation_results"("job_id");
CREATE INDEX IF NOT EXISTS "validation_results_status_idx" ON "validation_results"("status");

CREATE TABLE IF NOT EXISTS "system_settings" (
  "key" text PRIMARY KEY,
  "value" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
