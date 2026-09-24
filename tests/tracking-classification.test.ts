import assert from "node:assert/strict";
import test from "node:test";
import { classifyTrackingRequest, qualifyClickEvent, qualifyOpenEvent } from "../src/lib/tracking-classification";

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

test("an open before confirmed delivery is preserved but not qualified", () => {
  const result = qualifyOpenEvent(classifyTrackingRequest(req({ "user-agent": "Mozilla/5.0" })), {
    deliveredAt: new Date("2026-09-22T10:00:01Z"),
    eventAt: new Date("2026-09-22T10:00:00Z"),
    sameIpDistinctRecipients: 1,
  });
  assert.equal(result.qualified, false);
  assert.equal(result.automated, true);
  assert.equal(result.deliveryToOpenMs, -1000);
});

test("a non-proxy IP opening many recipients is not qualified", () => {
  const result = qualifyOpenEvent(classifyTrackingRequest(req({ "user-agent": "Mozilla/5.0", "x-forwarded-for": "203.0.113.11" })), {
    deliveredAt: new Date("2026-09-22T09:55:00Z"),
    eventAt: new Date("2026-09-22T10:00:00Z"),
    sameIpDistinctRecipients: 10,
  });
  assert.equal(result.qualified, false);
  assert.equal(result.automationReason, "shared_ip_recipient_burst");
});

test("Gmail image proxy is not disqualified by shared proxy IP alone", () => {
  const result = qualifyOpenEvent(classifyTrackingRequest(req({ "user-agent": "GoogleImageProxy", "x-forwarded-for": "203.0.113.12" })), {
    deliveredAt: new Date("2026-09-22T09:55:00Z"),
    eventAt: new Date("2026-09-22T10:00:00Z"),
    sameIpDistinctRecipients: 500,
  });
  assert.equal(result.proxyProvider, "google_image_proxy");
  assert.equal(result.qualified, true);
});

test("an open before delivery is not qualified when delivery is not yet recorded", () => {
  const result = qualifyOpenEvent(classifyTrackingRequest(req({ "user-agent": "Mozilla/5.0" })), {
    deliveredAt: null,
    eventAt: new Date("2026-09-22T10:00:00Z"),
    sameIpDistinctRecipients: 1,
  });
  assert.equal(result.qualified, false);
  assert.equal(result.automated, true);
  assert.equal(result.automationReason, "delivery_not_confirmed");
});

test("a click before delivery is not qualified when delivery is not yet recorded", () => {
  const result = qualifyClickEvent(classifyTrackingRequest(req({ "user-agent": "Mozilla/5.0" })), {
    deliveredAt: null,
    eventAt: new Date("2026-09-22T10:00:00Z"),
    sameIpDistinctRecipients: 1,
  });
  assert.equal(result.qualified, false);
  assert.equal(result.automated, true);
  assert.equal(result.automationReason, "delivery_not_confirmed");
});
