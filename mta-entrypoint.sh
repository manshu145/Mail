#!/bin/sh
set -eu

MTA_HOSTNAME="${MTA_HOSTNAME:-mail.localhost}"
MTA_NETWORKS="${MTA_NETWORKS:-127.0.0.0/8 172.16.0.0/12 192.168.0.0/16}"
MTA_MESSAGE_SIZE_LIMIT="${MTA_MESSAGE_SIZE_LIMIT:-26214400}"
BOUNCE_DOMAIN="${BOUNCE_DOMAIN:-}"
BOUNCE_RECEIVER_HOST="${BOUNCE_RECEIVER_HOST:-bounce-receiver}"
BOUNCE_RECEIVER_PORT="${BOUNCE_RECEIVER_PORT:-2526}"
MTA_CONTROL_PORT="${MTA_CONTROL_PORT:-10026}"
MTA_CONTROL_SECRET="${MTA_CONTROL_SECRET:-${BOUNCE_SECRET:-}}"
DKIM_DIR="${DKIM_KEY_DIR:-/var/lib/neximail/dkim}"
TLS_DIR="${MTA_TLS_DIR:-/etc/postfix/tls}"

mkdir -p /var/log/mta /var/spool/postfix /etc/postfix /run/opendkim "$DKIM_DIR"
chmod 0755 /var/log/mta "$DKIM_DIR"
touch /var/log/mta/mail.log "$DKIM_DIR/KeyTable" "$DKIM_DIR/SigningTable"

cat > /etc/opendkim.conf <<EOF
Syslog                  yes
SyslogSuccess           yes
LogWhy                   no
Canonicalization        relaxed/relaxed
Mode                    sv
SubDomains              no
OversignHeaders         From
Socket                  inet:8891@127.0.0.1
PidFile                 /run/opendkim/opendkim.pid
KeyTable                refile:${DKIM_DIR}/KeyTable
SigningTable            refile:${DKIM_DIR}/SigningTable
ExternalIgnoreList      refile:/etc/opendkim/TrustedHosts
InternalHosts           refile:/etc/opendkim/TrustedHosts
EOF

mkdir -p /etc/opendkim
cat > /etc/opendkim/TrustedHosts <<EOF
127.0.0.1
localhost
172.16.0.0/12
192.168.0.0/16
EOF

postconf -e "myhostname = ${MTA_HOSTNAME}"
postconf -e "myorigin = \$myhostname"
postconf -e "mydestination = localhost"
postconf -e "inet_interfaces = all"
postconf -e "inet_protocols = ipv4"
postconf -e "mynetworks = ${MTA_NETWORKS}"
cat > /etc/postfix/bounce_recipient_access <<'EOF'
/^b\+[0-9A-Fa-f]{32}\.[0-9A-Fa-f]{24}@[A-Za-z0-9.-]+$/ OK
EOF
cat > /etc/postfix/bounce_transport <<EOF
/^b\+[0-9A-Fa-f]{32}\.[0-9A-Fa-f]{24}@[A-Za-z0-9.-]+$/ smtp:[${BOUNCE_RECEIVER_HOST}]:${BOUNCE_RECEIVER_PORT}
EOF
postconf -e "relay_domains ="
postconf -e "transport_maps = regexp:/etc/postfix/bounce_transport"
postconf -e "smtpd_relay_restrictions = permit_mynetworks,check_recipient_access regexp:/etc/postfix/bounce_recipient_access,reject_unauth_destination"
postconf -e "smtpd_recipient_restrictions = permit_mynetworks,check_recipient_access regexp:/etc/postfix/bounce_recipient_access,reject_unauth_destination"
postconf -e "disable_vrfy_command = yes"
postconf -e "smtpd_helo_required = yes"
postconf -e "message_size_limit = ${MTA_MESSAGE_SIZE_LIMIT}"
postconf -e "maillog_file = /var/log/mta/mail.log"
postconf -e "smtp_tls_security_level = may"
postconf -e "smtp_tls_loglevel = 0"
postconf -e "smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt"
postconf -e "smtp_helo_name = \$myhostname"
postconf -e "smtp_always_send_ehlo = yes"

