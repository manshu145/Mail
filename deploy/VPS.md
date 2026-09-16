# NexiMail isolated VPS deployment

The new NexiMail stack must run independently from the existing production panel until it is fully validated.

## Isolation rules

- Install under `/opt/neximail-next` by default.
- Use Docker Compose project name `neximail-next` so networks and volumes are separate.
- PostgreSQL and Redis are not published to host ports.
- The web app binds only to `127.0.0.1:3100` by default (`APP_BIND_PORT`).
- Postfix/OpenDKIM run inside the new stack's MTA container.
- Do not reuse the existing NexiMail database, Redis instance, Postfix configuration, volumes or compose project.

## First install

```bash
sudo APP_DIR=/opt/neximail-next PROJECT_NAME=neximail-next bash deploy/install-isolated.sh
```

The first run creates `/opt/neximail-next/.env` and stops. Edit that file and replace every placeholder password/secret. Set the future app URL and mail hostname, but do not point the primary NexiMail domain at this stack yet.

Run the installer again after the environment is complete:

```bash
sudo APP_DIR=/opt/neximail-next PROJECT_NAME=neximail-next bash deploy/install-isolated.sh
```

It validates the environment, builds the images, applies migrations, bootstraps the owner, starts the stack and checks `/api/health`.

## Runtime

```bash
cd /opt/neximail-next
docker compose -p neximail-next -f docker-compose.prod.yml ps
docker compose -p neximail-next -f docker-compose.prod.yml logs -f --tail=200
```

The control panel is available locally at `http://127.0.0.1:3100` unless `APP_BIND_PORT` is changed.

## Reverse proxy

During validation, use a temporary hostname/subdomain and proxy it only to the isolated app port. Do not change the current primary NexiMail virtual host until the new stack has passed end-to-end mail testing.

## Before mail testing

Run:

```bash
cd /opt/neximail-next
bash scripts/production-audit.sh
```

Then verify PTR/rDNS for the sending IP, SPF, generated DKIM, DMARC, outbound port 25 reachability, TLS, bounce/event processing, suppression behavior and unsubscribe handling. `mta_accepted` means the local MTA accepted the message; it is not the same as confirmed remote delivery.
