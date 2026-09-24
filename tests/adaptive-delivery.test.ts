import assert from "node:assert/strict";
import test from "node:test";
import { decideAdaptiveDelivery } from "../src/lib/adaptive-delivery";

const config = { initialBatch: 100, secondBatch: 300, thirdBatch: 600, bounceWarnRate: 0.03, bounceStopRate: 0.05, reputationMinSample: 100 };

test("large campaign starts with the configured canary only", () => {
  const result = decideAdaptiveDelivery({ total: 3000, released: 0, sample: 0, bounced: 0, phase: 0, releaseLimit: 0, config });
  assert.equal(result.releaseLimit, 100);
  assert.equal(result.state, "canary");
});

test("healthy canary expands to the second batch", () => {
  const result = decideAdaptiveDelivery({ total: 3000, released: 100, sample: 90, bounced: 1, phase: 0, releaseLimit: 100, config });
  assert.equal(result.releaseLimit, 400);
  assert.equal(result.state, "ramping");
});

test("warning bounce rate permits only a small next batch", () => {
  const result = decideAdaptiveDelivery({ total: 3000, released: 100, sample: 90, bounced: 3, phase: 0, releaseLimit: 100, config });
  assert.equal(result.releaseLimit, 130);
  assert.equal(result.state, "slowed");
});

test("small early bounce sample does not pause before the configured minimum sample", () => {
  const result = decideAdaptiveDelivery({ total: 3000, released: 100, sample: 20, bounced: 2, phase: 0, releaseLimit: 100, config });
  assert.equal(result.paused, false);
  assert.equal(result.releaseLimit, 100);
});

test("five hard bounces in the first hundred terminal outcomes pauses the campaign", () => {
  const result = decideAdaptiveDelivery({ total: 3000, released: 100, sample: 100, bounced: 5, phase: 0, releaseLimit: 100, config });
  assert.equal(result.paused, true);
  assert.equal(result.releaseLimit, 100);
});

test("small campaign does not pause after every recipient has already been released", () => {
  const result = decideAdaptiveDelivery({ total: 94, released: 94, sample: 94, bounced: 25, phase: 3, releaseLimit: 94, config });
  assert.equal(result.paused, false);
  assert.equal(result.state, "open");
  assert.equal(result.releaseLimit, 94);
});

test("small campaign can still stop while recipients remain unsent", () => {
  const result = decideAdaptiveDelivery({ total: 94, released: 80, sample: 47, bounced: 3, phase: 0, releaseLimit: 94, config });
  assert.equal(result.paused, true);
  assert.equal(result.state, "paused");
  assert.equal(result.reason, "hard_bounce_rate_stop");
});

test("zero bounce stop threshold disables automatic hard-bounce pause", () => {
  const result = decideAdaptiveDelivery({
    total: 1000, released: 100, sample: 100, bounced: 20, phase: 0, releaseLimit: 100,
    config: { ...config, bounceStopRate: 0 },
  });
  assert.equal(result.paused, false);
});

test("zero canary warning threshold disables slowdown", () => {
  const result = decideAdaptiveDelivery({
    total: 3000, released: 100, sample: 100, bounced: 3, phase: 0, releaseLimit: 100,
    config: { ...config, bounceWarnRate: 0 },
  });
  assert.equal(result.paused, false);
  assert.equal(result.releaseLimit, 400);
});
