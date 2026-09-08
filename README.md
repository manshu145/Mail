# NexiMail

Production-oriented, self-hosted email marketing and campaign management control plane.

> Your contacts. Your infrastructure. Your sending rules. Your data.

## Current application scope

NexiMail now contains the full control-plane path for:

- Owner / Admin / Operator authentication and audit history
- Contacts, CSV import, normalization, deduplication, custom attributes and tags
- Static lists and persisted dynamic segments
- Global suppression for unsubscribe, hard bounce, invalid, complaint, manual and policy blocks
- Gmail-focused validation jobs with persisted `valid / invalid / unknown / error` results; SMTP acceptance is never treated as proof of mailbox existence
- Templates with HTML/plain-text editing and sandboxed preview
- Campaign creation, audience/template/sending-account selection, scheduling and cancellation
- SPF / DKIM / DMARC sending-domain readiness checks
- Queue states from `queued` through transport and remote delivery events
- Durable Campaign, Policy, Transport, Event, Validation, Domain Health and Reputation workers
- Postfix local transport integration and Postfix event ingestion
- Open, click and one-click unsubscribe tracking
- Delivery, bounce, complaint and recipient-level analytics
- Per-account hourly/daily throttles, warm-up ramps and reputation auto-pause thresholds
- Real seed-test inbox placement data model and authenticated result ingestion
- PWA installability, offline fallback and responsive premium light/dark UI

## Delivery truth model

`mta_accepted` means the local Postfix instance accepted a message. It **does not** mean delivered or inboxed. NexiMail only moves a message to `delivered` after a remote transport event indicates acceptance. Inbox placement is reported only from configured seed inbox observations and is labelled as seed-test placement.

## Local development

```bash
cp .env.example .env
docker compose up -d postgres redis
npm install
npm run db:migrate
npm run test
npm run dev
```

Create the first database owner with:

```bash
npm run bootstrap:owner
```

## Preview vs production

Vercel is used only as a UI/control-plane preview. It does not run Postfix or long-lived workers.

Final production is intended for a VPS. `docker-compose.prod.yml` keeps PostgreSQL and Redis private, binds the web application to `127.0.0.1:3000`, and runs all non-MTA workers. Postfix, the Transport worker and the Postfix-event worker stay on the VPS host so they can access the local MTA safely.

See `deploy/VPS.md` for the runtime split.

## Production readiness check

After cloning to the final VPS, populating `.env`, installing Postfix and before sending real mail:

```bash
bash scripts/production-audit.sh
```

The final VPS rollout must additionally verify DNS, STARTTLS, reverse DNS/PTR, MTA relay restrictions, real bounce/event ingestion, worker heartbeats, firewall rules and low-volume end-to-end delivery tests.

## Compliance and safety defaults

- Web requests never bulk-send campaigns directly.
- Suppressions are checked before transport.
- Explicit invalid validation results are suppressed.
- Unknown validation is never treated as valid.
- SMTP `250/251` during Gmail probing is recorded as `unknown`, not mailbox proof.
- Queueing requires a ready sending domain and a visible `{{unsubscribe_url}}` in the selected template.
- Complaint and hard-bounce events create global suppression records.
- Reputation thresholds can automatically pause a sending account.
- No inbox/spam percentage is fabricated.
