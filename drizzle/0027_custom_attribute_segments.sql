ALTER TYPE "segment_field" RENAME TO "segment_field_old";
CREATE TYPE "segment_field" AS ENUM ('email_domain','validation_status','contact_status','custom_attribute');
ALTER TABLE "segment_definitions"
  ALTER COLUMN "field" TYPE "segment_field"
  USING "field"::text::"segment_field";
DROP TYPE "segment_field_old";
ALTER TABLE "segment_definitions" ADD COLUMN IF NOT EXISTS "attribute_key" text;
