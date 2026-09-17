CREATE TABLE IF NOT EXISTS "provider_cooldown_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cooldown_id" uuid REFERENCES "provider_cooldowns"("id") ON DELETE SET NULL,
  "sending_account_id" uuid NOT NULL REFERENCES "sending_accounts"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "event_type" text NOT NULL,
  "reason" text,
  "response" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "provider_cooldown_events_account_provider_idx"
  ON "provider_cooldown_events"("sending_account_id", "provider", "occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "provider_cooldown_events_type_idx"
  ON "provider_cooldown_events"("event_type", "occurred_at" DESC);
