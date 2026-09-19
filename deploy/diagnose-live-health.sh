#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR=${NEXIMAIL_APP_DIR:-/opt/neximail-next}
PROJECT_NAME=${NEXIMAIL_PROJECT_NAME:-neximail-next}
CAMPAIGN_ID=${1:-}

dc=(docker compose --project-directory "$APP_DIR" -p "$PROJECT_NAME" -f "$APP_DIR/docker-compose.prod.yml")

[[ -f "$APP_DIR/docker-compose.prod.yml" ]] || { echo "Missing $APP_DIR/docker-compose.prod.yml"; exit 1; }

psql_exec() {
  "${dc[@]}" exec -T postgres sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -x'
}

psql_scalar() {
  "${dc[@]}" exec -T postgres sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$1"'
}

if [[ -z "$CAMPAIGN_ID" ]]; then
  CAMPAIGN_ID=$("${dc[@]}" exec -T postgres sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select id from campaigns where status in ('\''sending'\'','\''queued'\'','\''paused'\'','\''scheduled'\'') order by coalesce(started_at,scheduled_at,created_at) desc limit 1"' | tr -d '\r')
fi

if [[ -n "$CAMPAIGN_ID" && ! "$CAMPAIGN_ID" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "Invalid campaign id: $CAMPAIGN_ID"
  exit 1
fi

echo "=== NexiMail live health diagnostic ==="
echo "UTC: $(date -u +%FT%TZ)"
echo "Campaign: ${CAMPAIGN_ID:-none}"

echo
echo "===== 1. CONTAINERS ====="
"${dc[@]}" ps

echo
echo "===== 2. WORKER HEARTBEATS ====="
psql_exec <<'SQL'
select
  worker_name,
  last_seen_at,
  round(extract(epoch from (now()-last_seen_at)))::int seconds_ago,
  metadata
from worker_heartbeats
order by worker_name;
SQL

echo
echo "===== 3. ACTIVE COOLDOWNS ====="
psql_exec <<'SQL'
select
  pc.provider,
  sa.name sender,
  pc.reason,
  pc.detected_at,
  pc.last_probe_at,
  pc.next_probe_at,
  now()-pc.detected_at active_for,
  left(pc.last_response,1200) last_response
from provider_cooldowns pc
join sending_accounts sa on sa.id=pc.sending_account_id
where pc.active=true
order by pc.updated_at desc;
SQL

echo
echo "===== 4. SENDER USAGE / LIMITS ====="
psql_exec <<'SQL'
select
  sa.id,
  sa.name,
  sa.status,
  sa.hourly_limit,
  sa.daily_limit,
  count(m.id) filter(where m.accepted_at >= now()-interval '1 hour')::int accepted_last_1h,
  count(m.id) filter(where m.accepted_at >= now()-interval '24 hours')::int accepted_last_24h
from sending_accounts sa
left join campaigns c on c.sending_account_id=sa.id
left join messages m on m.campaign_id=c.id
group by sa.id,sa.name,sa.status,sa.hourly_limit,sa.daily_limit
order by sa.name;
SQL

echo
echo "===== 5. GLOBAL DELIVERY SETTINGS ====="
psql_exec <<'SQL'
select key,value,updated_at
from system_settings
where key like 'delivery.%' or key like 'reputation.%'
order by key;
SQL

if [[ -n "$CAMPAIGN_ID" ]]; then
  export CAMPAIGN_ID

  echo
  echo "===== 6. CAMPAIGN STATE ====="
  "${dc[@]}" exec -T postgres sh -lc '
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -x -v cid="$CAMPAIGN_ID" <<'"'"'SQL'"'"'
select
  c.id,
  c.name,
  c.status,
  c.started_at,
  c.scheduled_at,
  c.updated_at,
  c.last_error,
  sa.name sender,
  sa.status sender_status,
  sa.hourly_limit,
  sa.daily_limit,
  count(m.id)::int total,
  count(*) filter(where m.status='"'"'queued'"'"')::int queued,
  count(*) filter(where m.status='"'"'ready_for_transport'"'"')::int ready,
  count(*) filter(where m.status='"'"'sending'"'"')::int sending,
  count(*) filter(where m.status='"'"'mta_accepted'"'"')::int mta_accepted,
  count(*) filter(where m.status='"'"'deferred'"'"')::int deferred,
  count(*) filter(where m.status='"'"'delivered'"'"')::int delivered,
  count(*) filter(where m.status='"'"'bounced'"'"')::int bounced,
  count(*) filter(where m.status='"'"'failed'"'"')::int failed,
  count(*) filter(where m.status='"'"'cancelled'"'"')::int cancelled,
  min(m.next_attempt_at) filter(where m.status in ('"'"'ready_for_transport'"'"','"'"'deferred'"'"')) earliest_retry,
  max(m.next_attempt_at) filter(where m.status in ('"'"'ready_for_transport'"'"','"'"'deferred'"'"')) latest_retry,
  max(me.created_at) last_event_at
from campaigns c
left join sending_accounts sa on sa.id=c.sending_account_id
left join messages m on m.campaign_id=c.id
left join message_events me on me.message_id=m.id
where c.id=:'"'"'cid'"'"'
group by c.id,sa.id;
SQL
  '

  echo
  echo "===== 7. CAMPAIGN HOLD REASONS ====="
  "${dc[@]}" exec -T postgres sh -lc '
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -x -v cid="$CAMPAIGN_ID" <<'"'"'SQL'"'"'
select
  status,
  coalesce(last_error,'NONE') last_error,
  count(*)::int count,
  min(next_attempt_at) earliest_retry,
  max(next_attempt_at) latest_retry
from messages
where campaign_id=:'"'"'cid'"'"'
group by status,last_error
order by count(*) desc;
SQL
  '

  echo
  echo "===== 8. CAMPAIGN EVENTS (LAST 2H) ====="
  "${dc[@]}" exec -T postgres sh -lc '
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -x -v cid="$CAMPAIGN_ID" <<'"'"'SQL'"'"'
select
  me.type,
  count(*)::int count,
  min(me.created_at) first_seen,
  max(me.created_at) last_seen
from message_events me
join messages m on m.id=me.message_id
where m.campaign_id=:'"'"'cid'"'"'
  and me.created_at >= now()-interval '2 hours'
group by me.type
order by count(*) desc;
SQL
  '
fi

echo
echo "===== 9. COOLDOWN EVENT HISTORY (LAST 2H) ====="
psql_exec <<'SQL'
select
  provider,
  event_type,
  reason,
  created_at,
  left(response,700) response,
  metadata
from provider_cooldown_events
where created_at >= now()-interval '2 hours'
order by created_at desc
limit 60;
SQL

echo
echo "===== 10. POSTFIX QUEUE SUMMARY ====="
"${dc[@]}" exec -T mta sh -lc 'postqueue -p | tail -n 50'

echo
echo "===== 11. RECENT SMTP OUTCOMES ====="
"${dc[@]}" exec -T mta sh -lc '
grep -E "postfix/smtp.*status=(sent|deferred|bounced|expired)" /var/log/mta/mail.log | tail -n 120
' || true

echo
echo "===== 12. RESTRICTION / THROTTLE SIGNALS ====="
"${dc[@]}" exec -T mta sh -lc '
grep -Ei "JFE050005|rate.?limit|thrott|too many|unusual|policy|reputation|blocked|greylist|not yet authorized|try again|temporar|status=deferred|status=bounced" /var/log/mta/mail.log | tail -n 160
' || true

echo
echo "===== 13. TRANSPORT / POSTFIX WORKER LOGS ====="
"${dc[@]}" logs --since=20m --tail=400 transport-worker postfix-event-worker 2>&1 | tail -n 300 || true

echo
echo "===== 14. REDIS / CACHE HEALTH ====="
"${dc[@]}" exec -T redis sh -lc '
echo "PING:"; redis-cli ping
echo "DBSIZE:"; redis-cli dbsize
echo "MEMORY:"; redis-cli info memory | grep -E "used_memory_human|maxmemory_human|maxmemory_policy|mem_fragmentation_ratio"
echo "KEYSPACE:"; redis-cli info keyspace
echo "SAMPLE_KEYS:"; redis-cli --scan | head -n 80
'

echo
echo "===== 15. DATABASE WAITS ====="
psql_exec <<'SQL'
select
  pid,
  state,
  wait_event_type,
  wait_event,
  now()-query_start running_for,
  left(query,300) query
from pg_stat_activity
where datname=current_database()
  and pid<>pg_backend_pid()
  and (state<>'idle' or wait_event is not null)
order by query_start;
SQL

echo
echo "=== Diagnostic complete: read-only, nothing cleared ==="
