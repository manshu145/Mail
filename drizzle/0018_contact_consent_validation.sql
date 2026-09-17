DO $$ BEGIN
  ALTER TYPE "validation_status" ADD VALUE IF NOT EXISTS 'accepted';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "consent_status" text NOT NULL DEFAULT 'unconfirmed',
  ADD COLUMN IF NOT EXISTS "consent_source" text;

CREATE INDEX IF NOT EXISTS "contacts_consent_status_idx"
ON "contacts"("consent_status");
