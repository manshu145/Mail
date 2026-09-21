ALTER TABLE "sending_domains" ADD COLUMN IF NOT EXISTS "bounce_domain" text;
ALTER TABLE "sending_domains" ADD COLUMN IF NOT EXISTS "bounce_mx_ok" boolean DEFAULT false NOT NULL;
ALTER TABLE "sending_domains" ADD COLUMN IF NOT EXISTS "bounce_spf_ok" boolean DEFAULT false NOT NULL;
ALTER TABLE "sending_domains" ADD COLUMN IF NOT EXISTS "bounce_status" text DEFAULT 'pending' NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "sending_domains_bounce_domain_uidx"
  ON "sending_domains" ("bounce_domain")
  WHERE "bounce_domain" IS NOT NULL;
