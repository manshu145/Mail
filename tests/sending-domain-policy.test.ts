import test from "node:test";
import assert from "node:assert/strict";
import { sendingDomainBlockReason, type SendingDomainHealth } from "../src/lib/sending-domain-policy";

const ready: SendingDomainHealth = {
  status: "ready",
  spfOk: true,
  dkimOk: true,
  dmarcOk: true,
  bounceDomain: "bounce.example.com",
  bounceSpfOk: true,
  bounceMxOk: true,
  bounceStatus: "ready",
};

test("sending domain policy allows fully authenticated sender and bounce path", () => {
  assert.equal(sendingDomainBlockReason(ready, { bounceSigningEnabled: true }), null);
});

test("sending domain policy blocks missing or incomplete authentication", () => {
  assert.equal(sendingDomainBlockReason(null, { bounceSigningEnabled: true }), "sender_domain_not_configured");
  assert.equal(sendingDomainBlockReason({ ...ready, spfOk: false }, { bounceSigningEnabled: true }), "spf_not_ready");
  assert.equal(sendingDomainBlockReason({ ...ready, dkimOk: false }, { bounceSigningEnabled: true }), "dkim_not_ready");
  assert.equal(sendingDomainBlockReason({ ...ready, dmarcOk: false }, { bounceSigningEnabled: true }), "dmarc_not_ready");
});

test("sending domain policy requires verified VERP bounce handling", () => {
  assert.equal(sendingDomainBlockReason(ready, { bounceSigningEnabled: false }), "bounce_signing_secret_missing");
  assert.equal(sendingDomainBlockReason({ ...ready, bounceDomain: null }, { bounceSigningEnabled: true }), "bounce_domain_not_configured");
  assert.equal(sendingDomainBlockReason({ ...ready, bounceMxOk: false, bounceStatus: "warning" }, { bounceSigningEnabled: true }), "bounce_domain_not_ready");
});
