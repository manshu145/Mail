import assert from "node:assert/strict";
import test from "node:test";
import { recipientProvider, runProviderAwarePool, validationNeedsBackoff } from "../src/lib/validation-throughput";

test("provider mapping groups major mailbox brands", () => {
  assert.equal(recipientProvider("gmail.com"), "google");
  assert.equal(recipientProvider("googlemail.com"), "google");
  assert.equal(recipientProvider("yahoo.co.in"), "yahoo");
  assert.equal(recipientProvider("hotmail.com"), "microsoft");
  assert.equal(recipientProvider("rediffmail.com"), "rediff");
});

test("provider-aware scheduler caps total concurrency and respects configured provider lanes", async () => {
  const items = [
    { id: 1, provider: "google" },
    { id: 2, provider: "google" },
    { id: 3, provider: "google" },
    { id: 4, provider: "yahoo" },
    { id: 5, provider: "yahoo" },
    { id: 6, provider: "microsoft" },
  ];

  let active = 0;
  let maxActive = 0;
  const activeByProvider = new Map<string, number>();
  const maxByProvider = new Map<string, number>();

  const outcome = await runProviderAwarePool(
    items,
    (item) => item.provider,
    async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      const providerActive = (activeByProvider.get(item.provider) || 0) + 1;
      activeByProvider.set(item.provider, providerActive);
      maxByProvider.set(item.provider, Math.max(maxByProvider.get(item.provider) || 0, providerActive));
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      activeByProvider.set(item.provider, providerActive - 1);
      return { status: "accepted" as const, detail: "smtp_rcpt_250_accepted" };
    },
    {
      concurrency: 4,
      lanesForProvider: (provider) => provider === "google" ? 2 : 1,
      providerStartGapMs: 0,
      backoffDelayMs: 0,
    },
  );

  assert.equal(outcome.completed, items.length);
  assert.ok(maxActive <= 4);
  assert.ok((maxByProvider.get("google") || 0) <= 2);
  assert.ok((maxByProvider.get("yahoo") || 0) <= 1);
  assert.ok((maxByProvider.get("microsoft") || 0) <= 1);
});

test("temporary or policy SMTP results request provider backoff", () => {
  assert.equal(validationNeedsBackoff({ status: "unknown", detail: "smtp_rcpt_451_temporary_or_policy" }), true);
  assert.equal(validationNeedsBackoff({ status: "accepted", detail: "smtp_rcpt_250_accepted" }), false);
});