if [ -s "${TLS_DIR}/fullchain.pem" ] && [ -s "${TLS_DIR}/privkey.pem" ]; then
  postconf -e "smtpd_tls_cert_file = ${TLS_DIR}/fullchain.pem"
  postconf -e "smtpd_tls_key_file = ${TLS_DIR}/privkey.pem"
  postconf -e "smtpd_tls_security_level = may"
  postconf -e "smtpd_tls_loglevel = 1"
  postconf -e "smtpd_tls_received_header = yes"
  echo "Inbound SMTP STARTTLS enabled using ${TLS_DIR}/fullchain.pem"
else
  postconf -e "smtpd_tls_security_level = none"
  echo "Inbound SMTP STARTTLS disabled: certificate/key not present in ${TLS_DIR}" >&2
fi
postconf -e "smtp_connection_cache_on_demand = yes"
postconf -e "maximal_queue_lifetime = 5d"
postconf -e "bounce_queue_lifetime = 5d"
postconf -e "minimal_backoff_time = 60s"
postconf -e "maximal_backoff_time = 3600s"
postconf -e "smtpd_milters = inet:127.0.0.1:8891"
postconf -e "non_smtpd_milters = inet:127.0.0.1:8891"
postconf -e "milter_protocol = 6"
postconf -e "milter_default_action = tempfail"

# Alpine/Postfix defaults reference /etc/postfix/aliases via LMDB. Build the
# database explicitly so smtpd never logs alias lookup errors on first use.
touch /etc/postfix/aliases
newaliases

# Public SMTP accepts only signed NexiMail VERP-shaped recipients and always
# routes them to the internal bounce receiver. The receiver validates the HMAC
# and authorizes the recipient domain from sending_domains. BOUNCE_DOMAIN stays
# available only as a legacy fallback for existing deployments and held mail.
if [ -n "$BOUNCE_DOMAIN" ]; then
  case "$BOUNCE_DOMAIN" in
    *[!a-zA-Z0-9.-]*|'') echo "Invalid BOUNCE_DOMAIN" >&2; exit 1 ;;
  esac
fi

if ! grep -q '^10025[[:space:]]' /etc/postfix/master.cf; then
  cat >> /etc/postfix/master.cf <<'EOF'
10025 inet n - n - - smtpd
  -o smtpd_tls_security_level=none
  -o smtpd_sasl_auth_enable=no
  -o smtpd_client_restrictions=permit_mynetworks,reject
  -o smtpd_relay_restrictions=permit_mynetworks,reject
  -o smtpd_recipient_restrictions=permit_mynetworks,reject
EOF
fi

opendkim -x /etc/opendkim.conf
postfix check
postfix start

CONTROL_PID=""
if [ -n "$MTA_CONTROL_SECRET" ]; then
  export MTA_CONTROL_PORT MTA_CONTROL_SECRET
  /usr/local/bin/mta-control.py &
  CONTROL_PID=$!
  echo "MTA queue control enabled on internal port ${MTA_CONTROL_PORT}"
else
  echo "MTA queue control disabled: no MTA_CONTROL_SECRET/BOUNCE_SECRET configured" >&2
fi

cleanup() {
  postfix stop >/dev/null 2>&1 || true
  if [ -n "$CONTROL_PID" ]; then kill "$CONTROL_PID" >/dev/null 2>&1 || true; fi
  if [ -f /run/opendkim/opendkim.pid ]; then kill "$(cat /run/opendkim/opendkim.pid)" >/dev/null 2>&1 || true; fi
}
trap cleanup INT TERM EXIT

while postfix status >/dev/null 2>&1; do
  if [ -f /run/opendkim/opendkim.pid ] && ! kill -0 "$(cat /run/opendkim/opendkim.pid)" 2>/dev/null; then
    echo "OpenDKIM stopped unexpectedly" >&2
    exit 1
  fi
  if [ -n "$CONTROL_PID" ] && ! kill -0 "$CONTROL_PID" 2>/dev/null; then
    echo "MTA queue control stopped unexpectedly" >&2
    exit 1
  fi
  sleep 5
done

exit 1
