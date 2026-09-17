ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "started_at" timestamptz;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "completed_at" timestamptz;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "audience_count" integer;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "message_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "last_error" text;

CREATE INDEX IF NOT EXISTS "campaigns_scheduled_due_idx" ON "campaigns"("status", "scheduled_at");
CREATE INDEX IF NOT EXISTS "messages_provider_message_id_idx" ON "messages"("provider_message_id");
CREATE INDEX IF NOT EXISTS "message_events_type_created_idx" ON "message_events"("type", "created_at");
