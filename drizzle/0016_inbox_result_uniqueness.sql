DELETE FROM "inbox_test_results" a
USING "inbox_test_results" b
WHERE a."test_id" = b."test_id"
  AND a."seed_inbox_id" = b."seed_inbox_id"
  AND a."observed_at" < b."observed_at";

CREATE UNIQUE INDEX IF NOT EXISTS "inbox_results_test_seed_uidx"
ON "inbox_test_results"("test_id", "seed_inbox_id");
