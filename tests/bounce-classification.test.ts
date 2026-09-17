import assert from "node:assert/strict";
import test from "node:test";
import { classifyBounce } from "../src/lib/bounce-classification";

test("5.1.1 recipient not found is suppressible", () => {
  const result = classifyBounce("5.1.1", "550 5.1.1 user unknown");
  assert.equal(result.kind, "recipient");
  assert.equal(result.suppressRecipient, true);
  assert.equal(result.providerPressure, false);
});

test("5.7.1 spam policy rejection does not suppress recipient", () => {
  const result = classifyBounce("5.7.1", "554 5.7.1 Rejected due to high probability of spam");
  assert.equal(result.kind, "policy");
  assert.equal(result.suppressRecipient, false);
  assert.equal(result.providerPressure, true);
});

test("temporary provider failures do not suppress recipient", () => {
  const result = classifyBounce("4.7.0", "421 temporary rate limit, try again");
  assert.equal(result.kind, "temporary");
  assert.equal(result.suppressRecipient, false);
});
