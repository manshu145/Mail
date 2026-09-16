#!/bin/sh
set -eu

MTA_HOSTNAME="${MTA_HOSTNAME:-mail.localhost}"
MTA_NETWORKS="${MTA_NETWORKS:-127.0.0.0/8 172.16.0.0/12 192.168.0.0/16}"
MTA_MESSAGE_SIZE_LIMIT="${MTA_MESSAGE_SIZE_LIMIT:-26214400}"

mkdir -p /var/log/mta /var/spool/postfix /etc/postfix
chmod 0755 /var/log/mta

touch /var/log/mta/mail.log

postconf -e "myhostname = ${MTA_HOSTNAME}"
postconf -e "myorigin = \$myhostname"
postconf -e "mydestination = localhost"
postconf -e "inet_interfaces = all"
postconf -e "inet_protocols = ipv4"
postconf -e "mynetworks = ${MTA_NETWORKS}"
postconf -e "relay_domains ="
postconf -e "smtpd_relay_restrictions = permit_mynetworks,reject_unauth_destination"
postconf -e "smtpd_recipient_restrictions = permit_mynetworks,reject_unauth_destination"
postconf -e "disable_vrfy_command = yes"
postconf -e "smtpd_helo_required = yes"
postconf -e "message_size_limit = ${MTA_MESSAGE_SIZE_LIMIT}"
postconf -e "maillog_file = /var/log/mta/mail.log"
postconf -e "smtp_tls_security_level = may"
postconf -e "smtp_tls_loglevel = 0"
postconf -e "smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt"
postconf -e "smtp_connection_cache_on_demand = yes"
postconf -e "maximal_queue_lifetime = 5d"
postconf -e "bounce_queue_lifetime = 5d"
postconf -e "minimal_backoff_time = 60s"
postconf -e "maximal_backoff_time = 3600s"

# Internal submission listener used only by the NexiMail transport worker.
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

postfix check
postfix start

cleanup() {
  postfix stop >/dev/null 2>&1 || true
}
trap cleanup INT TERM EXIT

# Keep PID 1 alive while Postfix master runs.
while postfix status >/dev/null 2>&1; do
  sleep 5
done

exit 1
