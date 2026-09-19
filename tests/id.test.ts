import test from "node:test";
import assert from "node:assert/strict";
import { isUuid } from "../src/lib/id";

test("isUuid accepts canonical UUID strings", () => {
  assert.equal(isUuid("49104188-4069-4df6-8aa5-840b1b383cc6"), true);
});

test("isUuid rejects malformed values", () => {
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid("4910418840694df68aa5840b1b383cc6"), false);
  assert.equal(isUuid(null), false);
});
