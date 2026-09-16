#!/usr/bin/env bash
set -euo pipefail

fail=0
ok(){ printf 'OK   %s\n' "$1"; }
warn(){ printf 'WARN %s\n' "$1"; }
bad(){ printf 'FAIL %s\n' "$1"; fail=1; }

command -v docker >/dev/null && ok "docker installed" || bad "docker missing"
docker compose version >/dev/null 2>&1 && ok "docker compose available" || bad "docker compose unavailable"
[ -f .env ] && ok ".env exists" || bad ".env missing"

is_placeholder(){
  case "$1" in
    ""|replace-with-*|*example.com*|*example.local*) return 0 ;;
    *) return 1 ;;
  esac
}

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a

  for key in AUTH_SECRET PUBLIC_TOKEN_SECRET MTA_EVENT_SECRET SEED_AGENT_SECRET WEBHOOK_SECRET_KEY DKIM_SECRET_KEY; do
    value="${!key:-}"
    if [ ${#value} -ge 32 ] && ! is_placeholder "$value"; then ok "$key configured"; else bad "$key missing/default/too short"; fi
  done

  if [ -n "${APP_URL:-}" ] && ! is_placeholder "${APP_URL}"; then ok "APP_URL configured"; else bad "APP_URL missing/default"; fi
  if [ -n "${MTA_HOSTNAME:-}" ] && ! is_placeholder "${MTA_HOSTNAME}"; then ok "MTA_HOSTNAME configured"; else bad "MTA_HOSTNAME missing/default"; fi
  if [ -n "${POSTGRES_PASSWORD:-}" ] && ! is_placeholder "${POSTGRES_PASSWORD}"; then ok "database password customized"; else bad "database password still default"; fi
  if [ -n "${OWNER_EMAIL:-}" ] && ! is_placeholder "${OWNER_EMAIL}"; then ok "owner email configured"; else bad "owner email missing/default"; fi
  if [ -n "${OWNER_PASSWORD:-}" ] && [ ${#OWNER_PASSWORD} -ge 12 ] && ! is_placeholder "${OWNER_PASSWORD}"; then ok "owner password configured"; else bad "owner password missing/default"; fi

  case "${NEXIMAIL_RUNTIME_MODE:-}" in
    staging|production) ok "runtime mode ${NEXIMAIL_RUNTIME_MODE}" ;;
    *) bad "NEXIMAIL_RUNTIME_MODE must be staging or production" ;;
  esac
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
