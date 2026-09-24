import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("reputation worker is telemetry-only and does not globally pause senders", async () => {
  const source = await readFile("scripts/workers/reputation-worker.ts", "utf8");
  assert.doesNotMatch(source, /sendingAccounts\).*set\(\{status:\s*"paused"/);
  assert.match(source, /action:"telemetry_only"/);
});
