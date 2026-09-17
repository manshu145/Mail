CREATE TABLE IF NOT EXISTS "campaign_preflights" (
  "campaign_id" uuid PRIMARY KEY REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "list_id" uuid REFERENCES "lists"("id") ON DELETE SET NULL,
  "raw_count" integer NOT NULL DEFAULT 0,
  "eligible_count" integer NOT NULL DEFAULT 0,
  "suppressed_count" integer NOT NULL DEFAULT 0,
  "invalid_count" integer NOT NULL DEFAULT 0,
  "valid_count" integer NOT NULL DEFAULT 0,
  "pending_count" integer NOT NULL DEFAULT 0,
  "unknown_count" integer NOT NULL DEFAULT 0,
  "checked_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "campaign_preflights_checked_idx" ON "campaign_preflights"("checked_at");
