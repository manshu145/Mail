export type AdaptivePacingConfig = {
  enabled: boolean;
  basePerSecond: number;
  targetPerSecond: number;
  maxPerSecond: number;
  healthyRounds: number;
  increasePercent: number;
  pressureMultiplier: number;
  minimumPerSecond: number;
};

export type AdaptivePacingOutcome = {
  accepted: number;
  deferred: number;
  failed: number;
  providerHeld: number;
};

export class AdaptivePacingController {
  private rate: number;
  private healthyRounds = 0;

  constructor(private readonly config: AdaptivePacingConfig) {
    this.rate = Math.max(config.minimumPerSecond, Math.min(config.maxPerSecond, config.basePerSecond));
  }

  get currentRate() {
    return this.rate;
  }

  observe(outcome: AdaptivePacingOutcome) {
    if (!this.config.enabled) return this.rate;

    const attempted = outcome.accepted + outcome.deferred + outcome.failed + outcome.providerHeld;
    if (attempted === 0) return this.rate;

    const pressure = outcome.providerHeld > 0 || outcome.deferred > 0;
    const hardFailure = outcome.failed > 0;
    const pressureRatio = (outcome.deferred + outcome.providerHeld) / attempted;

    if (pressure || pressureRatio >= 0.02 || hardFailure && outcome.accepted === 0) {
      this.healthyRounds = 0;
      const multiplier = pressureRatio >= 0.10 || outcome.providerHeld > 0
        ? Math.min(this.config.pressureMultiplier, 0.5)
        : this.config.pressureMultiplier;
      this.rate = Math.max(this.config.minimumPerSecond, Number((this.rate * multiplier).toFixed(3)));
      return this.rate;
    }

    this.healthyRounds += 1;
    if (this.healthyRounds >= this.config.healthyRounds && this.rate < this.config.targetPerSecond) {
      this.healthyRounds = 0;
      const next = this.rate * (1 + this.config.increasePercent / 100);
      this.rate = Math.min(this.config.targetPerSecond, this.config.maxPerSecond, Number(next.toFixed(3)));
    }

    return this.rate;
  }
}
