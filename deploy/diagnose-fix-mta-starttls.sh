#!/usr/bin/env bash
set -Eeuo pipefail

MTA=${NEXIMAIL_MTA_CONTAINER:-neximail-next-mta-1}
HOST=${MTA_TLS_HOSTNAME:-smtp.groundsreport.com}

docker inspect "$MTA" >/dev/null

echo "=== Mounted TLS files ==="
docker exec -u 0 "$MTA" sh -lc 'ls -l /etc/postfix/tls; test -s /etc/postfix/tls/fullchain.pem; test -s /etc/postfix/tls/privkey.pem'

echo
echo "=== Certificate identity ==="
docker exec -u 0 "$MTA" sh -lc 'openssl x509 -in /etc/postfix/tls/fullchain.pem -noout -subject -issuer -dates -ext subjectAltName 2>/dev/null || openssl x509 -in /etc/postfix/tls/fullchain.pem -noout -subject -issuer -dates'

echo
echo "=== Postfix TLS configuration ==="
docker exec -u 0 "$MTA" postconf -n | grep -E '^(myhostname|inet_interfaces|smtpd_tls_|smtp_tls_)' || true

echo
echo "=== Port 25 EHLO capabilities before fix ==="
python3 - <<'PY'
import socket
s=socket.create_connection(("127.0.0.1",25),5)
print(s.recv(4096).decode(errors="replace").strip())
s.sendall(b"EHLO neximail-tls-diagnostic\r\n")
s.settimeout(2)
buf=b""
try:
    while True:
        x=s.recv(4096)
        if not x: break
        buf+=x
        if b"\r\n250 " in buf: break
except Exception:
    pass
print(buf.decode(errors="replace").strip())
s.close()
PY

echo
echo "=== Enforcing inbound STARTTLS config ==="
docker exec -u 0 "$MTA" sh -lc '
  postconf -e "smtpd_tls_cert_file = /etc/postfix/tls/fullchain.pem"
  postconf -e "smtpd_tls_key_file = /etc/postfix/tls/privkey.pem"
  postconf -e "smtpd_tls_security_level = may"
  postconf -e "smtpd_tls_received_header = yes"
  postconf -e "smtpd_tls_loglevel = 1"
  postfix check
  postfix reload
'

sleep 2

echo
echo "=== Port 25 EHLO capabilities after reload ==="
python3 - <<'PY'
import socket, sys
s=socket.create_connection(("127.0.0.1",25),5)
banner=s.recv(4096)
s.sendall(b"EHLO neximail-tls-diagnostic\r\n")
s.settimeout(2)
buf=b""
try:
    while True:
        x=s.recv(4096)
        if not x: break
        buf+=x
        if b"\r\n250 " in buf: break
except Exception:
    pass
text=(banner+buf).decode(errors="replace")
print(text.strip())
if "STARTTLS" not in text.upper():
    print("[FAIL] Postfix is still not advertising STARTTLS on port 25.")
    sys.exit(2)
print("[PASS] Postfix advertises STARTTLS.")
PY

echo
echo "=== TLS handshake ==="
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT
set +e
timeout 15 openssl s_client -starttls smtp -connect 127.0.0.1:25 -servername "$HOST" -showcerts </dev/null >"$OUT" 2>&1
RC=$?
set -e
cat "$OUT"
if [[ $RC -ne 0 ]]; then
  echo "[FAIL] openssl STARTTLS exited $RC"
  docker logs --tail 120 "$MTA" || true
  exit 3
fi
if ! grep -Eq 'Protocol *: TLS|New, TLSv|Cipher is|Ciphersuite:' "$OUT"; then
  echo "[FAIL] TLS handshake output did not contain a negotiated TLS session."
  docker logs --tail 120 "$MTA" || true
  exit 4
fi

echo "[PASS] SMTP STARTTLS handshake succeeded."

echo
echo "=== Postfix recent TLS log lines ==="
docker exec -u 0 "$MTA" sh -lc 'tail -n 120 /var/log/mta/mail.log | grep -i -E "tls|ssl|warning|error" || true'
