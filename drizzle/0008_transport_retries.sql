ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "attempt_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamp with time zone;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "messages_transport_ready_idx" ON "messages" ("status","next_attempt_at","queued_at");
