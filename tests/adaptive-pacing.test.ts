import assert from "node:assert/strict";
import test from "node:test";
import { AdaptivePacingController } from "../src/lib/adaptive-pacing";

const config = {
  enabled: true,
  basePerSecond: 1,
  targetPerSecond: 5,
  maxPerSecond: 10,
  healthyRounds: 2,
  increasePercent: 50,
  pressureMultiplier: 0.5,
  minimumPerSecond: 0.25,
};

test("adaptive pacing starts conservatively", () => {
  const controller = new AdaptivePacingController(config);
  assert.equal(controller.currentRate, 1);
});

test("healthy rounds ramp gradually toward target", () => {
  const controller = new AdaptivePacingController(config);
  controller.observe({ accepted: 100, deferred: 0, failed: 0, providerHeld: 0 });
  assert.equal(controller.currentRate, 1);
  controller.observe({ accepted: 100, deferred: 0, failed: 0, providerHeld: 0 });
  assert.equal(controller.currentRate, 1.5);
  controller.observe({ accepted: 100, deferred: 0, failed: 0, providerHeld: 0 });
  controller.observe({ accepted: 100, deferred: 0, failed: 0, providerHeld: 0 });
  assert.equal(controller.currentRate, 2.25);
});

test("provider pressure immediately slows the active rate", () => {
  const controller = new AdaptivePacingController({ ...config, basePerSecond: 4 });
  const next = controller.observe({ accepted: 10, deferred: 1, failed: 0, providerHeld: 1 });
  assert.equal(next, 2);
});

test("disabled controller never changes configured rate", () => {
  const controller = new AdaptivePacingController({ ...config, enabled: false, basePerSecond: 3 });
  assert.equal(controller.currentRate, 3);
  assert.equal(controller.observe({ accepted: 0, deferred: 10, failed: 0, providerHeld: 0 }), 3);
});
