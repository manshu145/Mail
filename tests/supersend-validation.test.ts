import test from "node:test";
import assert from "node:assert/strict";
import { classifySupersendPayload } from "../src/lib/supersend-validation";

test("SuperSend V2 valid boolean is authoritative", () => {
  const result = classifySupersendPayload({
    success: true,
    data: { email: "a@example.com", valid: true, validity_score: 92, risk_level: "LOW", confidence: "HIGH", has_historical_data: true, total_sends: 8, hard_bounce_count: 0 },
  });
  assert.equal(result.status, "valid");
  assert.match(result.detail, /supersend_v2_valid/);
});

test("SuperSend V2 false boolean is invalid", () => {
  const result = classifySupersendPayload({ success: true, data: { email: "a@example.com", valid: false, validity_score: 4, risk_level: "CRITICAL" } });
  assert.equal(result.status, "invalid");
});

test("SuperSend disallowed is invalid", () => {
  const result = classifySupersendPayload({ success: true, data: { email: "a@example.com", valid: true, is_disallowed: true } });
  assert.equal(result.status, "invalid");
});

test("missing V2 verdict remains retryable", () => {
  const result = classifySupersendPayload({ success: true, data: { email: "a@example.com" } });
  assert.equal(result.status, "unknown");
});