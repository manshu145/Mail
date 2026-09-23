#!/usr/bin/env bash
set -Eeuo pipefail

APP_CONTAINER=${NEXIMAIL_APP_CONTAINER:-neximail-next-app-1}
PG_CONTAINER=${NEXIMAIL_PG_CONTAINER:-neximail-next-postgres-1}
MTA_CONTAINER=${NEXIMAIL_MTA_CONTAINER:-neximail-next-mta-1}
APP_DIR=${NEXIMAIL_APP_DIR:-/opt/neximail-next}

env_value() {
  local key="$1"
  [[ -f "$APP_DIR/.env" ]] || return 0
  awk -v k="$key" 'index($0,k"=")==1 {v=substr($0,length(k)+2); gsub(/^["'\'' ]+|["'\'' ]+$/,"",v); print v; exit}' "$APP_DIR/.env"
}
SCRIPT_URL=${NEXIMAIL_ACCEPTANCE_SCRIPT_URL:-}
TMP=""
cleanup() { [[ -n "${TMP:-}" && -f "$TMP" ]] && rm -f "$TMP"; }
trap cleanup EXIT

echo "=== NexiMail production acceptance ==="
docker inspect "$APP_CONTAINER" >/dev/null
docker inspect "$PG_CONTAINER" >/dev/null
docker inspect "$MTA_CONTAINER" >/dev/null

if [[ -n "$SCRIPT_URL" ]]; then
  TMP=$(mktemp)
  curl -fsSL "$SCRIPT_URL" -o "$TMP"
  docker cp "$TMP" "$APP_CONTAINER:/app/scripts/production-acceptance.ts" >/dev/null
  docker exec -u 0 "$APP_CONTAINER" chmod 0644 /app/scripts/production-acceptance.ts
  echo "[WARN] Acceptance script override supplied explicitly: $SCRIPT_URL"
else
  echo "[INFO] Using production-acceptance.ts baked into the deployed app image."
fi

set +e
docker exec "$APP_CONTAINER" node --import tsx scripts/production-acceptance.ts
APP_RC=$?
set -e

echo
echo "=== DNS / SMTP diagnostics ==="
DOMAINS=$(docker exec "$PG_CONTAINER" sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select domain from sending_domains where status <> '\''disabled'\'' order by domain"' 2>/dev/null || true)
if [[ -z "$DOMAINS" ]]; then
  echo "[WARN] No enabled sending_domains rows found."
else
  while IFS= read -r domain; do
    [[ -n "$domain" ]] || continue
    echo "--- $domain ---"
    if command -v dig >/dev/null 2>&1; then
      echo "SPF:"
      dig +short TXT "$domain" | grep -i 'v=spf1' || echo "[WARN] SPF not found"
      echo "DMARC:"
      dig +short TXT "_dmarc.$domain" | grep -i 'v=dmarc1' || echo "[WARN] DMARC not found"
      echo "DKIM: checked by the in-app domain-health worker above using the configured selector/key."
    else
      echo "[WARN] dig is not installed on the VPS; in-app domain-health result above remains authoritative."
    fi
  done <<< "$DOMAINS"
fi

if command -v curl >/dev/null 2>&1; then
  PUBLIC_IP=$(curl -4fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)
else
  PUBLIC_IP=""
fi
if [[ -n "$PUBLIC_IP" ]]; then
  echo "Outbound/public IPv4: $PUBLIC_IP"
  if command -v dig >/dev/null 2>&1; then
    PTR=$(dig +short -x "$PUBLIC_IP" | head -n1)
    [[ -n "$PTR" ]] && echo "[PASS] PTR: $PTR" || echo "[WARN] PTR not found for $PUBLIC_IP"
  fi
else
  echo "[WARN] Could not determine public IPv4 for PTR check."
fi

echo "Outbound SMTP TLS policy:"
TLS_LEVEL=$(docker exec "$MTA_CONTAINER" postconf -h smtp_tls_security_level 2>/dev/null || true)
TLS_CAFILE=$(docker exec "$MTA_CONTAINER" postconf -h smtp_tls_CAfile 2>/dev/null || true)
if [[ "$TLS_LEVEL" == "may" || "$TLS_LEVEL" == "encrypt" || "$TLS_LEVEL" == "dane" || "$TLS_LEVEL" == "dane-only" || "$TLS_LEVEL" == "secure" || "$TLS_LEVEL" == "verify" ]]; then
  echo "[PASS] Postfix outbound TLS is enabled (smtp_tls_security_level=$TLS_LEVEL, CAfile=${TLS_CAFILE:-unset})"
else
  echo "[WARN] Postfix outbound TLS policy is not enabled as expected (smtp_tls_security_level=${TLS_LEVEL:-unset})"
fi

if command -v openssl >/dev/null 2>&1; then
  echo "Inbound SMTP STARTTLS certificate:"
  TLS_HOST="${MTA_TLS_HOSTNAME:-$(env_value MTA_HOSTNAME)}"
  if [[ -z "$TLS_HOST" ]]; then
    echo "[WARN] MTA_HOSTNAME is not configured; STARTTLS hostname probe skipped."
    TLS_HOST=""
  fi
  TLS_OUT=$(mktemp)
  if [[ -n "$TLS_HOST" ]] \
    && timeout 15 openssl s_client -verify_return_error -starttls smtp -connect 127.0.0.1:25 -servername "$TLS_HOST" -verify_hostname "$TLS_HOST" </dev/null >"$TLS_OUT" 2>&1 \
    && grep -q 'Verify return code: 0 (ok)' "$TLS_OUT" \
    && ! grep -qi 'no peer certificate' "$TLS_OUT"; then
    echo "[PASS] STARTTLS handshake and certificate hostname verification succeeded for $TLS_HOST"
  else
    echo "[WARN] STARTTLS/certificate verification failed for $TLS_HOST."
    grep -E 'Verify return code|verify error|hostname mismatch|subject=|no peer certificate' "$TLS_OUT" || true
  fi
  rm -f "$TLS_OUT"
else
  echo "[WARN] openssl not available; STARTTLS probe skipped."
fi

echo
if [[ "$APP_RC" -eq 0 ]]; then
  echo "=== ACCEPTANCE RUN FINISHED ==="
else
  echo "=== ACCEPTANCE RUN FOUND FAILURES (exit=$APP_RC) ==="
fi
exit "$APP_RC"
