import assert from "node:assert/strict";
import test from "node:test";
import { classifyDeliveryRestriction, providerForEmail, providerFromMxHosts, UPSTREAM_COOLDOWN_KEY } from "../src/lib/provider";

test("generic SMTP 4.x does not create provider cooldown", () => {
  assert.deepEqual(
    classifyDeliveryRestriction("451 temporary resource unavailable", "4.3.0"),
    { scope: "none", reason: "none" },
  );
});

test("mailbox policy restriction stays recipient-level", () => {
  assert.deepEqual(
    classifyDeliveryRestriction("452 Mailbox delivery restricted by policy for recipient", "4.0.0"),
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
    classifyDeliveryRestriction("451 Sender IP is not yet authorized to deliver mail from this envelope sender. Please try later.", "4.0.0").scope,
    "provider",
  );
});

test("JFE050004 stops the shared outbound infrastructure path", () => {
  const result=classifyDeliveryRestriction("550 5.7.1 We have identified an unusual number of invalid recipients originating from your account (JFE050004)", "5.7.1");
  assert.equal(result.scope, "upstream");
  assert.equal(result.reason, "sender_or_outbound_path_restriction");
  assert.equal(UPSTREAM_COOLDOWN_KEY, "__upstream__");
});

test("JFE050005 creates one outbound-infrastructure restriction", () => {
  const result=classifyDeliveryRestriction("550 5.7.1 An unusual amount of content policy violations originating from your account has been detected (JFE050005)", "4.7.1");
  assert.equal(result.scope, "upstream");
  assert.equal(result.reason, "sender_or_outbound_path_restriction");
  assert.equal(UPSTREAM_COOLDOWN_KEY, "__upstream__");
});

test("explicit local sending-account suspension creates upstream cooldown", () => {
  const result=classifyDeliveryRestriction("550 outbound SMTP sending account is suspended", "5.7.1");
  assert.equal(result.scope, "upstream");
  assert.equal(result.reason, "sender_or_outbound_path_restriction");
});

test("ordinary provider-local policy signals remain provider scoped", () => {
  const result=classifyDeliveryRestriction("421 4.7.0 Gmail rate limit exceeded for this sender IP", "4.7.0");
  assert.equal(result.scope, "provider");
});

test("Zoho mailbox domains map to Zoho provider", () => {
  assert.equal(providerForEmail(["person","zohomail.in"].join("@")), "zoho");
  assert.equal(providerForEmail(["person","zoho.com"].join("@")), "zoho");
});

test("custom Google Workspace MX hosts map to Gmail", () => {
  assert.equal(providerFromMxHosts(["aspmx.l.google.com"]), "gmail");
});

test("custom Microsoft MX hosts map to Microsoft", () => {
  assert.equal(providerFromMxHosts(["example-com.mail.protection.outlook.com"]), "microsoft");
});

test("unknown MX hosts do not invent a provider", () => {
  assert.equal(providerFromMxHosts(["mx.custom.example"]), null);
});
