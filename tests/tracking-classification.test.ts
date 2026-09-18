import assert from "node:assert/strict";
import test from "node:test";
import { classifyTrackingRequest } from "../src/lib/tracking-classification";

function req(headers: Record<string,string>) {
  return new Request("https://mail.example.com/tracking/open/token", { headers });
}

test("Gmail image proxy is recorded as proxied, not automatically classified as a scanner", () => {
  const result = classifyTrackingRequest(req({
    "user-agent": "Mozilla/5.0 (via ggpht.com GoogleImageProxy)",
    "x-forwarded-for": "203.0.113.10",
  }));
  assert.equal(result.automated, false);
  assert.equal(result.proxyProvider, "google_image_proxy");
  assert.ok(result.ipHash);
});

test("explicit prefetch remains automated", () => {
  const result = classifyTrackingRequest(req({
    "user-agent": "Mozilla/5.0",
    "purpose": "prefetch",
  }));
  assert.equal(result.automated, true);
  assert.match(result.automationReason || "", /purpose/i);
});

test("known security scanners remain automated", () => {
  const result = classifyTrackingRequest(req({
    "user-agent": "Proofpoint URL Defense Scanner",
  }));
  assert.equal(result.automated, true);
});
