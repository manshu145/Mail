import assert from "node:assert/strict";
import test from "node:test";
import { buildBulkDeliverabilityHeaders } from "../src/lib/deliverability-headers";
import { defaultDeliverySettings } from "../src/lib/delivery-settings";

test("bulk deliverability headers include one-click unsubscribe and stable Gmail feedback id", () => {
  const headers = buildBulkDeliverabilityHeaders({
    campaignId: "11111111-2222-3333-4444-555555555555",
    sendingAccountId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    listId: "12345678-90ab-cdef-1234-567890abcdef",
    senderDomain: "Example.COM",
    unsubscribeUrl: "https://example.com/unsubscribe/token",
  });

  assert.ok(headers.includes("List-Unsubscribe: <https://example.com/unsubscribe/token>"));
  assert.ok(headers.includes("List-Unsubscribe-Post: List-Unsubscribe=One-Click"));
  assert.ok(headers.includes("Feedback-ID: 1111111122223333:aaaaaaaabbbbcccc:marketing:neximail"));
  assert.ok(headers.includes("List-ID: <1234567890abcdef1234567890abcdef.example.com>"));
});

test("default complaint stop threshold is conservative for inbox protection", () => {
  const settings = defaultDeliverySettings({});
  assert.equal(settings.reputationComplaintStopRate, 0.001);
});
