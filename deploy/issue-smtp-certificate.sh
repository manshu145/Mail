#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

HOST=${MTA_TLS_HOSTNAME:-smtp.groundsreport.com}
EMAIL=${CERTBOT_EMAIL:-admin@groundsreport.com}
PROJECT_NAME=${NEXIMAIL_PROJECT_NAME:-neximail-next}
MTA_CONTAINER=${NEXIMAIL_MTA_CONTAINER:-neximail-next-mta-1}
VOLUME="${PROJECT_NAME}_mta_tls"

[[ $EUID -eq 0 ]] || { echo "Run as root."; exit 1; }
for tool in certbot nginx docker openssl curl getent; do command -v "$tool" >/dev/null || { echo "$tool is required"; exit 1; }; done

echo "=== DNS / host preflight ==="
PUBLIC_IP=$(curl -4fsS --max-time 10 https://api.ipify.org)
mapfile -t RESOLVED < <(getent ahostsv4 "$HOST" | awk '{print $1}' | sort -u)
printf 'Host: %s\nPublic IPv4: %s\nResolved IPv4: %s\n' "$HOST" "$PUBLIC_IP" "${RESOLVED[*]:-none}"
if [[ "${#RESOLVED[@]}" -eq 0 ]]; then
  echo "[FAIL] $HOST has no public IPv4 resolution on this server."
  exit 2
fi
MATCH=0
for ip in "${RESOLVED[@]}"; do [[ "$ip" == "$PUBLIC_IP" ]] && MATCH=1; done
if [[ "$MATCH" -ne 1 ]]; then
  echo "[FAIL] $HOST does not resolve to this VPS ($PUBLIC_IP). Fix its A record before issuing the certificate."
  exit 3
fi
echo "[PASS] $HOST resolves to this VPS."

echo
echo "=== Nginx preflight ==="
nginx -t

echo
echo "=== Issue / renew dedicated SMTP certificate ==="
certbot certonly --nginx   --cert-name "$HOST"   -d "$HOST"   --email "$EMAIL"   --agree-tos   --non-interactive   --keep-until-expiring

SOURCE="/etc/letsencrypt/live/$HOST"
[[ -s "$SOURCE/fullchain.pem" && -s "$SOURCE/privkey.pem" ]] || { echo "[FAIL] Certbot completed but certificate files are missing."; exit 4; }
openssl x509 -in "$SOURCE/fullchain.pem" -noout -checkhost "$HOST"
openssl x509 -in "$SOURCE/fullchain.pem" -noout -checkend 86400
echo "[PASS] Certificate is current and covers $HOST."
openssl x509 -in "$SOURCE/fullchain.pem" -noout -subject -issuer -dates -ext subjectAltName 2>/dev/null || true

echo
echo "=== Sync certificate into persistent MTA volume ==="
docker volume inspect "$VOLUME" >/dev/null 2>&1 ||   docker volume create --label "com.docker.compose.project=$PROJECT_NAME" --label com.docker.compose.volume=mta_tls "$VOLUME" >/dev/null

TMP=$(mktemp -d)
HELPER=""
cleanup() {
  [[ -n "${HELPER:-}" ]] && docker rm -f "$HELPER" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

install -m 0644 "$(readlink -f "$SOURCE/fullchain.pem")" "$TMP/fullchain.pem"
install -m 0600 "$(readlink -f "$SOURCE/privkey.pem")" "$TMP/privkey.pem"
HELPER=$(docker create -v "$VOLUME:/tls" alpine:3.20 sh -c 'sleep 300')
docker start "$HELPER" >/dev/null
docker cp "$TMP/fullchain.pem" "$HELPER:/tls/fullchain.pem" >/dev/null
docker cp "$TMP/privkey.pem" "$HELPER:/tls/privkey.pem" >/dev/null
docker exec "$HELPER" sh -lc 'chmod 0644 /tls/fullchain.pem && chmod 0600 /tls/privkey.pem && test -s /tls/fullchain.pem && test -s /tls/privkey.pem'
docker rm -f "$HELPER" >/dev/null
HELPER=""

echo "[PASS] Certificate synced to $VOLUME."

echo
echo "=== Restart MTA and verify ==="
docker inspect "$MTA_CONTAINER" >/dev/null
MOUNTS=$(docker inspect --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}' "$MTA_CONTAINER")
grep -q "$VOLUME /etc/postfix/tls" <<<"$MOUNTS" || { echo "[FAIL] Running MTA does not mount $VOLUME at /etc/postfix/tls."; exit 5; }
docker restart "$MTA_CONTAINER" >/dev/null
for _ in $(seq 1 30); do
  STATE=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$MTA_CONTAINER")
  [[ "$STATE" == healthy ]] && break
  [[ "$STATE" == unhealthy || "$STATE" == exited ]] && { docker logs --tail 120 "$MTA_CONTAINER"; exit 6; }
  sleep 2
done
[[ "${STATE:-}" == healthy ]] || { echo "[FAIL] MTA did not become healthy."; exit 7; }

OUT=$(mktemp)
set +e
timeout 15 openssl s_client -starttls smtp -connect 127.0.0.1:25   -servername "$HOST" -verify_hostname "$HOST" </dev/null >"$OUT" 2>&1
RC=$?
set -e
cat "$OUT" | grep -E 'subject=|issuer=|Verification:|New, TLS|Cipher is|Verify return code' || true
if [[ $RC -ne 0 ]] || ! grep -q 'Verify return code: 0 (ok)' "$OUT"; then
  echo "[FAIL] STARTTLS or hostname verification failed for $HOST."
  cat "$OUT"
  rm -f "$OUT"
  exit 8
fi
rm -f "$OUT"
echo "[PASS] SMTP STARTTLS + certificate hostname verification succeeded for $HOST."

echo
echo "=== Install automatic post-renew sync hook ==="
HOOK=/etc/letsencrypt/renewal-hooks/deploy/neximail-mta-tls-sync.sh
cat > "$HOOK" <<HOOKEOF
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "\${RENEWED_LINEAGE:-}" == "/etc/letsencrypt/live/$HOST" ]] || exit 0
TMP=\$(mktemp -d)
trap 'rm -rf "\$TMP"' EXIT
install -m 0644 "\$RENEWED_LINEAGE/fullchain.pem" "\$TMP/fullchain.pem"
install -m 0600 "\$RENEWED_LINEAGE/privkey.pem" "\$TMP/privkey.pem"
helper=\$(docker create -v "$VOLUME:/tls" alpine:3.20 sh -c 'sleep 120')
trap 'docker rm -f "\$helper" >/dev/null 2>&1 || true; rm -rf "\$TMP"' EXIT
docker start "\$helper" >/dev/null
docker cp "\$TMP/fullchain.pem" "\$helper:/tls/fullchain.pem" >/dev/null
docker cp "\$TMP/privkey.pem" "\$helper:/tls/privkey.pem" >/dev/null
docker exec "\$helper" sh -lc 'chmod 0644 /tls/fullchain.pem && chmod 0600 /tls/privkey.pem'
docker rm -f "\$helper" >/dev/null
trap 'rm -rf "\$TMP"' EXIT
docker restart "$MTA_CONTAINER" >/dev/null
HOOKEOF
chmod 0755 "$HOOK"
echo "[PASS] Auto-renew deploy hook installed at $HOOK."

echo
echo "SMTP TLS setup complete for $HOST."
