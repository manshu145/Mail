import assert from "node:assert/strict";
import test from "node:test";
import { runDomainAwarePool, validationDelayForVerdict } from "../src/lib/validation-throughput";

test("domain-aware pool never probes the same domain concurrently", async () => {
  const items = [
    { id: 1, domain: "gmail.com" },
    { id: 2, domain: "gmail.com" },
    { id: 3, domain: "outlook.com" },
    { id: 4, domain: "outlook.com" },
    { id: 5, domain: "example.org" },
    { id: 6, domain: "example.org" },
  ];

  let active = 0;
  let maxActive = 0;
  const activeByDomain = new Map<string, number>();
  let maxSameDomain = 0;

  const outcome = await runDomainAwarePool(
    items,
    (item) => item.domain,
    async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      const domainActive = (activeByDomain.get(item.domain) || 0) + 1;
      activeByDomain.set(item.domain, domainActive);
      maxSameDomain = Math.max(maxSameDomain, domainActive);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      activeByDomain.set(item.domain, domainActive - 1);
      return { status: "accepted" as const, detail: "smtp_rcpt_250_accepted" };
    },
    { concurrency: 2, minDelayMs: 0, backoffDelayMs: 0 },
  );

  assert.equal(outcome.completed, items.length);
  assert.equal(outcome.domains, 3);
  assert.ok(maxActive <= 2);
  assert.equal(maxSameDomain, 1);
});

test("temporary or policy SMTP results back off a domain lane", () => {
  assert.equal(
    validationDelayForVerdict({ status: "unknown", detail: "smtp_rcpt_451_temporary_or_policy" }, 1000, 15000),
    15000,
  );
  assert.equal(
    validationDelayForVerdict({ status: "accepted", detail: "smtp_rcpt_250_accepted" }, 1000, 15000),
    1000,
  );
});
