import assert from "node:assert/strict";
import test from "node:test";
import { makeBounceAddress, parseBounceAddress } from "../src/lib/bounce-address";

const previousDomain = process.env.BOUNCE_DOMAIN;
const previousSecret = process.env.BOUNCE_SECRET;

process.env.BOUNCE_DOMAIN = "bounce.example.com";
process.env.BOUNCE_SECRET = "test-secret-for-bounces-at-least-24-chars";

test.after(() => {
  if (previousDomain === undefined) delete process.env.BOUNCE_DOMAIN; else process.env.BOUNCE_DOMAIN = previousDomain;
  if (previousSecret === undefined) delete process.env.BOUNCE_SECRET; else process.env.BOUNCE_SECRET = previousSecret;
});

test("VERP bounce address round-trips a message id", () => {
  const messageId = "123e4567-e89b-12d3-a456-426614174000";
  const address = makeBounceAddress(messageId);
  assert.match(address, /^b\+[0-9a-f]{32}\.[0-9a-f]{24}@bounce\.example\.com$/);
  assert.deepEqual(parseBounceAddress(address), { messageId });
});

test("tampered VERP signature is rejected", () => {
  const messageId = "123e4567-e89b-12d3-a456-426614174000";
  const address = makeBounceAddress(messageId);
  const tampered = address.replace(/\.([0-9a-f])/, (_, char: string) => `.${char === "a" ? "b" : "a"}`);
  assert.equal(parseBounceAddress(tampered), null);
});

test("wrong bounce domain is rejected", () => {
  const messageId = "123e4567-e89b-12d3-a456-426614174000";
  const address = makeBounceAddress(messageId).replace("bounce.example.com", "evil.example.com");
  assert.equal(parseBounceAddress(address), null);
});
