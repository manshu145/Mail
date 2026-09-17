UPDATE "validation_results"
SET "status" = 'accepted'
WHERE "status" = 'unknown'
  AND "detail" IN ('gmail_rcpt_250_accepted_not_proof', 'gmail_rcpt_251_accepted_not_proof');

UPDATE "contacts" c
SET "validation_status" = 'accepted', "updated_at" = now()
WHERE c."validation_status" = 'unknown'
  AND (
    SELECT vr."detail"
    FROM "validation_results" vr
    WHERE vr."contact_id" = c."id"
    ORDER BY vr."created_at" DESC
    LIMIT 1
  ) IN ('gmail_rcpt_250_accepted_not_proof', 'gmail_rcpt_251_accepted_not_proof');
