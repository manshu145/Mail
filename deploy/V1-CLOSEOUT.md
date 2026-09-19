# NexiMail v1.0.0 release closeout

A v1.0.0 candidate is releasable only when all of the following are true:

- package version is `1.0.0`
- release sanitization passes
- migrations apply cleanly
- automated tests pass
- TypeScript typecheck passes
- production build passes
- production compose validates
- MTA image builds and smoke test passes
- exact candidate revision is deployed to production
- production acceptance returns PASS (or only explicitly accepted non-blocking warnings)
- owner login/RBAC works
- all expected worker heartbeats are fresh
- sending-domain SPF/DKIM/DMARC readiness passes
- MTA forward/reverse DNS and STARTTLS pass
- CSV import smoke passes
- hard-bounce suppression smoke passes
- responsive campaign creation/reporting is manually checked on desktop and mobile
- provider cooldowns and reputation settings are visible to the owner
- campaign reports show provider impact or an explicit no-pressure state
- rollback backup and previous release remain available

After these gates pass, move `release/v1.0.0` to the final candidate SHA and freeze feature work for the release.
