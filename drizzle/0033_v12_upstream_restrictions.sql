-- Collapse legacy JFE bridge responses into one outbound-infrastructure
-- circuit breaker per sending account. This migration is idempotent.
insert into provider_cooldowns (
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
select distinct on (sending_account_id)
  sending_account_id,
  '__upstream__',
  true,
  'sender_or_outbound_path_restriction',
  last_response,
  detected_at,
  least(coalesce(next_probe_at, now()), now() + interval '60 minutes'),
  last_probe_at,
  null,
  now()
from provider_cooldowns
where active=true
  and provider <> '__upstream__'
  and coalesce(last_response,'') ~* '(JFE050004|JFE050005|unusual number of invalid recipients originating from your account|unusual amount of content policy violations originating from your account)'
order by sending_account_id, updated_at desc
on conflict (sending_account_id,provider) do update set
  active=true,
  reason=excluded.reason,
  last_response=excluded.last_response,
  detected_at=excluded.detected_at,
  next_probe_at=excluded.next_probe_at,
  cleared_at=null,
  updated_at=now();

update provider_cooldowns
set active=false,
    cleared_at=coalesce(cleared_at,now()),
    next_probe_at=null,
    updated_at=now()
where active=true
  and provider <> '__upstream__'
  and coalesce(last_response,'') ~* '(JFE050004|JFE050005|unusual number of invalid recipients originating from your account|unusual amount of content policy violations originating from your account)';

-- Normalize unsafe legacy control-plane values. Application code also clamps
-- reads, but persisting the effective value prevents UI/worker disagreement.
update system_settings
set value='60'::jsonb, updated_at=now()
where key='delivery.provider_cooldown_minutes'
  and case
    when jsonb_typeof(value)='number' then (value #>> '{}')::numeric > 60
    when jsonb_typeof(value)='string' and (value #>> '{}') ~ '^[0-9]+$' then (value #>> '{}')::numeric > 60
    else false
  end;

update messages m
set next_attempt_at=now(),
    last_error=null
where m.status='ready_for_transport'
  and (
    m.last_error in ('sender_cooldown','upstream_cooldown','provider_cooldown:__sender__','provider_cooldown:__upstream__')
    or m.last_error like 'provider_cooldown:%'
  )
  and exists (
    select 1
    from campaigns c
    join provider_cooldowns pc
      on pc.sending_account_id=c.sending_account_id
     and pc.provider='__upstream__'
     and pc.active=true
    where c.id=m.campaign_id
  );
