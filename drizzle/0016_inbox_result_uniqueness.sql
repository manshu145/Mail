WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "test_id", "seed_inbox_id"
      ORDER BY "observed_at" DESC, "id" DESC
    ) AS rn
  FROM "inbox_test_results"
)
DELETE FROM "inbox_test_results"
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS "inbox_results_test_seed_uidx"
ON "inbox_test_results"("test_id", "seed_inbox_id");
