#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR=${NEXIMAIL_APP_DIR:-/opt/neximail-next}
env_value() {
  local key="$1"
  [[ -f "$APP_DIR/.env" ]] || return 0
  awk -v k="$key" 'index($0,k"=")==1 {v=substr($0,length(k)+2); gsub(/^["'\'' ]+|["'\'' ]+$/,"",v); print v; exit}' "$APP_DIR/.env"
}
HOST="${MTA_TLS_HOSTNAME:-$(env_value MTA_HOSTNAME)}"
EMAIL="${CERTBOT_EMAIL:-$(env_value OWNER_EMAIL)}"
[[ -n "$HOST" ]] || { echo "[FAIL] MTA_HOSTNAME is not configured."; exit 2; }
[[ -n "$EMAIL" ]] || { echo "[FAIL] OWNER_EMAIL or CERTBOT_EMAIL is not configured."; exit 2; }
PROJECT_NAME="${NEXIMAIL_PROJECT_NAME:-neximail-next}"
MTA_CONTAINER="${NEXIMAIL_MTA_CONTAINER:-neximail-next-mta-1}"
VOLUME="${PROJECT_NAME}_mta_tls"

[[ "${EUID}" -eq 0 ]] || { echo "Run as root."; exit 1; }

for tool in certbot nginx docker openssl curl dig awk grep sort mktemp install readlink timeout; do
  command -v "$tool" >/dev/null 2>&1 || { echo "[FAIL] Required tool missing: $tool"; exit 1; }
done

echo "=== DNS / host preflight ==="
PUBLIC_IP="$(curl -4fsS --max-time 10 https://api.ipify.org)"
CF_A="$(dig @1.1.1.1 +short A "$HOST" | grep -E '^[0-9]+(\.[0-9]+){3}$' | sort -u | tr '\n' ' ' | xargs || true)"
GG_A="$(dig @8.8.8.8 +short A "$HOST" | grep -E '^[0-9]+(\.[0-9]+){3}$' | sort -u | tr '\n' ' ' | xargs || true)"

echo "Host: $HOST"
echo "Public IPv4: $PUBLIC_IP"
echo "Cloudflare A: ${CF_A:-none}"
echo "Google A: ${GG_A:-none}"

if ! { printf '%s\n%s\n' "$CF_A" "$GG_A" | tr ' ' '\n' | grep -Fxq "$PUBLIC_IP"; }; then
  echo "[FAIL] Public DNS for $HOST does not resolve to this VPS ($PUBLIC_IP)."
  echo "Fix/propagate the public A record before certificate issuance."
  exit 3
fi
echo "[PASS] Public DNS for $HOST resolves to this VPS."

echo
echo "=== Nginx preflight ==="
nginx -t

echo
echo "=== Issue / renew dedicated SMTP certificate ==="
certbot certonly --nginx \
  --cert-name "$HOST" \
  -d "$HOST" \
  --email "$EMAIL" \
  --agree-tos \
  --non-interactive \
  --keep-until-expiring

SOURCE="/etc/letsencrypt/live/$HOST"
[[ -s "$SOURCE/fullchain.pem" ]] || { echo "[FAIL] Missing $SOURCE/fullchain.pem"; exit 4; }
[[ -s "$SOURCE/privkey.pem" ]] || { echo "[FAIL] Missing $SOURCE/privkey.pem"; exit 4; }

openssl x509 -in "$SOURCE/fullchain.pem" -noout -checkhost "$HOST" >/dev/null
openssl x509 -in "$SOURCE/fullchain.pem" -noout -checkend 86400 >/dev/null
echo "[PASS] Certificate is current and covers $HOST."
openssl x509 -in "$SOURCE/fullchain.pem" -noout -subject -issuer -dates -ext subjectAltName 2>/dev/null || true

echo
echo "=== Sync certificate into persistent MTA volume ==="
if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  docker volume create \
    --label "com.docker.compose.project=$PROJECT_NAME" \
    --label "com.docker.compose.volume=mta_tls" \
    "$VOLUME" >/dev/null
fi

