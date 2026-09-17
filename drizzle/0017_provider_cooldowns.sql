CREATE TABLE IF NOT EXISTS "provider_cooldowns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sending_account_id" uuid NOT NULL REFERENCES "sending_accounts"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "reason" text,
  "last_response" text,
  "detected_at" timestamptz NOT NULL DEFAULT now(),
  "next_probe_at" timestamptz,
  "last_probe_at" timestamptz,
  "cleared_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_cooldowns_account_provider_uidx"
ON "provider_cooldowns"("sending_account_id", "provider");

CREATE INDEX IF NOT EXISTS "provider_cooldowns_active_probe_idx"
ON "provider_cooldowns"("active", "next_probe_at");
