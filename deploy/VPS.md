# NexiMail isolated VPS deployment

The new NexiMail stack must run independently from any existing installation until it is fully validated.

## Isolation rules

- Install under `/opt/neximail-next` by default.
- Use Docker Compose project name `neximail-next` so networks and volumes are separate.
- PostgreSQL and Redis are not published to host ports.
- The web app binds only to `127.0.0.1:3100` by default (`APP_BIND_PORT`).
- Postfix/OpenDKIM run inside the new stack's MTA container.
- Never reuse another customer's database, Redis instance, Postfix spool/configuration, volumes, sender identity or DNS.
- A fresh install starts in sending-locked staging mode.

## First install

Prerequisites: Ubuntu 24.04 or equivalent, Docker Engine with Compose v2, Git, outbound TCP/25 available, and control of PTR/rDNS for the sending IP.

Download the installer from the repository:

```bash
curl -fsSL https://raw.githubusercontent.com/manshu145/Mail/main/deploy/install-isolated.sh \
  -o /root/neximail-install.sh
chmod +x /root/neximail-install.sh
sudo REPO_URL=https://github.com/manshu145/Mail.git /root/neximail-install.sh
```

The fresh-install command passes the repository explicitly, then the installer resolves the requested release once and pins that exact commit in `/opt/neximail-next/.neximail-install-revision`. This prevents the second install pass from silently moving to a newer commit.

The first run creates `/opt/neximail-next/.env` and stops. Edit that file and replace every placeholder password/secret. Configure at minimum:

- `APP_URL`
- `MTA_HOSTNAME`
- `MTA_PUBLIC_IP`
- `BOUNCE_DOMAIN`
- `OWNER_NAME`
- `OWNER_EMAIL`
- `OWNER_PASSWORD`

Keep:

```dotenv
NEXIMAIL_RUNTIME_MODE=staging
NEXIMAIL_SEND_ENABLED=false
MTA_SMTP_BIND=127.0.0.1
```

until DNS, TLS, bounce processing and controlled delivery tests pass.

Run the same installer again after the environment is complete:

```bash
sudo /root/neximail-install.sh
```

It validates the environment, builds the images, applies migrations, bootstraps the owner, starts the isolated stack and checks `/api/health`.

To intentionally install another ref or commit:

```bash
sudo NEXIMAIL_RELEASE_REF=<branch-tag-or-commit> /root/neximail-install.sh
```

## Runtime

```bash
cd /opt/neximail-next
docker compose -p neximail-next -f docker-compose.prod.yml ps
docker compose -p neximail-next -f docker-compose.prod.yml logs -f --tail=200
```

The control panel is available locally at `http://127.0.0.1:3100` unless `APP_BIND_PORT` is changed.

## Reverse proxy

During validation, use the client's intended HTTPS panel hostname and proxy it only to the isolated app port. Do not enable production sending just because the web panel is reachable.

## Before mail testing

Run:

```bash
cd /opt/neximail-next
bash scripts/production-audit.sh
```

Then verify PTR/rDNS for the sending IP, SPF, generated DKIM, DMARC, outbound port 25 reachability, SMTP STARTTLS, bounce/event processing, suppression behavior and unsubscribe handling. `mta_accepted` means the local MTA accepted the message; it is not the same as confirmed remote delivery.

Only after those checks pass should the client be promoted to:

```dotenv
NEXIMAIL_RUNTIME_MODE=production
NEXIMAIL_SEND_ENABLED=true
```
