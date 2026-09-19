#!/usr/bin/env bash
# Update the existing NexiMail stack and migrate its live Postfix spool without dropping queued mail.
set -Eeuo pipefail
umask 077

APP_DIR=/opt/neximail-next
PROJECT_NAME=neximail-next
BRANCH=${NEXIMAIL_DEPLOY_BRANCH:-main}
BACKUP_DIR="/opt/neximail-backups/$(date -u +%Y%m%dT%H%M%SZ)"
workers=(import-worker campaign-worker policy-worker transport-worker bounce-receiver event-worker postfix-event-worker dkim-worker validation-worker domain-health-worker reputation-worker webhook-worker)
services=(app "${workers[@]}")
build_services=(mta app)

[[ $EUID -eq 0 ]] || { echo 'Run this script as root.'; exit 1; }
for tool in git docker curl sha256sum tar python3; do command -v "$tool" >/dev/null || { echo "$tool is required"; exit 1; }; done
docker compose version >/dev/null
[[ -d "$APP_DIR/.git" && -f "$APP_DIR/.env" ]] || { echo 'Existing /opt/neximail-next checkout and .env are required.'; exit 1; }

env_value() {
  local key="$1"
  awk -v k="$key" 'index($0,k"=")==1 {v=substr($0,length(k)+2); gsub(/^["'\'' ]+|["'\'' ]+$/,"",v); print v; exit}' "$APP_DIR/.env"
}
APP_URL="$(env_value APP_URL)"
[[ "$APP_URL" =~ ^https?:// ]] || { echo 'APP_URL must be configured in .env with http:// or https://'; exit 1; }
RUNTIME_MODE="$(env_value NEXIMAIL_RUNTIME_MODE)"
SEND_ENABLED="$(env_value NEXIMAIL_SEND_ENABLED)"
[[ "$RUNTIME_MODE" == "production" ]] || { echo 'NEXIMAIL_RUNTIME_MODE must explicitly be production before deploying the live stack.'; exit 1; }
[[ "$SEND_ENABLED" == "true" ]] || { echo 'NEXIMAIL_SEND_ENABLED must explicitly be true before deploying the live stack.'; exit 1; }
HEALTH_URL="${APP_URL%/}/api/health"
LOGIN_URL="${APP_URL%/}/login"

# Resolve the requested branch once, then pin the entire rollout to that immutable commit.
git -C "$APP_DIR" fetch origin "$BRANCH"
REVISION=${NEXIMAIL_DEPLOY_REVISION:-$(git -C "$APP_DIR" rev-parse "origin/$BRANCH")}
git -C "$APP_DIR" cat-file -e "$REVISION^{commit}"
RELEASE_DIR="/opt/neximail-releases/$REVISION"

# Read only the established stack. Do not create a replacement database.
old_dc=(docker compose --project-directory "$APP_DIR" -p "$PROJECT_NAME" -f "$APP_DIR/docker-compose.prod.yml")
[[ -n "$("${old_dc[@]}" ps --status running -q postgres)" ]] || { echo 'Existing PostgreSQL service is not running; stopping.'; exit 1; }
# The archived multi-organization database is not compatible with this release.
schema_ok=$("${old_dc[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from information_schema.columns where table_schema = '\''public'\'' and table_name = '\''contacts'\'' and column_name = '\''normalized_email'\''"')
[[ "$schema_ok" == 1 ]] || { echo 'Database schema does not match the current NexiMail stack; stopping.'; exit 1; }

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
for service in "${build_services[@]}"; do
  id=$("${old_dc[@]}" ps -q "$service")
  if [[ -n "$id" ]]; then
    image=$(docker inspect --format '{{.Image}}' "$id")
    if docker image inspect "$image" >/dev/null 2>&1; then
      docker image tag "$image" "neximail-rollback-${service}:$(basename "$BACKUP_DIR" | tr '[:upper:]' '[:lower:]')"
      printf '%s %s\n' "$service" "$image" >> "$BACKUP_DIR/images-before.txt"
    else
      printf '%s %s %s\n' "$service" "$image" "image-metadata-missing; running container preserved" >> "$BACKUP_DIR/images-before.txt"
      echo "[WARN] Existing $service container image metadata was pruned; skipping rollback image tag."
    fi
  fi
done

# Build first. Existing processes continue serving until all builds succeed.
"${dc[@]}" build "${build_services[@]}"
"${old_dc[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP_DIR/database.dump"
[[ -s "$BACKUP_DIR/database.dump" ]] || { echo 'Database backup is empty; stopping.'; exit 1; }

on_error() {
  echo "Deployment stopped at line $1. Backup and previous images: $BACKUP_DIR. Do not reset volumes or rerun sends."
  if [[ -n "${mta_id:-}" ]] && docker inspect "$mta_id" >/dev/null 2>&1; then
    docker start "$mta_id" >/dev/null || true
  fi
}
trap 'on_error "$LINENO"' ERR
"${old_dc[@]}" stop --timeout 120 "${workers[@]}"
"${dc[@]}" run --rm --no-deps app npm run db:migrate
# Ensure the persistent CSV spool is writable by the non-root runtime user.
"${dc[@]}" run --rm --no-deps import-volume-init
# Persist the CURRENT queue before replacing the MTA container. Never mount an empty
# volume over its writable-layer queue. Reuse its image to preserve Postfix UIDs.
mta_id=$("${old_dc[@]}" ps -aq mta)
[[ -n "$mta_id" ]] || { echo 'Existing MTA container missing; stopping.'; exit 1; }
spool_volume="${PROJECT_NAME}_mta_spool"
spool_mount=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/spool/postfix"}}{{.Name}}{{end}}{{end}}' "$mta_id")
if [[ -z "$spool_mount" ]]; then
  if docker volume inspect "$spool_volume" >/dev/null 2>&1; then
    echo "Unattached spool volume $spool_volume already exists. Preserve it and inspect the previous migration before proceeding."; exit 1
  fi
  mta_image=$(docker inspect --format '{{.Image}}' "$mta_id")
  if ! docker image inspect "$mta_image" >/dev/null 2>&1; then
    echo "Existing MTA image metadata is missing and its Postfix spool is not on the persistent volume; refusing unsafe spool migration."
    exit 1
  fi
  docker image tag "$mta_image" "neximail-rollback-mta:$(basename "$BACKUP_DIR" | tr '[:upper:]' '[:lower:]')"
  "${old_dc[@]}" exec -T mta postqueue -j > "$BACKUP_DIR/postfix-queue-before.jsonl"
  docker stop --time 120 "$mta_id"
  docker cp -a "$mta_id:/var/spool/postfix/." - > "$BACKUP_DIR/postfix-spool.tar"
  [[ -s "$BACKUP_DIR/postfix-spool.tar" ]] || { echo 'Postfix spool backup is empty; stopping.'; exit 1; }
  tar -tf "$BACKUP_DIR/postfix-spool.tar" > "$BACKUP_DIR/postfix-spool-files.txt"
  docker volume create --label "com.docker.compose.project=$PROJECT_NAME" --label com.docker.compose.volume=mta_spool "$spool_volume" >/dev/null
  helper=$(docker create --mount "type=volume,source=$spool_volume,target=/var/spool/postfix" --entrypoint /bin/true "$mta_image")
  docker cp -a - "$helper:/var/spool/postfix" < "$BACKUP_DIR/postfix-spool.tar"
  docker cp -a "$helper:/var/spool/postfix/." - > "$BACKUP_DIR/postfix-spool-copied.tar"
  python3 - "$BACKUP_DIR/postfix-spool.tar" "$BACKUP_DIR/postfix-spool-copied.tar" <<'VERIFY_SPOOL'
import hashlib, os, sys, tarfile
with tarfile.open(sys.argv[1]) as original, tarfile.open(sys.argv[2]) as copied:
    target = {os.path.normpath(m.name): m for m in copied.getmembers()}
    for entry in original.getmembers():
        name = os.path.normpath(entry.name)
        other = target.get(name)
        assert other is not None, f"Missing spool entry: {name}"
        assert (entry.uid, entry.gid, entry.mode, entry.type, entry.linkname) == (other.uid, other.gid, other.mode, other.type, other.linkname), f"Spool metadata mismatch: {name}"
        if entry.isfile():
            def digest(archive, member):
                h = hashlib.sha256()
                with archive.extractfile(member) as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b''): h.update(block)
                return h.digest()
            assert digest(original, entry) == digest(copied, other), f"Spool contents mismatch: {name}"
print("Postfix queue copy verified, including ownership and file contents.")
VERIFY_SPOOL
  docker rm "$helper" >/dev/null
elif [[ "$spool_mount" != "$spool_volume" ]]; then
  echo "Existing MTA spool is mounted from $spool_mount; refusing to replace it."; exit 1
fi
"${dc[@]}" up -d --no-deps mta
# Postgres and Redis are deliberately preserved.
"${dc[@]}" up -d --no-deps "${services[@]}"

# Exercise the reports SQL inside the deployed app image against the real database.
"${dc[@]}" exec -T app node --import tsx scripts/check-reports.ts

for attempt in $(seq 1 40); do
  if curl -fsS --max-time 10 "$HEALTH_URL" > "$BACKUP_DIR/health.json"; then
    ready=1
    for service in "${services[@]}"; do
      [[ -n "$("${dc[@]}" ps --status running -q "$service")" ]] || ready=0
    done
    mta_state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$("${dc[@]}" ps -q mta)")
    [[ "$mta_state" == healthy ]] || ready=0
    if [[ "$ready" == 1 ]]; then
      expected=$(sha256sum "$RELEASE_DIR/scripts/workers/transport-worker.ts" | cut -d ' ' -f1)
      actual=$("${dc[@]}" exec -T app sha256sum scripts/workers/transport-worker.ts | cut -d ' ' -f1)
      [[ "$actual" == "$expected" ]] || { echo 'Running app revision mismatch.'; exit 1; }
      printf '\nDEPLOYED %s\nURL: %s\nRelease: %s\nBackup: %s\n' "$REVISION" "$LOGIN_URL" "$RELEASE_DIR" "$BACKUP_DIR"
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
