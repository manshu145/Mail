#!/usr/bin/env bash
set -euo pipefail

fail=0
ok(){ printf 'OK   %s\n' "$1"; }
warn(){ printf 'WARN %s\n' "$1"; }
bad(){ printf 'FAIL %s\n' "$1"; fail=1; }

command -v docker >/dev/null && ok "docker installed" || bad "docker missing"
command -v node >/dev/null && ok "node installed" || warn "node missing (required for host workers)"
command -v npm >/dev/null && ok "npm installed" || warn "npm missing (required for host workers)"
command -v postfix >/dev/null && ok "postfix installed" || bad "postfix missing"
[ -x "${POSTFIX_SENDMAIL_PATH:-/usr/sbin/sendmail}" ] && ok "sendmail binary available" || bad "sendmail binary unavailable"
[ -f .env ] && ok ".env exists" || bad ".env missing"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  for key in AUTH_SECRET PUBLIC_TOKEN_SECRET MTA_EVENT_SECRET SEED_AGENT_SECRET APP_URL; do
    value="${!key:-}"
    [ ${#value} -ge 32 ] || { [ "$key" = APP_URL ] && [ -n "$value" ] && continue; bad "$key missing/too short"; }
  done
fi

if docker compose -f docker-compose.prod.yml config >/dev/null 2>&1; then ok "production compose validates"; else bad "production compose invalid"; fi

if command -v ss >/dev/null; then
  if ss -lnt | awk '{print $4}' | grep -Eq '(^|:)25$'; then ok "SMTP port 25 listener present"; else warn "no local port 25 listener yet"; fi
fi

printf '\nNexiMail audit complete.\n'
exit "$fail"
