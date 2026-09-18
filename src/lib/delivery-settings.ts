import { db } from "@/db";
import { systemSettings } from "@/db/schema";

export type DeliverySettings = {
  maxPerSecond: number;
  maxRecipientsPerCampaign: number;
  maxRollingHour: number;
  maxRolling24h: number;
  maxActiveQueued: number;
  retryMaxAttempts: number;
  retryInitialSeconds: number;
  retryMaxSeconds: number;
  retryBackoffMultiplier: number;
  reputationBounceStopRate: number;
  reputationComplaintStopRate: number;
  reputationMinSample: number;
};

export const DELIVERY_SETTING_KEYS = {
  maxPerSecond: "delivery.max_per_second",
  maxRecipientsPerCampaign: "delivery.max_recipients_per_campaign",
  maxRollingHour: "delivery.max_rolling_hour",
  maxRolling24h: "delivery.max_rolling_24h",
  maxActiveQueued: "delivery.max_active_queued",
  retryMaxAttempts: "delivery.retry_max_attempts",
  retryInitialSeconds: "delivery.retry_initial_seconds",
  retryMaxSeconds: "delivery.retry_max_seconds",
  retryBackoffMultiplier: "delivery.retry_backoff_multiplier",
  reputationBounceStopRate: "reputation.bounce_stop_rate",
  reputationComplaintStopRate: "reputation.complaint_stop_rate",
  reputationMinSample: "reputation.min_sample",
} as const;

function finite(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function int(value: unknown, fallback: number, min: number, max: number) { return Math.min(max, Math.max(min, Math.floor(finite(value, fallback)))); }
function num(value: unknown, fallback: number, min: number, max: number) { return Math.min(max, Math.max(min, finite(value, fallback))); }

export function defaultDeliverySettings(env: Readonly<Record<string,string|undefined>> = process.env): DeliverySettings {
  return {
    maxPerSecond: int(env.TRANSPORT_RATE_PER_SECOND, 1, 1, 1000),
    maxRecipientsPerCampaign: int(env.MAX_RECIPIENTS_PER_CAMPAIGN, 0, 0, 10_000_000),
    maxRollingHour: int(env.MAX_ROLLING_HOUR, 0, 0, 10_000_000),
    maxRolling24h: int(env.MAX_ROLLING_24H, 0, 0, 100_000_000),
    maxActiveQueued: int(env.MAX_ACTIVE_QUEUED, 15_000, 100, 10_000_000),
    retryMaxAttempts: int(env.TRANSPORT_MAX_ATTEMPTS, 5, 1, 20),
    retryInitialSeconds: int(env.TRANSPORT_RETRY_INITIAL_SECONDS, 30, 10, 86_400),
    retryMaxSeconds: int(env.TRANSPORT_RETRY_MAX_SECONDS, 3600, 30, 604_800),
    retryBackoffMultiplier: num(env.TRANSPORT_RETRY_BACKOFF_MULTIPLIER, 2, 1, 10),
    reputationBounceStopRate: num(env.REPUTATION_BOUNCE_STOP_RATE, 0.05, 0, 1),
    reputationComplaintStopRate: num(env.REPUTATION_COMPLAINT_STOP_RATE, 0.003, 0, 1),
    reputationMinSample: int(env.REPUTATION_MIN_SAMPLE, 100, 1, 10_000_000),
  };
}

export async function readDeliverySettings(): Promise<DeliverySettings> {
  const defaults = defaultDeliverySettings();
  const rows = await db.select().from(systemSettings);
  const values = new Map(rows.map((row) => [row.key, row.value]));
  return {
    maxPerSecond: int(values.get(DELIVERY_SETTING_KEYS.maxPerSecond), defaults.maxPerSecond, 1, 1000),
    maxRecipientsPerCampaign: int(values.get(DELIVERY_SETTING_KEYS.maxRecipientsPerCampaign), defaults.maxRecipientsPerCampaign, 0, 10_000_000),
    maxRollingHour: int(values.get(DELIVERY_SETTING_KEYS.maxRollingHour), defaults.maxRollingHour, 0, 10_000_000),
    maxRolling24h: int(values.get(DELIVERY_SETTING_KEYS.maxRolling24h), defaults.maxRolling24h, 0, 100_000_000),
    maxActiveQueued: int(values.get(DELIVERY_SETTING_KEYS.maxActiveQueued), defaults.maxActiveQueued, 100, 10_000_000),
    retryMaxAttempts: int(values.get(DELIVERY_SETTING_KEYS.retryMaxAttempts), defaults.retryMaxAttempts, 1, 20),
    retryInitialSeconds: int(values.get(DELIVERY_SETTING_KEYS.retryInitialSeconds), defaults.retryInitialSeconds, 10, 86_400),
    retryMaxSeconds: int(values.get(DELIVERY_SETTING_KEYS.retryMaxSeconds), defaults.retryMaxSeconds, 30, 604_800),
    retryBackoffMultiplier: num(values.get(DELIVERY_SETTING_KEYS.retryBackoffMultiplier), defaults.retryBackoffMultiplier, 1, 10),
    reputationBounceStopRate: num(values.get(DELIVERY_SETTING_KEYS.reputationBounceStopRate), defaults.reputationBounceStopRate, 0, 1),
    reputationComplaintStopRate: num(values.get(DELIVERY_SETTING_KEYS.reputationComplaintStopRate), defaults.reputationComplaintStopRate, 0, 1),
    reputationMinSample: int(values.get(DELIVERY_SETTING_KEYS.reputationMinSample), defaults.reputationMinSample, 1, 10_000_000),
  };
}
