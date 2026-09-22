#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

echo "=== NEXIMAIL RECOVERY STARTING ==="

APP_DIR=/opt/neximail-next
PROJECT=neximail-next
BASELINE=1cda3885fe3fc7cc6786145fd961b35a4d34209e
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP=/opt/neximail-backups/recover-$STAMP
RELEASE=/opt/neximail-releases/recovery-$BASELINE
DC="docker compose --project-directory $APP_DIR -p $PROJECT -f $APP_DIR/docker-compose.prod.yml"

[ "$EUID" -eq 0 ] || { echo "Run as root"; exit 1; }
[ -d "$APP_DIR/.git" ] && [ -f "$APP_DIR/.env" ] || { echo "Missing $APP_DIR checkout/.env"; exit 1; }

mkdir -p "$BACKUP"
cp -a "$APP_DIR/.env" "$BACKUP/.env.before"
[ -f /etc/systemd/system/neximail-worker-guard.timer ] && cp -a /etc/systemd/system/neximail-worker-guard.timer "$BACKUP/" || true
[ -f /etc/systemd/system/neximail-worker-guard.service ] && cp -a /etc/systemd/system/neximail-worker-guard.service "$BACKUP/" || true
[ -f /usr/local/bin/neximail-worker-guard.sh ] && cp -a /usr/local/bin/neximail-worker-guard.sh "$BACKUP/" || true
[ -f "$APP_DIR/src/lib/provider.ts" ] && cp -a "$APP_DIR/src/lib/provider.ts" "$BACKUP/provider.ts.before" || true
$DC ps > "$BACKUP/services.before.txt" || true
$DC exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' </dev/null > "$BACKUP/database.dump"
[ -s "$BACKUP/database.dump" ] || { echo "Database backup failed"; exit 1; }
$DC exec -T mta postqueue -p </dev/null > "$BACKUP/postfix-queue.before.txt" 2>&1 || true

echo "== Remove temporary guard =="
systemctl disable --now neximail-worker-guard.timer 2>/dev/null || true
systemctl stop neximail-worker-guard.service 2>/dev/null || true
rm -f /etc/systemd/system/neximail-worker-guard.timer /etc/systemd/system/neximail-worker-guard.service /usr/local/bin/neximail-worker-guard.sh
systemctl daemon-reload

echo "== Restore pre-incident transport settings =="
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
set_env TRANSPORT_WORKER_INTERVAL_MS 60000

echo "== Restore exact pre-incident provider classifier =="
git -C "$APP_DIR" fetch origin main
git -C "$APP_DIR" cat-file -e "$BASELINE^{commit}"
git -C "$APP_DIR" show "$BASELINE:src/lib/provider.ts" > "$APP_DIR/src/lib/provider.ts"

echo "== Retire only the manual JFE050004 cooldown added during debugging =="
$DC exec -T postgres psql -U neximail -d neximail -v ON_ERROR_STOP=1 -c "
UPDATE provider_cooldowns
SET active=false, cleared_at=COALESCE(cleared_at,NOW()), next_probe_at=NULL, updated_at=NOW()
WHERE provider='__sender__'
  AND reason='sender_or_outbound_path_restriction'
  AND last_response ILIKE 'JFE050004:%';
" </dev/null

echo "== Rebuild only workers modified during incident =="
if [ ! -f "$RELEASE/package.json" ]; then
  git -C "$APP_DIR" worktree add --detach "$RELEASE" "$BASELINE"
fi
[ "$(git -C "$RELEASE" rev-parse HEAD)" = "$BASELINE" ] || { echo "Recovery worktree mismatch"; exit 1; }
ln -sfn "$APP_DIR/.env" "$RELEASE/.env"
RDC="docker compose --project-directory $RELEASE -p $PROJECT -f $RELEASE/docker-compose.prod.yml"
$RDC build app
$RDC up -d --no-deps --force-recreate postfix-event-worker transport-worker

echo "== Verify =="
$RDC ps postfix-event-worker transport-worker
grep -E '^TRANSPORT_(RATE_PER_SECOND|BATCH_SIZE|WORKER_INTERVAL_MS)=' "$APP_DIR/.env"
$DC exec -T postgres psql -U neximail -d neximail -P pager=off -c "
SELECT id,name,status FROM campaigns WHERE id='70c50199-cc6b-4e47-9ef9-e7a1582f0a4e';
SELECT provider,active,reason,next_probe_at FROM provider_cooldowns ORDER BY updated_at DESC LIMIT 10;
" </dev/null

banner=$(timeout 8 bash -c 'exec 3<>/dev/tcp/gmail-smtp-in.l.google.com/25; IFS= read -r line <&3; printf "%s" "$line"' 2>/dev/null || true)
echo "External SMTP banner: $banner"
echo "RECOVERY COMPLETE"
echo "Backup: $BACKUP"
echo "Campaign status and held Postfix queue were intentionally not changed."
