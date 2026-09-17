import assert from "node:assert/strict";
import test from "node:test";
import { classifyBounce } from "../src/lib/bounce-classification";

test("5.1.1 recipient not found is suppressible", () => {
  const result = classifyBounce("5.1.1", "550 5.1.1 user unknown");
  assert.equal(result.kind, "recipient");
  assert.equal(result.suppressRecipient, true);
  assert.equal(result.providerPressure, false);
});

test("5.7.1 spam policy rejection is message-level, not provider cooldown", () => {
  const result = classifyBounce("5.7.1", "554 5.7.1 Rejected due to high probability of spam");
  assert.equal(result.kind, "policy");
  assert.equal(result.suppressRecipient, false);
  assert.equal(result.providerPressure, false);
});

test("generic recipient address rejected policy text is not a hard bounce", () => {
  const result = classifyBounce("5.7.1", "550 5.7.1 Recipient address rejected: Access denied");
  assert.equal(result.kind, "policy");
  assert.equal(result.suppressRecipient, false);
});

test("generic address rejection without mailbox-not-found proof is not suppressed", () => {
  const result = classifyBounce("5.0.0", "550 Recipient address rejected");
  assert.equal(result.suppressRecipient, false);
});

test("temporary provider restriction requests provider cooldown", () => {
  const result = classifyBounce("4.7.0", "421 temporary rate limit, try again later");
  assert.equal(result.kind, "temporary");
  assert.equal(result.suppressRecipient, false);
  assert.equal(result.providerPressure, true);
});

test("mailbox full is recipient-specific and does not pause provider", () => {
  const result = classifyBounce("4.2.2", "452 4.2.2 mailbox full / over quota");
  assert.equal(result.kind, "temporary");
  assert.equal(result.suppressRecipient, false);
  assert.equal(result.providerPressure, false);
});
