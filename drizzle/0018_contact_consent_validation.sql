DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'validation_status' AND e.enumlabel = 'accepted'
  ) THEN
    CREATE TYPE "validation_status_v2" AS ENUM ('pending', 'accepted', 'valid', 'invalid', 'unknown', 'error');

    ALTER TABLE "contacts"
      ALTER COLUMN "validation_status" DROP DEFAULT,
      ALTER COLUMN "validation_status" TYPE "validation_status_v2"
        USING "validation_status"::text::"validation_status_v2";

    ALTER TABLE "validation_results"
      ALTER COLUMN "status" TYPE "validation_status_v2"
        USING "status"::text::"validation_status_v2";

    DROP TYPE "validation_status";
    ALTER TYPE "validation_status_v2" RENAME TO "validation_status";

    ALTER TABLE "contacts"
      ALTER COLUMN "validation_status" SET DEFAULT 'pending'::"validation_status";
  END IF;
END $$;

ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "consent_status" text NOT NULL DEFAULT 'unconfirmed',
  ADD COLUMN IF NOT EXISTS "consent_source" text;

CREATE INDEX IF NOT EXISTS "contacts_consent_status_idx"
ON "contacts"("consent_status");
