import assert from "node:assert/strict";
import test from "node:test";
import { classifyMxRecords } from "../src/lib/recipient-domain-health";

test("recipient domain MX records are normalized and ordered", () => {
  assert.deepEqual(classifyMxRecords("example.com", [
    { exchange: "MX2.EXAMPLE.COM.", priority: 20 },
    { exchange: "mx1.example.com.", priority: 10 },
  ]), {
    domain: "example.com",
    status: "valid",
    mxHosts: ["mx1.example.com", "mx2.example.com"],
    detail: null,
  });
});

test("empty MX answer is permanently ineligible", () => {
  assert.equal(classifyMxRecords("example.invalid", []).status, "no_mx");
});

test("RFC 7505 null MX is permanently ineligible", () => {
  const result = classifyMxRecords("example.com", [{ exchange: ".", priority: 0 }]);
  assert.equal(result.status, "null_mx");
  assert.deepEqual(result.mxHosts, []);
});
