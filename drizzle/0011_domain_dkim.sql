ALTER TABLE "sending_domains" ADD COLUMN IF NOT EXISTS "dkim_selector" text DEFAULT 'default' NOT NULL;
ALTER TABLE "sending_domains" ADD COLUMN IF NOT EXISTS "dkim_public_key" text;
ALTER TABLE "sending_domains" ADD COLUMN IF NOT EXISTS "dkim_private_key_ciphertext" text;
