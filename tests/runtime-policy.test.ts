import assert from "node:assert/strict";
import test from "node:test";
import { getRuntimePolicy } from "../src/lib/runtime-policy";

test("runtime fails closed when mode and send flag are omitted", () => {
  const policy = getRuntimePolicy({});
  assert.equal(policy.mode, "staging");
  assert.equal(policy.sendingEnabled, false);
  assert.equal(policy.isolated, true);
});

test("production sending requires both explicit production mode and send enable", () => {
  assert.equal(getRuntimePolicy({ NEXIMAIL_RUNTIME_MODE: "production" }).sendingEnabled, false);
  assert.equal(getRuntimePolicy({ NEXIMAIL_SEND_ENABLED: "true" }).sendingEnabled, false);
  const policy = getRuntimePolicy({ NEXIMAIL_RUNTIME_MODE: "production", NEXIMAIL_SEND_ENABLED: "true" });
  assert.equal(policy.mode, "production");
  assert.equal(policy.sendingEnabled, true);
  assert.equal(policy.isolated, false);
});

test("staging send remains separately gated and recipient-capped", () => {
  const policy = getRuntimePolicy({
    NEXIMAIL_RUNTIME_MODE: "staging",
    NEXIMAIL_STAGING_SEND_ENABLED: "true",
    NEXIMAIL_STAGING_MAX_RECIPIENTS: "999999",
  });
  assert.equal(policy.sendingEnabled, true);
  assert.equal(policy.maxRecipientsPerCampaign, 5000);
});
