CREATE TABLE IF NOT EXISTS "sending_account_warmups" (
  "sending_account_id" uuid PRIMARY KEY REFERENCES "sending_accounts"("id") ON DELETE CASCADE,
  "enabled" boolean NOT NULL DEFAULT false,
  "started_at" timestamptz,
  "day_one_limit" integer NOT NULL DEFAULT 50,
  "growth_percent" integer NOT NULL DEFAULT 50,
  "max_daily_limit" integer NOT NULL DEFAULT 1000,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
