DO $$ BEGIN
  CREATE TYPE "webhook_delivery_status" AS ENUM ('pending','processing','delivered','failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "webhook_delivery_status" ADD VALUE IF NOT EXISTS 'processing';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "key_prefix" text NOT NULL,
  "key_hash" text NOT NULL,
  "scopes" text[] DEFAULT '{}'::text[] NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_uidx" ON "api_keys" ("key_hash");
CREATE INDEX IF NOT EXISTS "api_keys_prefix_idx" ON "api_keys" ("key_prefix");
CREATE INDEX IF NOT EXISTS "api_keys_created_idx" ON "api_keys" ("created_at");

CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "secret_ciphertext" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "webhook_endpoints_active_idx" ON "webhook_endpoints" ("active");
CREATE INDEX IF NOT EXISTS "webhook_endpoints_created_idx" ON "webhook_endpoints" ("created_at");

CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "webhook_events_type_created_idx" ON "webhook_events" ("event_type","created_at");

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "webhook_event_id" uuid NOT NULL REFERENCES "webhook_events"("id") ON DELETE cascade,
  "webhook_endpoint_id" uuid NOT NULL REFERENCES "webhook_endpoints"("id") ON DELETE cascade,
  "status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "response_code" integer,
  "response_text" text,
  "next_attempt_at" timestamp with time zone DEFAULT now(),
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "webhook_deliveries_due_idx" ON "webhook_deliveries" ("status","next_attempt_at");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_event_idx" ON "webhook_deliveries" ("webhook_event_id");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" ("webhook_endpoint_id");
