#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/neximail-next}"
PROJECT_NAME="${PROJECT_NAME:-neximail-next}"
REPO_URL="${REPO_URL:-https://github.com/manshu145/Mail.git}"
BRANCH="${BRANCH:-main}"

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
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
fi

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
