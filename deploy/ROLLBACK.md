# NexiMail rollback and restore runbook

This runbook is for a failed application release. It deliberately avoids destructive volume resets.

## What every reviewed deployment preserves

`deploy/deploy-reviewed.sh` creates a timestamped directory under `/opt/neximail-backups/` containing:

- a PostgreSQL custom-format dump (`database.dump`)
- the previous source revision
- service state before deployment
- rollback image references when available
- Postfix queue/spool evidence when a queue migration is required

The deploy also keeps immutable release worktrees under `/opt/neximail-releases/<commit-sha>`.

## Application rollback

1. Stop only the NexiMail application/workers that are being replaced. Do not remove PostgreSQL, Redis, MTA volumes, or queued mail.
2. Select the last known-good release SHA from `/opt/neximail-releases/`.
3. Re-run the reviewed deploy script with that exact revision:

```bash
cd /opt/neximail-next
NEXIMAIL_DEPLOY_BRANCH=main \
NEXIMAIL_DEPLOY_REVISION=<KNOWN_GOOD_SHA> \
bash deploy/deploy-reviewed.sh
```

4. Confirm the health endpoint and all worker containers are running.
5. Run production acceptance from the restored release.

## Database restore

Database restore is only required when a migration or data mutation must be rolled back. Do not restore the database merely because an application process failed.

Before restoring:

- stop campaign/import/transport/event/reputation workers
- keep a second copy of the current database
- verify the selected backup timestamp and release SHA
- verify no campaign is actively sending

Example restore into the existing PostgreSQL service:

```bash
BACKUP=/opt/neximail-backups/<TIMESTAMP>/database.dump
cd /opt/neximail-next

docker compose -p neximail-next -f docker-compose.prod.yml \
  exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > /root/neximail-pre-restore.dump

docker compose -p neximail-next -f docker-compose.prod.yml \
  exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' \
  < "$BACKUP"
```

After restore, deploy the matching application revision and run production acceptance before re-enabling sending.

## Never do during rollback

- do not run `docker compose down -v`
- do not delete the Postfix spool volume
- do not replay already accepted messages
- do not reset delivery state manually without reconciling remote-delivery events
- do not restore an old database while newer workers are still processing
