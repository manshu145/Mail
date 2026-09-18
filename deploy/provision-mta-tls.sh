#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

PROJECT_NAME=${NEXIMAIL_PROJECT_NAME:-neximail-next}
VOLUME="${PROJECT_NAME}_mta_tls"
MTA_CONTAINER=${NEXIMAIL_MTA_CONTAINER:-neximail-next-mta-1}
HOSTNAME=${MTA_TLS_HOSTNAME:-smtp.groundsreport.com}

find_source() {
  if [[ -n "${MTA_TLS_SOURCE_DIR:-}" && -s "${MTA_TLS_SOURCE_DIR}/fullchain.pem" && -s "${MTA_TLS_SOURCE_DIR}/privkey.pem" ]]; then
    printf '%s\n' "$MTA_TLS_SOURCE_DIR"; return 0
  fi
  for d in "/etc/letsencrypt/live/$HOSTNAME" "/etc/letsencrypt/live/mail.groundsreport.com" "/etc/letsencrypt/live/groundsreport.com"; do
    if [[ -s "$d/fullchain.pem" && -s "$d/privkey.pem" ]]; then printf '%s\n' "$d"; return 0; fi
  done
  return 1
}

[[ $EUID -eq 0 ]] || { echo "Run as root."; exit 1; }
command -v docker >/dev/null
command -v openssl >/dev/null

SOURCE=$(find_source || true)
if [[ -z "$SOURCE" ]]; then
  echo "No trusted certificate found for $HOSTNAME."
  echo "Checked /etc/letsencrypt/live/$HOSTNAME, /etc/letsencrypt/live/mail.groundsreport.com and /etc/letsencrypt/live/groundsreport.com."
  echo "Set MTA_TLS_SOURCE_DIR=/path/to/cert-dir and rerun after a certificate exists."
  exit 2
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
install -m 0644 "$(readlink -f "$SOURCE/fullchain.pem")" "$TMP/fullchain.pem"
install -m 0600 "$(readlink -f "$SOURCE/privkey.pem")" "$TMP/privkey.pem"

CERT_CN=$(openssl x509 -in "$TMP/fullchain.pem" -noout -subject 2>/dev/null || true)
CERT_DATES=$(openssl x509 -in "$TMP/fullchain.pem" -noout -dates 2>/dev/null || true)
if ! openssl x509 -in "$TMP/fullchain.pem" -noout -checkend 86400 >/dev/null; then
  echo "Certificate expires within 24 hours or is already expired; refusing to install."
  exit 1
fi
if ! openssl x509 -in "$TMP/fullchain.pem" -noout -checkhost "$HOSTNAME" >/dev/null 2>&1; then
  echo "Certificate in $SOURCE does not cover $HOSTNAME; refusing to install a hostname-mismatched SMTP certificate."
  echo "Issue/renew a certificate containing $HOSTNAME, then rerun."
  exit 4
fi
echo "[PASS] Certificate covers $HOSTNAME."

docker volume inspect "$VOLUME" >/dev/null 2>&1 ||   docker volume create --label "com.docker.compose.project=$PROJECT_NAME" --label com.docker.compose.volume=mta_tls "$VOLUME" >/dev/null

HELPER=$(docker create -v "$VOLUME:/tls" alpine:3.20 sh -c 'sleep 300')
trap 'docker rm -f "$HELPER" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
docker start "$HELPER" >/dev/null
docker cp "$TMP/fullchain.pem" "$HELPER:/tls/fullchain.pem"
docker cp "$TMP/privkey.pem" "$HELPER:/tls/privkey.pem"
docker exec "$HELPER" sh -lc 'chmod 0644 /tls/fullchain.pem && chmod 0600 /tls/privkey.pem && test -s /tls/fullchain.pem && test -s /tls/privkey.pem'
docker rm -f "$HELPER" >/dev/null
trap 'rm -rf "$TMP"' EXIT

echo "Installed certificate into Docker volume $VOLUME"
echo "$CERT_CN"
echo "$CERT_DATES"

if docker inspect "$MTA_CONTAINER" >/dev/null 2>&1; then
  mounts=$(docker inspect --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}' "$MTA_CONTAINER")
  if ! grep -q "$VOLUME /etc/postfix/tls" <<<"$mounts"; then
    echo "MTA container does not yet mount $VOLUME. Deploy the latest main revision first."
    exit 3
  fi
  docker restart "$MTA_CONTAINER" >/dev/null
  for _ in $(seq 1 30); do
    state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$MTA_CONTAINER")
    [[ "$state" == "healthy" ]] && break
    [[ "$state" == "unhealthy" || "$state" == "exited" ]] && { docker logs --tail 100 "$MTA_CONTAINER"; exit 1; }
    sleep 2
  done
  echo "MTA restarted with TLS material."
fi

echo "STARTTLS verification:"
if timeout 15 openssl s_client -starttls smtp -connect 127.0.0.1:25 -servername "$HOSTNAME" </dev/null 2>&1 | grep -Eq 'Protocol *: TLS|New, TLSv|Cipher is'; then
  echo "[PASS] SMTP STARTTLS is active."
else
  echo "[FAIL] SMTP STARTTLS handshake still failed."
  exit 1
fi
