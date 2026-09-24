import { db } from "@/db";
import { systemSettings } from "@/db/schema";

export const MAX_PROVIDER_COOLDOWN_MINUTES = 60;

export type DeliverySettings = {
  maxPerSecond: number;
  providerIntervalMs: number;
  maxRecipientsPerCampaign: number;
  maxRollingHour: number;
  maxRolling24h: number;
  maxActiveQueued: number;
  maxConcurrentCampaigns: number;
  campaignBurstPerRound: number;
  retryMaxAttempts: number;
  retryInitialSeconds: number;
  retryMaxSeconds: number;
  retryBackoffMultiplier: number;
  providerCooldownMinutes: number;
  reputationBounceStopRate: number;
  reputationComplaintStopRate: number;
  reputationMinSample: number;
  canaryInitialBatch: number;
  canarySecondBatch: number;
  canaryThirdBatch: number;
  canaryBounceWarnRate: number;
  adaptivePacingEnabled: boolean;
  adaptivePacingBasePerSecond: number;
  adaptivePacingTargetPerSecond: number;
  adaptivePacingHealthyRounds: number;
  adaptivePacingIncreasePercent: number;
  adaptivePacingPressureMultiplier: number;
  adaptivePacingMinimumPerSecond: number;
};

export const DELIVERY_SETTING_KEYS = {
  maxPerSecond: "delivery.max_per_second",
  providerIntervalMs: "delivery.provider_interval_ms",
  maxRecipientsPerCampaign: "delivery.max_recipients_per_campaign",
  maxRollingHour: "delivery.max_rolling_hour",
  maxRolling24h: "delivery.max_rolling_24h",
  maxActiveQueued: "delivery.max_active_queued",
  maxConcurrentCampaigns: "delivery.max_concurrent_campaigns",
  campaignBurstPerRound: "delivery.campaign_burst_per_round",
  retryMaxAttempts: "delivery.retry_max_attempts",
  retryInitialSeconds: "delivery.retry_initial_seconds",
  retryMaxSeconds: "delivery.retry_max_seconds",
  retryBackoffMultiplier: "delivery.retry_backoff_multiplier",
  providerCooldownMinutes: "delivery.provider_cooldown_minutes",
  reputationBounceStopRate: "reputation.bounce_stop_rate",
  reputationComplaintStopRate: "reputation.complaint_stop_rate",
  reputationMinSample: "reputation.min_sample",
  canaryInitialBatch: "delivery.canary_initial_batch",
  canarySecondBatch: "delivery.canary_second_batch",
  canaryThirdBatch: "delivery.canary_third_batch",
  canaryBounceWarnRate: "delivery.canary_bounce_warn_rate",
  adaptivePacingEnabled: "delivery.adaptive_pacing_enabled",
  adaptivePacingBasePerSecond: "delivery.adaptive_pacing_base_per_second",
  adaptivePacingTargetPerSecond: "delivery.adaptive_pacing_target_per_second",
  adaptivePacingHealthyRounds: "delivery.adaptive_pacing_healthy_rounds",
  adaptivePacingIncreasePercent: "delivery.adaptive_pacing_increase_percent",
  adaptivePacingPressureMultiplier: "delivery.adaptive_pacing_pressure_multiplier",
  adaptivePacingMinimumPerSecond: "delivery.adaptive_pacing_minimum_per_second",
} as const;

