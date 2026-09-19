# Changelog

## 1.0.1 — 2026-09-19

### Live operations and reporting
- Workspace operational data now refreshes automatically every five seconds while the tab is visible.
- Reports support All time, Today, Yesterday, Last 7 days, Last 30 days and custom IST date ranges.
- Message log and recipient detail expose the full delivery lifecycle, including transport attempts, MTA queue IDs, provider responses, retries, cooldowns and engagement.
- Campaign read-only states now match the actual campaign state.
- Campaign provider impact is intentionally compact; full SMTP/cooldown evidence remains on the Provider cooldowns page.

### Sender limits and cooldown safety
- New and untouched legacy sender identities no longer carry hidden 500/hour and 1,000/day caps.
- Per-sender hourly/24-hour limits are editable and show live usage plus the effective cap after global settings.
- Generic 4.x, mailbox-full, quota and recipient-policy conditions no longer trigger provider-wide cooldowns.
- Genuine provider restrictions pause only the affected provider/domain scope; sender/outbound-path restrictions pause the sender.
- Manual Clear/Reactivate controls are replaced by controlled automatic probes and an owner-triggered Check now action.
- Already accepted Postfix queue items under an active restriction are removed from the MTA retry loop and safely returned to NexiMail until the next controlled probe.

### Compliance
- Added a searchable Unsubscribers view with campaign/message context.
- Every terminal bounce is automatically added to global suppression; legacy bounced recipients are repaired idempotently during deployment.

## 1.0.0 — 2026-09-19

NexiMail v1.0.0 is the first production release of the self-hosted email marketing control plane.

### Core sending
- Campaign creation, scheduling, cancellation, reuse and recipient-level reporting.
- Persistent queue, transport workers, local MTA integration and remote delivery event ingestion.
- Open, click, unsubscribe, hard-bounce and complaint tracking.
- Global suppressions and recipient-level delivery history.

### Contacts and targeting
- Large CSV imports with normalization, deduplication, consent metadata, tags and custom fields.
- Static lists and persisted dynamic segments.
- Optional Gmail-focused validation; known-invalid recipients are blocked while unknown results do not block sending.

### Deliverability
- SPF, DKIM and DMARC domain readiness checks.
- Forward/reverse DNS and STARTTLS production acceptance checks.
- Sender-specific hourly/daily controls and warm-up ramps.
- Reputation auto-pause based on bounce/complaint thresholds.
- Provider-level cooldowns with live reason, state, next probe and manual owner controls.
- Campaign reports include provider impact recorded during that campaign.

### Templates and campaign UX
- HTML/plain-text template editing and sandboxed preview.
- Responsive campaign builder, review flow and mobile-safe template previews.
- Sender identity management with editable Reply-To.
- PWA installability, light/dark UI and responsive workspace navigation.

### Security and operations
- Owner/admin/operator authorization boundaries and audit history.
- Sanitized public health/auth responses.
- Production-safe release sanitization and metadata-free customer bundle generation.
- Production deployment with database backup, MTA queue preservation and revision verification.
- Worker heartbeat, database integrity, bounce/suppression and DNS production acceptance checks.

### v1 scope note
Inbox-placement seed testing is not part of v1.0.0. Its customer-facing UI and APIs are retired from this release.
