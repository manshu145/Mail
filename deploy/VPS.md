# NexiMail VPS runtime split

Production keeps the web control plane and non-MTA workers in Docker. Postfix stays on the VPS host.

## Docker services

`docker compose -f docker-compose.prod.yml up -d --build` starts PostgreSQL, Redis, the Next.js app, Campaign, Policy, Event, Validation, Domain Health and Reputation workers.

PostgreSQL, Redis and the app bind only to loopback. Put Caddy or Nginx in front of `127.0.0.1:3000` for HTTPS.

## Host workers

Install Node.js 20+, Postfix and the repository at `/opt/neximail`. Copy `deploy/systemd/neximail-worker@.service` to `/etc/systemd/system/` and enable only the workers that need host MTA access:

```bash
systemctl daemon-reload
systemctl enable --now neximail-worker@transport
systemctl enable --now neximail-worker@postfix-events
```

Do not enable duplicate Docker/systemd instances of the same worker.

## Before real traffic

Run `bash scripts/production-audit.sh`, then verify reverse DNS/PTR, SPF, DKIM, DMARC, STARTTLS, firewall rules, Postfix relay restrictions and a low-volume opted-in end-to-end test. Local `mta_accepted` must never be interpreted as remote delivery.
