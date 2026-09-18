export const EXPECTED_WORKERS = [
  "import",
  "campaign",
  "policy",
  "transport",
  "event",
  "postfix-events",
  "bounce-receiver",
  "validation",
  "domain-health",
  "dkim",
  "reputation",
  "webhook",
] as const;

export const WORKER_HEARTBEAT_STALE_MS = 10 * 60 * 1000;

export function isWorkerHeartbeatFresh(lastSeenAt: Date | string | null | undefined, now = Date.now()) {
  if (!lastSeenAt) return false;
  const value = lastSeenAt instanceof Date ? lastSeenAt.getTime() : new Date(lastSeenAt).getTime();
  return Number.isFinite(value) && now - value <= WORKER_HEARTBEAT_STALE_MS;
}
