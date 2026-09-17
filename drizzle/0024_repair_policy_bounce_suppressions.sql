DELETE FROM "suppressions" s
WHERE s."reason" = 'hard_bounce'
  AND s."source" IN ('postfix_event', 'verp_dsn', 'mta_event')
  AND EXISTS (
    SELECT 1
    FROM "messages" m
    WHERE lower(m."recipient_email") = s."normalized_email"
      AND (
        lower(coalesce(m."last_error", '')) LIKE '%5.7.%'
        OR lower(coalesce(m."last_error", '')) LIKE '%high probability of spam%'
        OR lower(coalesce(m."last_error", '')) LIKE '%policy%'
        OR lower(coalesce(m."last_error", '')) LIKE '%reputation%'
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "messages" m2
    WHERE lower(m2."recipient_email") = s."normalized_email"
      AND (
        lower(coalesce(m2."last_error", '')) LIKE '%5.1.1%'
        OR lower(coalesce(m2."last_error", '')) LIKE '%user unknown%'
        OR lower(coalesce(m2."last_error", '')) LIKE '%no such user%'
        OR lower(coalesce(m2."last_error", '')) LIKE '%no such mailbox%'
        OR lower(coalesce(m2."last_error", '')) LIKE '%recipient not found%'
      )
  );
