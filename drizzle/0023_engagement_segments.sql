CREATE TABLE IF NOT EXISTS "engagement_segment_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "list_id" uuid NOT NULL REFERENCES "lists"("id") ON DELETE CASCADE,
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "rule_type" text NOT NULL,
  "window_days" integer,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "engagement_segment_rule_chk" CHECK ("rule_type" IN ('opened','clicked','not_opened','not_clicked','delivered_not_opened','opened_not_clicked')),
  CONSTRAINT "engagement_segment_window_chk" CHECK ("window_days" IS NULL OR ("window_days" >= 1 AND "window_days" <= 3650))
);
CREATE UNIQUE INDEX IF NOT EXISTS "engagement_segment_definitions_list_uidx" ON "engagement_segment_definitions"("list_id");
CREATE INDEX IF NOT EXISTS "engagement_segment_definitions_campaign_idx" ON "engagement_segment_definitions"("campaign_id");
