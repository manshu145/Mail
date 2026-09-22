#!/usr/bin/env bash
# One-shot production repair for the 2026-09-22 incident.
# Keeps useful safety fixes, removes only temporary debugging machinery,
# and does not release held mail while the upstream Mail Bridge is restricted.
set -Eeuo pipefail
umask 077

echo "=== NEXIMAIL PRODUCTION REPAIR STARTING ==="

APP_DIR=/opt/neximail-next
PROJECT=neximail-next
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP=/opt/neximail-backups/repair-$STAMP
DC="docker compose --project-directory $APP_DIR -p $PROJECT -f $APP_DIR/docker-compose.prod.yml"

[ "$EUID" -eq 0 ] || { echo "Run as root"; exit 1; }
[ -d "$APP_DIR/.git" ] && [ -f "$APP_DIR/.env" ] || { echo "Missing $APP_DIR checkout/.env"; exit 1; }

mkdir -p "$BACKUP"
cp -a "$APP_DIR/.env" "$BACKUP/.env.before"
$DC ps > "$BACKUP/services.before.txt" || true
$DC exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' </dev/null > "$BACKUP/database.dump"
[ -s "$BACKUP/database.dump" ] || { echo "Database backup failed"; exit 1; }
$DC exec -T mta postqueue -p </dev/null > "$BACKUP/postfix-queue.before.txt" 2>&1 || true

echo "== 1/5 Remove only temporary systemd worker guard =="
systemctl disable --now neximail-worker-guard.timer 2>/dev/null || true
systemctl stop neximail-worker-guard.service 2>/dev/null || true
rm -f /etc/systemd/system/neximail-worker-guard.timer /etc/systemd/system/neximail-worker-guard.service /usr/local/bin/neximail-worker-guard.sh
systemctl daemon-reload

echo "== 2/5 Keep corrected transport polling; conservative send rate =="
set_env() {
  key="$1"; value="$2"
  if grep -q "^$key=" "$APP_DIR/.env"; then
    sed -i "s|^$key=.*|$key=$value|" "$APP_DIR/.env"
  else
    echo "$key=$value" >> "$APP_DIR/.env"
  fi
}
set_env TRANSPORT_RATE_PER_SECOND 1
set_env TRANSPORT_BATCH_SIZE 10
set_env TRANSPORT_WORKER_INTERVAL_MS 1000

echo "== 3/5 Clear only manually injected debug cooldown, if still present =="
$DC exec -T postgres psql -U neximail -d neximail -v ON_ERROR_STOP=1 -c "
UPDATE provider_cooldowns
SET active=false,
    cleared_at=COALESCE(cleared_at,NOW()),
    next_probe_at=NULL,
    updated_at=NOW()
WHERE provider='__sender__'
  AND active=true
  AND last_response='JFE050004: unusual number of invalid recipients originating from your account';
" </dev/null

echo "== 4/5 Deploy corrected current code, not old broken baseline =="
git -C "$APP_DIR" fetch origin main
REVISION=$(git -C "$APP_DIR" rev-parse origin/main)
RELEASE=/opt/neximail-releases/repair-$REVISION
if [ ! -f "$RELEASE/package.json" ]; then
  git -C "$APP_DIR" worktree add --detach "$RELEASE" "$REVISION"
fi
[ "$(git -C "$RELEASE" rev-parse HEAD)" = "$REVISION" ] || { echo "Repair worktree mismatch"; exit 1; }
ln -sfn "$APP_DIR/.env" "$RELEASE/.env"
RDC="docker compose --project-directory $RELEASE -p $PROJECT -f $RELEASE/docker-compose.prod.yml"
$RDC build app
$RDC run --rm --no-deps app npm run test
$RDC up -d --no-deps --force-recreate postfix-event-worker transport-worker

echo "== 5/5 Verify internal system and upstream SMTP path =="
$RDC ps postfix-event-worker transport-worker
grep -E '^TRANSPORT_(RATE_PER_SECOND|BATCH_SIZE|WORKER_INTERVAL_MS)=' "$APP_DIR/.env"
$RDC exec -T postfix-event-worker sh -lc "grep -n 'jfe050004' /app/src/lib/provider.ts" </dev/null

$DC exec -T postgres psql -U neximail -d neximail -P pager=off -c "
SELECT id,name,status FROM campaigns WHERE id='70c50199-cc6b-4e47-9ef9-e7a1582f0a4e';
SELECT provider,active,reason,next_probe_at FROM provider_cooldowns ORDER BY updated_at DESC LIMIT 10;
" </dev/null

banner=$(timeout 8 bash -c 'exec 3<>/dev/tcp/gmail-smtp-in.l.google.com/25; IFS= read -r line <&3; printf "%s" "$line"' 2>/dev/null || true)
echo "External SMTP banner: $banner"

echo
echo "=== REPAIR COMPLETE ==="
echo "Backup: $BACKUP"
if [[ "$banner" == 220* ]]; then
  echo "SMTP path is open."
else
  echo "SMTP path is still restricted upstream; NexiMail will not blindly continue through JFE050004."
fi
echo "Campaign remains paused and previously held Postfix mail remains held intentionally."
