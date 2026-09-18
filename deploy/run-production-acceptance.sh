#!/usr/bin/env bash
set -Eeuo pipefail

APP_CONTAINER=${NEXIMAIL_APP_CONTAINER:-neximail-next-app-1}
PG_CONTAINER=${NEXIMAIL_PG_CONTAINER:-neximail-next-postgres-1}
SCRIPT_URL=${NEXIMAIL_ACCEPTANCE_SCRIPT_URL:-https://raw.githubusercontent.com/manshu145/Mail/main/scripts/production-acceptance.ts}
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

echo "=== NexiMail production acceptance ==="
docker inspect "$APP_CONTAINER" >/dev/null
docker inspect "$PG_CONTAINER" >/dev/null

curl -fsSL "$SCRIPT_URL" -o "$TMP"
docker cp "$TMP" "$APP_CONTAINER:/app/scripts/production-acceptance.ts" >/dev/null
docker exec -u 0 "$APP_CONTAINER" chmod 0644 /app/scripts/production-acceptance.ts

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

if command -v openssl >/dev/null 2>&1; then
  echo "SMTP STARTTLS:"
  if timeout 15 openssl s_client -starttls smtp -connect 127.0.0.1:25 -servername mail.groundsreport.com </dev/null 2>&1 | grep -Eq 'Protocol *: TLS|New, TLSv|Cipher is'; then
    echo "[PASS] STARTTLS handshake succeeded on port 25"
  else
    echo "[WARN] STARTTLS handshake did not verify from host loopback; inspect MTA TLS configuration."
  fi
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
