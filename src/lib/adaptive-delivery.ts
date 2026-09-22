export type AdaptiveDeliveryConfig = {
  initialBatch: number;
  secondBatch: number;
  thirdBatch: number;
  bounceWarnRate: number;
  bounceStopRate: number;
  reputationMinSample: number;
};

export type AdaptiveDeliveryDecision = {
  phase: number;
  releaseLimit: number;
  state: "open" | "canary" | "ramping" | "slowed" | "paused";
  bounceRate: number;
  paused: boolean;
  reason: string | null;
};

export function decideAdaptiveDelivery(input: {
  total: number;
  released: number;
  sample: number;
  bounced: number;
  phase: number;
  releaseLimit: number;
  config: AdaptiveDeliveryConfig;
}): AdaptiveDeliveryDecision {
  const total = Math.max(0, input.total);
  const initial = Math.min(total, Math.max(1, input.config.initialBatch));
  let phase = Math.max(0, input.phase);
  let releaseLimit = Math.min(total, Math.max(initial, input.releaseLimit));
  const bounceRate = input.sample > 0 ? input.bounced / input.sample : 0;
  if (total <= initial) return { phase: 3, releaseLimit: total, state: "open", bounceRate, paused: false, reason: null };

  const earlySample = Math.min(input.config.reputationMinSample, Math.max(20, Math.ceil(Math.max(1, releaseLimit) * 0.2)));
  if (input.sample >= earlySample && bounceRate >= input.config.bounceStopRate) {
    return { phase, releaseLimit, state: "paused", bounceRate, paused: true, reason: "hard_bounce_rate_stop" };
  }

  const phaseEvaluated = input.released >= releaseLimit
    && input.sample >= Math.min(releaseLimit, Math.max(20, Math.ceil(releaseLimit * 0.8)));
  if (!phaseEvaluated || releaseLimit >= total) {
    return { phase, releaseLimit, state: releaseLimit >= total ? "open" : "canary", bounceRate, paused: false, reason: null };
  }

  const nextBatch = phase === 0 ? input.config.secondBatch : phase === 1 ? input.config.thirdBatch : total;
  if (bounceRate >= input.config.bounceWarnRate) {
    releaseLimit = Math.min(total, releaseLimit + Math.max(10, Math.floor(nextBatch * 0.1)));
    return { phase, releaseLimit, state: "slowed", bounceRate, paused: false, reason: "hard_bounce_rate_slowdown" };
  }

  releaseLimit = Math.min(total, phase >= 2 ? total : releaseLimit + nextBatch);
  phase = Math.min(3, phase + 1);
  return { phase, releaseLimit, state: releaseLimit >= total ? "open" : "ramping", bounceRate, paused: false, reason: null };
}
