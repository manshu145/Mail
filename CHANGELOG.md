# Changelog

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
