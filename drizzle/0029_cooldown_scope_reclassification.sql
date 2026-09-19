-- Reclassify cooldowns created by the old blanket 4.x rule.
-- Recipient/mailbox temporary conditions are not provider-wide restrictions.
UPDATE provider_cooldowns
SET active = false,
    cleared_at = COALESCE(cleared_at, now()),
    next_probe_at = NULL,
    reason = 'reclassified_recipient_or_mailbox_condition',
    updated_at = now()
WHERE active = true
  AND (
    lower(COALESCE(last_response,'')) LIKE '%mailbox delivery restricted by policy%'
    OR lower(COALESCE(last_response,'')) LIKE '%mailbox full%'
    OR lower(COALESCE(last_response,'')) LIKE '%over quota%'
    OR lower(COALESCE(last_response,'')) LIKE '%quota exceeded%'
    OR lower(COALESCE(last_response,'')) LIKE '%recipient temporarily unavailable%'
  );

-- JFE050005 / "originating from your account" is a sender/outbound-path
-- restriction observed across unrelated remote MXes. Consolidate those rows
-- into one sender-scoped cooldown so NexiMail stops all new submissions for
-- that sender until a controlled probe succeeds.
INSERT INTO provider_cooldowns (
  id,
  sending_account_id,
  provider,
  active,
  reason,
  last_response,
  detected_at,
  next_probe_at,
  last_probe_at,
  cleared_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  x.sending_account_id,
  '__sender__',
  true,
  'sender_or_outbound_path_restriction',
  x.last_response,
  x.detected_at,
  x.next_probe_at,
  x.last_probe_at,
  NULL,
  now()
FROM (
  SELECT DISTINCT ON (sending_account_id)
    sending_account_id,
    last_response,
    detected_at,
    next_probe_at,
    last_probe_at,
    updated_at
  FROM provider_cooldowns
  WHERE active = true
    AND (
      lower(COALESCE(last_response,'')) LIKE '%jfe050005%'
      OR lower(COALESCE(last_response,'')) LIKE '%unusual amount of content policy violations originating from your account%'
    )
  ORDER BY sending_account_id, updated_at DESC
) x
ON CONFLICT (sending_account_id, provider)
DO UPDATE SET
  active = true,
  reason = EXCLUDED.reason,
  last_response = EXCLUDED.last_response,
  detected_at = EXCLUDED.detected_at,
  next_probe_at = EXCLUDED.next_probe_at,
  last_probe_at = EXCLUDED.last_probe_at,
  cleared_at = NULL,
  updated_at = now();

UPDATE provider_cooldowns
SET active = false,
    cleared_at = COALESCE(cleared_at, now()),
    next_probe_at = NULL,
    reason = 'reclassified_sender_or_outbound_path_restriction',
    updated_at = now()
WHERE provider <> '__sender__'
  AND active = true
  AND (
    lower(COALESCE(last_response,'')) LIKE '%jfe050005%'
    OR lower(COALESCE(last_response,'')) LIKE '%unusual amount of content policy violations originating from your account%'
  );

-- Any remaining active row must have explicit provider-level evidence.
-- The old implementation treated every 4.x response as provider pressure,
-- so clear generic rows that do not contain a restriction signal.
UPDATE provider_cooldowns
SET active = false,
    cleared_at = COALESCE(cleared_at, now()),
    next_probe_at = NULL,
    reason = 'reclassified_non_restriction_4xx',
    updated_at = now()
WHERE active = true
  AND provider <> '__sender__'
  AND NOT (
    lower(COALESCE(last_response,'')) ~
      '(rate[ -]?limit|too many (messages|connections|requests)|throttl|unusual traffic|temporar(y|ily) blocked|temporary block|not yet authorized to deliver mail from|sender( ip)? reputation|ip reputation|greylist(ed|ing)?.*(sender|ip)|try again later.*(rate|sender|ip|reputation))'
  );
