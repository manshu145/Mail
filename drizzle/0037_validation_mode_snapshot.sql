ALTER TABLE "validation_jobs"
ADD COLUMN IF NOT EXISTS "validation_mode" text NOT NULL DEFAULT 'internal';

UPDATE "validation_jobs"
SET "validation_mode" = 'internal'
WHERE "validation_mode" IS NULL
   OR "validation_mode" NOT IN ('internal','hybrid','supersend');

ALTER TABLE "validation_jobs"
DROP CONSTRAINT IF EXISTS "validation_jobs_validation_mode_check";

ALTER TABLE "validation_jobs"
ADD CONSTRAINT "validation_jobs_validation_mode_check"
CHECK ("validation_mode" IN ('internal','hybrid','supersend'));
