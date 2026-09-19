ALTER TABLE "sending_accounts" ALTER COLUMN "hourly_limit" SET DEFAULT 0;
ALTER TABLE "sending_accounts" ALTER COLUMN "daily_limit" SET DEFAULT 0;

-- Legacy sender identities created before limits were exposed in the UI received
-- the hidden 500/hour + 1000/day defaults. Remove that exact legacy pair so an
-- existing customer is not silently capped after upgrading.
UPDATE "sending_accounts"
SET "hourly_limit" = 0,
    "daily_limit" = 0,
    "updated_at" = now()
WHERE "hourly_limit" = 500
  AND "daily_limit" = 1000;
