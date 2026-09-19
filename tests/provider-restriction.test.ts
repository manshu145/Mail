import assert from "node:assert/strict";
import test from "node:test";
import { classifyDeliveryRestriction, providerForEmail, SENDER_COOLDOWN_KEY } from "../src/lib/provider";

test("generic SMTP 4.x does not create provider cooldown", () => {
  assert.deepEqual(
    classifyDeliveryRestriction("451 temporary resource unavailable", "4.3.0"),
    { scope: "none", reason: "none" },
  );
});

test("mailbox policy restriction stays recipient-level", () => {
  assert.deepEqual(
    classifyDeliveryRestriction("452 Mailbox delivery restricted by policy error <user@zohomail.in>", "4.0.0"),
    { scope: "none", reason: "recipient_or_mailbox_condition" },
  );
});

test("mailbox full stays recipient-level", () => {
  assert.equal(classifyDeliveryRestriction("452 4.2.2 mailbox full", "4.2.2").scope, "none");
});

test("explicit provider rate limit creates provider cooldown", () => {
  assert.equal(classifyDeliveryRestriction("421 4.7.0 rate limit exceeded, try again later", "4.7.0").scope, "provider");
});

test("sender/IP authorization restriction creates provider cooldown", () => {
  assert.equal(
    classifyDeliveryRestriction("451-104.207.93.18 is not yet authorized to deliver mail from sender. Please try later.", "4.0.0").scope,
    "provider",
  );
});

test("JFE050005 cross-provider account restriction creates sender cooldown", () => {
  const result=classifyDeliveryRestriction("550 5.7.1 An unusual amount of content policy violations originating from your account has been detected (JFE050005)", "4.7.1");
  assert.equal(result.scope, "sender");
  assert.equal(result.reason, "sender_or_outbound_path_restriction");
  assert.equal(SENDER_COOLDOWN_KEY, "__sender__");
});

test("Zoho mailbox domains map to Zoho provider", () => {
  assert.equal(providerForEmail("person@zohomail.in"), "zoho");
  assert.equal(providerForEmail("person@zoho.com"), "zoho");
});
