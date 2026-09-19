#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/neximail-next}"
PROJECT_NAME="${PROJECT_NAME:-neximail-next}"
REPO_URL="${REPO_URL:-}"
RELEASE_REF="${NEXIMAIL_RELEASE_REF:-release/v0.1.0}"

if [ "${EUID}" -ne 0 ]; then
  echo "Run as root."
  exit 1
fi

command -v docker >/dev/null || { echo "Docker is required."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required."; exit 1; }
command -v git >/dev/null || { echo "git is required."; exit 1; }

if [ -e "$APP_DIR" ] && [ ! -d "$APP_DIR/.git" ]; then
  echo "Refusing to use existing non-repository path: $APP_DIR"
  exit 1
fi

if [ ! -d "$APP_DIR/.git" ]; then
  [ -n "$REPO_URL" ] || {
    echo "REPO_URL is required for a fresh install."
    echo "Example: sudo REPO_URL=<your-release-repository> APP_DIR=/opt/neximail-next PROJECT_NAME=neximail-next bash deploy/install-isolated.sh"
    exit 1
  }
  git clone --no-checkout "$REPO_URL" "$APP_DIR"
fi

git -C "$APP_DIR" fetch --depth=1 origin "$RELEASE_REF"
git -C "$APP_DIR" checkout --detach FETCH_HEAD
echo "Installing NexiMail release: $RELEASE_REF ($(git -C "$APP_DIR" rev-parse --short=12 HEAD))"

cd "$APP_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo
  echo "Created $APP_DIR/.env"
  echo "Edit all passwords/secrets, APP_URL and MTA_HOSTNAME before starting."
  exit 2
fi

chmod 600 .env
bash scripts/production-audit.sh

docker compose -p "$PROJECT_NAME" -f docker-compose.prod.yml build
docker compose -p "$PROJECT_NAME" -f docker-compose.prod.yml run --rm app npm run db:migrate
docker compose -p "$PROJECT_NAME" -f docker-compose.prod.yml run --rm app npm run bootstrap:owner
docker compose -p "$PROJECT_NAME" -f docker-compose.prod.yml up -d

APP_BIND_PORT="$(awk -F= '$1=="APP_BIND_PORT"{print $2}' .env | tail -n1 | tr -d '\r' || true)"
APP_BIND_PORT="${APP_BIND_PORT:-3100}"

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${APP_BIND_PORT}/api/health" >/dev/null 2>&1; then
    echo "NexiMail isolated stack is healthy on 127.0.0.1:${APP_BIND_PORT}"
    docker compose -p "$PROJECT_NAME" -f docker-compose.prod.yml ps
    exit 0
  fi
  sleep 2
done

echo "Stack started but health check did not become ready."
docker compose -p "$PROJECT_NAME" -f docker-compose.prod.yml ps
docker compose -p "$PROJECT_NAME" -f docker-compose.prod.yml logs --tail=120 app
exit 1