TMP="$(mktemp -d)"
HELPER=""
cleanup() {
  if [[ -n "${HELPER:-}" ]]; then
    docker rm -f "$HELPER" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

install -m 0644 "$(readlink -f "$SOURCE/fullchain.pem")" "$TMP/fullchain.pem"
install -m 0600 "$(readlink -f "$SOURCE/privkey.pem")" "$TMP/privkey.pem"

HELPER="$(docker create -v "$VOLUME:/tls" alpine:3.20 sh -c 'sleep 300')"
docker start "$HELPER" >/dev/null
docker cp "$TMP/fullchain.pem" "$HELPER:/tls/fullchain.pem" >/dev/null
docker cp "$TMP/privkey.pem" "$HELPER:/tls/privkey.pem" >/dev/null
docker exec "$HELPER" sh -lc 'chmod 0644 /tls/fullchain.pem; chmod 0600 /tls/privkey.pem; test -s /tls/fullchain.pem; test -s /tls/privkey.pem'
docker rm -f "$HELPER" >/dev/null
HELPER=""

echo "[PASS] Certificate synced to $VOLUME."

echo
echo "=== Restart MTA and verify ==="
docker inspect "$MTA_CONTAINER" >/dev/null

MOUNTS="$(docker inspect --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}' "$MTA_CONTAINER")"
if ! printf '%s\n' "$MOUNTS" | grep -Fq "$VOLUME /etc/postfix/tls"; then
  echo "[FAIL] Running MTA does not mount $VOLUME at /etc/postfix/tls."
  exit 5
fi

docker restart "$MTA_CONTAINER" >/dev/null

STATE=""
for _ in $(seq 1 30); do
  STATE="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$MTA_CONTAINER")"
  if [[ "$STATE" == "healthy" ]]; then
    break
  fi
  if [[ "$STATE" == "unhealthy" || "$STATE" == "exited" ]]; then
    docker logs --tail 120 "$MTA_CONTAINER" || true
    exit 6
  fi
  sleep 2
done

[[ "$STATE" == "healthy" ]] || { echo "[FAIL] MTA did not become healthy."; exit 7; }

OUT="$(mktemp)"
set +e
timeout 15 openssl s_client \
  -starttls smtp \
  -connect 127.0.0.1:25 \
  -servername "$HOST" \
  -verify_hostname "$HOST" \
  </dev/null >"$OUT" 2>&1
RC=$?
set -e

grep -E 'subject=|issuer=|Verification:|New, TLS|Cipher is|Verify return code' "$OUT" || true

if [[ "$RC" -ne 0 ]] || ! grep -q 'Verify return code: 0 (ok)' "$OUT"; then
  echo "[FAIL] STARTTLS or hostname verification failed for $HOST."
  cat "$OUT"
  rm -f "$OUT"
  exit 8
fi

rm -f "$OUT"
echo "[PASS] SMTP STARTTLS + certificate hostname verification succeeded for $HOST."

echo
echo "=== Install automatic post-renew sync hook ==="
HOOK="/etc/letsencrypt/renewal-hooks/deploy/neximail-mta-tls-sync.sh"

cat > "$HOOK" <<HOOKEOF
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "\${RENEWED_LINEAGE:-}" == "/etc/letsencrypt/live/$HOST" ]] || exit 0
TMP="\$(mktemp -d)"
HELPER=""
cleanup() {
  if [[ -n "\${HELPER:-}" ]]; then
    docker rm -f "\$HELPER" >/dev/null 2>&1 || true
  fi
  rm -rf "\$TMP"
}
trap cleanup EXIT
install -m 0644 "\$RENEWED_LINEAGE/fullchain.pem" "\$TMP/fullchain.pem"
install -m 0600 "\$RENEWED_LINEAGE/privkey.pem" "\$TMP/privkey.pem"
HELPER="\$(docker create -v "$VOLUME:/tls" alpine:3.20 sh -c 'sleep 120')"
docker start "\$HELPER" >/dev/null
docker cp "\$TMP/fullchain.pem" "\$HELPER:/tls/fullchain.pem" >/dev/null
docker cp "\$TMP/privkey.pem" "\$HELPER:/tls/privkey.pem" >/dev/null
docker exec "\$HELPER" sh -lc 'chmod 0644 /tls/fullchain.pem; chmod 0600 /tls/privkey.pem'
docker rm -f "\$HELPER" >/dev/null
HELPER=""
docker restart "$MTA_CONTAINER" >/dev/null
HOOKEOF

chmod 0755 "$HOOK"
echo "[PASS] Auto-renew deploy hook installed at $HOOK."

echo
echo "SMTP TLS setup complete for $HOST."
