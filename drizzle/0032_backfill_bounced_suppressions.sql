INSERT INTO "suppressions" ("email","normalized_email","reason","source","contact_id","note","created_at")
SELECT
  m."recipient_email",
  lower(trim(m."recipient_email")),
  'bounce'::suppression_reason,
  'bounce_backfill',
  m."contact_id",
  COALESCE(m."last_error",'Backfilled from terminal bounced message'),
  COALESCE(m."bounced_at",now())
FROM "messages" m
WHERE m."status"='bounced'
ON CONFLICT ("normalized_email") DO NOTHING;
