#!/usr/bin/env bash
set -euo pipefail

fail=0
ok(){ printf 'OK   %s\n' "$1"; }
warn(){ printf 'WARN %s\n' "$1"; }
bad(){ printf 'FAIL %s\n' "$1"; fail=1; }

command -v docker >/dev/null && ok "docker installed" || bad "docker missing"
docker compose version >/dev/null 2>&1 && ok "docker compose available" || bad "docker compose unavailable"
[ -f .env ] && ok ".env exists" || bad ".env missing"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  for key in AUTH_SECRET PUBLIC_TOKEN_SECRET MTA_EVENT_SECRET SEED_AGENT_SECRET WEBHOOK_SECRET_KEY DKIM_SECRET_KEY; do
    value="${!key:-}"
    [ ${#value} -ge 32 ] || bad "$key missing/too short"
  done
  [ -n "${APP_URL:-}" ] && ok "APP_URL configured" || bad "APP_URL missing"
  [ -n "${POSTGRES_PASSWORD:-}" ] && [ "${POSTGRES_PASSWORD}" != "replace-with-a-strong-database-password" ] && ok "database password customized" || bad "database password still default"
  [ -n "${OWNER_PASSWORD:-}" ] && [ ${#OWNER_PASSWORD} -ge 12 ] && [ "${OWNER_PASSWORD}" != "replace-with-a-strong-password-at-least-12-characters" ] && ok "owner password configured" || bad "owner password missing/default"
fi

if docker compose -p neximail-next -f docker-compose.prod.yml config >/dev/null 2>&1; then ok "isolated compose validates"; else bad "isolated compose invalid"; fi

if docker compose -p neximail-next -f docker-compose.prod.yml ps --format json >/dev/null 2>&1; then
  ok "isolated compose project addressable"
else
  warn "isolated compose project has not been started yet"
fi

port="${APP_BIND_PORT:-3100}"
if command -v ss >/dev/null; then
  if ss -lnt | awk '{print $4}' | grep -Eq "127\\.0\\.0\\.1:${port}$|:${port}$"; then warn "host port ${port} is already in use"; else ok "host port ${port} is free"; fi
fi

printf '\nNexiMail isolated runtime audit complete.\n'
exit "$fail"
