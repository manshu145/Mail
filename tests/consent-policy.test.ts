import test from "node:test";
import assert from "node:assert/strict";
import { hasConfirmedConsent } from "../src/lib/consent-policy";

test("marketing consent requires confirmation AND a nonblank source", () => {
  assert.equal(hasConfirmedConsent({ consentStatus: "confirmed", consentSource: "Signup form" }), true);
  assert.equal(hasConfirmedConsent({ consentStatus: "unconfirmed", consentSource: "CSV import" }), false);
  assert.equal(hasConfirmedConsent({ consentStatus: "confirmed", consentSource: null }), false);
  assert.equal(hasConfirmedConsent({ consentStatus: "confirmed", consentSource: "   " }), false);
  assert.equal(hasConfirmedConsent({ consentStatus: "revoked", consentSource: "Signup form" }), false);
});