function finite(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function int(value: unknown, fallback: number, min: number, max: number) { return Math.min(max, Math.max(min, Math.floor(finite(value, fallback)))); }
function num(value: unknown, fallback: number, min: number, max: number) { return Math.min(max, Math.max(min, finite(value, fallback))); }
function bool(value: unknown, fallback: boolean) { if (typeof value === "boolean") return value; if (typeof value === "string") return value.toLowerCase() === "true" ? true : value.toLowerCase() === "false" ? false : fallback; return fallback; }

export function defaultDeliverySettings(env: Readonly<Record<string,string|undefined>> = process.env): DeliverySettings {
  return {
    maxPerSecond: int(env.TRANSPORT_RATE_PER_SECOND, 1, 1, 1000),
    providerIntervalMs: int(env.TRANSPORT_PROVIDER_INTERVAL_MS, 1000, 250, 60_000),
    maxRecipientsPerCampaign: int(env.MAX_RECIPIENTS_PER_CAMPAIGN, 0, 0, 10_000_000),
    maxRollingHour: int(env.MAX_ROLLING_HOUR, 0, 0, 10_000_000),
    maxRolling24h: int(env.MAX_ROLLING_24H, 0, 0, 100_000_000),
    maxActiveQueued: int(env.MAX_ACTIVE_QUEUED, 15_000, 100, 10_000_000),
    maxConcurrentCampaigns: int(env.MAX_CONCURRENT_CAMPAIGNS, 0, 0, 10_000),
    campaignBurstPerRound: int(env.CAMPAIGN_BURST_PER_ROUND, 1, 1, 50),
    retryMaxAttempts: int(env.TRANSPORT_MAX_ATTEMPTS, 5, 1, 20),
    retryInitialSeconds: int(env.TRANSPORT_RETRY_INITIAL_SECONDS, 30, 10, 86_400),
    retryMaxSeconds: int(env.TRANSPORT_RETRY_MAX_SECONDS, 3600, 30, 604_800),
    retryBackoffMultiplier: num(env.TRANSPORT_RETRY_BACKOFF_MULTIPLIER, 2, 1, 10),
    providerCooldownMinutes: int(env.PROVIDER_COOLDOWN_MINUTES, 15, 1, MAX_PROVIDER_COOLDOWN_MINUTES),
    reputationBounceStopRate: num(env.REPUTATION_BOUNCE_STOP_RATE, 0.05, 0, 1),
    reputationComplaintStopRate: num(env.REPUTATION_COMPLAINT_STOP_RATE, 0.001, 0, 1),
    reputationMinSample: int(env.REPUTATION_MIN_SAMPLE, 100, 1, 10_000_000),
    canaryInitialBatch: int(env.CANARY_INITIAL_BATCH, 100, 10, 100_000),
    canarySecondBatch: int(env.CANARY_SECOND_BATCH, 300, 10, 1_000_000),
    canaryThirdBatch: int(env.CANARY_THIRD_BATCH, 600, 10, 5_000_000),
    canaryBounceWarnRate: num(env.CANARY_BOUNCE_WARN_RATE, 0.03, 0, 1),
    adaptivePacingEnabled: bool(env.ADAPTIVE_PACING_ENABLED, true),
    adaptivePacingBasePerSecond: num(env.ADAPTIVE_PACING_BASE_PER_SECOND, 1, 0.1, 1000),
    adaptivePacingTargetPerSecond: num(env.ADAPTIVE_PACING_TARGET_PER_SECOND, 5, 0.1, 1000),
    adaptivePacingHealthyRounds: int(env.ADAPTIVE_PACING_HEALTHY_ROUNDS, 3, 1, 100),
    adaptivePacingIncreasePercent: num(env.ADAPTIVE_PACING_INCREASE_PERCENT, 25, 1, 100),
    adaptivePacingPressureMultiplier: num(env.ADAPTIVE_PACING_PRESSURE_MULTIPLIER, 0.5, 0.1, 0.95),
    adaptivePacingMinimumPerSecond: num(env.ADAPTIVE_PACING_MINIMUM_PER_SECOND, 0.25, 0.1, 1000),
  };
}

export async function readDeliverySettings(): Promise<DeliverySettings> {
  const defaults = defaultDeliverySettings();
  const rows = await db.select().from(systemSettings);
  const values = new Map(rows.map((row) => [row.key, row.value]));
  return {
    maxPerSecond: int(values.get(DELIVERY_SETTING_KEYS.maxPerSecond), defaults.maxPerSecond, 1, 1000),
    providerIntervalMs: int(values.get(DELIVERY_SETTING_KEYS.providerIntervalMs), defaults.providerIntervalMs, 250, 60_000),
    maxRecipientsPerCampaign: int(values.get(DELIVERY_SETTING_KEYS.maxRecipientsPerCampaign), defaults.maxRecipientsPerCampaign, 0, 10_000_000),
    maxRollingHour: int(values.get(DELIVERY_SETTING_KEYS.maxRollingHour), defaults.maxRollingHour, 0, 10_000_000),
    maxRolling24h: int(values.get(DELIVERY_SETTING_KEYS.maxRolling24h), defaults.maxRolling24h, 0, 100_000_000),
    maxActiveQueued: int(values.get(DELIVERY_SETTING_KEYS.maxActiveQueued), defaults.maxActiveQueued, 100, 10_000_000),
    maxConcurrentCampaigns: int(values.get(DELIVERY_SETTING_KEYS.maxConcurrentCampaigns), defaults.maxConcurrentCampaigns, 0, 10_000),
    campaignBurstPerRound: int(values.get(DELIVERY_SETTING_KEYS.campaignBurstPerRound), defaults.campaignBurstPerRound, 1, 50),
    retryMaxAttempts: int(values.get(DELIVERY_SETTING_KEYS.retryMaxAttempts), defaults.retryMaxAttempts, 1, 20),
    retryInitialSeconds: int(values.get(DELIVERY_SETTING_KEYS.retryInitialSeconds), defaults.retryInitialSeconds, 10, 86_400),
    retryMaxSeconds: int(values.get(DELIVERY_SETTING_KEYS.retryMaxSeconds), defaults.retryMaxSeconds, 30, 604_800),
    retryBackoffMultiplier: num(values.get(DELIVERY_SETTING_KEYS.retryBackoffMultiplier), defaults.retryBackoffMultiplier, 1, 10),
    providerCooldownMinutes: int(values.get(DELIVERY_SETTING_KEYS.providerCooldownMinutes), defaults.providerCooldownMinutes, 1, MAX_PROVIDER_COOLDOWN_MINUTES),
    reputationBounceStopRate: num(values.get(DELIVERY_SETTING_KEYS.reputationBounceStopRate), defaults.reputationBounceStopRate, 0, 1),
    reputationComplaintStopRate: num(values.get(DELIVERY_SETTING_KEYS.reputationComplaintStopRate), defaults.reputationComplaintStopRate, 0, 1),
    reputationMinSample: int(values.get(DELIVERY_SETTING_KEYS.reputationMinSample), defaults.reputationMinSample, 1, 10_000_000),
    canaryInitialBatch: int(values.get(DELIVERY_SETTING_KEYS.canaryInitialBatch), defaults.canaryInitialBatch, 10, 100_000),
    canarySecondBatch: int(values.get(DELIVERY_SETTING_KEYS.canarySecondBatch), defaults.canarySecondBatch, 10, 1_000_000),
    canaryThirdBatch: int(values.get(DELIVERY_SETTING_KEYS.canaryThirdBatch), defaults.canaryThirdBatch, 10, 5_000_000),
    canaryBounceWarnRate: num(values.get(DELIVERY_SETTING_KEYS.canaryBounceWarnRate), defaults.canaryBounceWarnRate, 0, 1),
    adaptivePacingEnabled: bool(values.get(DELIVERY_SETTING_KEYS.adaptivePacingEnabled), defaults.adaptivePacingEnabled),
    adaptivePacingBasePerSecond: num(values.get(DELIVERY_SETTING_KEYS.adaptivePacingBasePerSecond), defaults.adaptivePacingBasePerSecond, 0.1, 1000),
    adaptivePacingTargetPerSecond: num(values.get(DELIVERY_SETTING_KEYS.adaptivePacingTargetPerSecond), defaults.adaptivePacingTargetPerSecond, 0.1, 1000),
    adaptivePacingHealthyRounds: int(values.get(DELIVERY_SETTING_KEYS.adaptivePacingHealthyRounds), defaults.adaptivePacingHealthyRounds, 1, 100),
    adaptivePacingIncreasePercent: num(values.get(DELIVERY_SETTING_KEYS.adaptivePacingIncreasePercent), defaults.adaptivePacingIncreasePercent, 1, 100),
    adaptivePacingPressureMultiplier: num(values.get(DELIVERY_SETTING_KEYS.adaptivePacingPressureMultiplier), defaults.adaptivePacingPressureMultiplier, 0.1, 0.95),
    adaptivePacingMinimumPerSecond: num(values.get(DELIVERY_SETTING_KEYS.adaptivePacingMinimumPerSecond), defaults.adaptivePacingMinimumPerSecond, 0.1, 1000),
  };
}
