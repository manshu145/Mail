#!/usr/bin/env bash
# Update the existing isolated NexiMail deployment; preserve database and MTA containers.
set -Eeuo pipefail
umask 077

APP_DIR=/opt/neximail-next
PROJECT_NAME=neximail-next
REVISION=b3a84976c77ea723af747156fb3b194f2dfceba3
BRANCH=fix/transport-delivery-safety
RELEASE_DIR="/opt/neximail-releases/$REVISION"
BACKUP_DIR="/opt/neximail-backups/$(date -u +%Y%m%dT%H%M%SZ)"
workers=(import-worker campaign-worker policy-worker transport-worker bounce-receiver event-worker postfix-event-worker dkim-worker validation-worker domain-health-worker reputation-worker webhook-worker)
services=(app "${workers[@]}")

[[ $EUID -eq 0 ]] || { echo 'Run this script as root.'; exit 1; }
for tool in git docker curl sha256sum; do command -v "$tool" >/dev/null || { echo "$tool is required"; exit 1; }; done
docker compose version >/dev/null
[[ -d "$APP_DIR/.git" && -f "$APP_DIR/.env" ]] || { echo 'Existing /opt/neximail-next checkout and .env are required.'; exit 1; }

# Read only the established stack. Do not create a replacement database.
old_dc=(docker compose --project-directory "$APP_DIR" -p "$PROJECT_NAME" -f "$APP_DIR/docker-compose.prod.yml")
[[ -n "$("${old_dc[@]}" ps --status running -q postgres)" ]] || { echo 'Existing PostgreSQL service is not running; stopping.'; exit 1; }
# The archived multi-organization database is not compatible with this release.
schema_ok=$("${old_dc[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from information_schema.columns where table_schema = '\''public'\'' and table_name = '\''contacts'\'' and column_name = '\''normalized_email'\''"')
[[ "$schema_ok" == 1 ]] || { echo 'Database schema does not match the current NexiMail stack; stopping.'; exit 1; }

git -C "$APP_DIR" fetch origin "$BRANCH"
git -C "$APP_DIR" cat-file -e "$REVISION^{commit}"
mkdir -p /opt/neximail-releases "$BACKUP_DIR"
if [[ ! -d "$RELEASE_DIR" ]]; then
  git -C "$APP_DIR" worktree add --detach "$RELEASE_DIR" "$REVISION"
fi
[[ "$(git -C "$RELEASE_DIR" rev-parse HEAD)" == "$REVISION" ]] || { echo 'Release revision mismatch.'; exit 1; }
[[ -z "$(git -C "$RELEASE_DIR" status --porcelain --untracked-files=no)" ]] || { echo 'Release contains local modifications; stopping.'; exit 1; }
if [[ -e "$RELEASE_DIR/.env" && ! -L "$RELEASE_DIR/.env" ]]; then
  echo 'Release has its own environment file; refusing to overwrite it.'; exit 1
fi
ln -sfn "$APP_DIR/.env" "$RELEASE_DIR/.env"
dc=(docker compose --project-directory "$RELEASE_DIR" -p "$PROJECT_NAME" -f "$RELEASE_DIR/docker-compose.prod.yml")
"${dc[@]}" config --quiet
[[ -f "$RELEASE_DIR/.dockerignore" ]] && grep -Eq '^\.env($|[.*])' "$RELEASE_DIR/.dockerignore" || { echo 'Docker context must exclude .env; stopping.'; exit 1; }

# Preserve inspectable rollback information without dumping container secrets.
"${old_dc[@]}" ps > "$BACKUP_DIR/services-before.txt"
git -C "$APP_DIR" rev-parse HEAD > "$BACKUP_DIR/source-before.txt"
for service in "${services[@]}"; do
  id=$("${old_dc[@]}" ps -q "$service")
  if [[ -n "$id" ]]; then
    image=$(docker inspect --format '{{.Image}}' "$id")
    docker image tag "$image" "neximail-rollback-${service}:$(basename "$BACKUP_DIR" | tr '[:upper:]' '[:lower:]')"
    printf '%s %s\n' "$service" "$image" >> "$BACKUP_DIR/images-before.txt"
  fi
done

# Build first. Existing processes continue serving until all builds succeed.
"${dc[@]}" build "${services[@]}"
"${old_dc[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP_DIR/database.dump"
[[ -s "$BACKUP_DIR/database.dump" ]] || { echo 'Database backup is empty; stopping.'; exit 1; }

trap 'echo "Deployment stopped at line $LINENO. Backup and previous images: $BACKUP_DIR. Do not reset volumes or rerun sends."' ERR
"${old_dc[@]}" stop --timeout 120 "${workers[@]}"
"${dc[@]}" run --rm --no-deps app npm run db:migrate
# --no-deps deliberately preserves Postgres, Redis, Postfix and its queued mail.
"${dc[@]}" up -d --no-deps "${services[@]}"

for attempt in $(seq 1 40); do
  if curl -fsS --max-time 10 https://mail.groundsreport.com/api/health > "$BACKUP_DIR/health.json"; then
    ready=1
    for service in "${services[@]}"; do
      [[ -n "$("${dc[@]}" ps --status running -q "$service")" ]] || ready=0
    done
    if [[ "$ready" == 1 ]]; then
      expected=$(sha256sum "$RELEASE_DIR/scripts/workers/transport-worker.ts" | cut -d ' ' -f1)
      actual=$("${dc[@]}" exec -T app sha256sum scripts/workers/transport-worker.ts | cut -d ' ' -f1)
      [[ "$actual" == "$expected" ]] || { echo 'Running app revision mismatch.'; exit 1; }
      printf '\nDEPLOYED %s\nURL: https://mail.groundsreport.com/login\nRelease: %s\nBackup: %s\n' "$REVISION" "$RELEASE_DIR" "$BACKUP_DIR"
      "${dc[@]}" ps
      cat "$BACKUP_DIR/health.json"
      exit 0
    fi
  fi
  sleep 3
done
echo 'Deployment has not passed health checks. Keep the backup; inspect service logs.'
"${dc[@]}" ps
exit 1
