import assert from "node:assert/strict";
import test from "node:test";
import { classifyGmailRcptResponse } from "../src/lib/validation-policy";

test("Gmail 250 acceptance remains unknown", () => {
  assert.equal(classifyGmailRcptResponse(250, "250 2.1.5 OK").status, "unknown");
});

test("Gmail 251 acceptance remains unknown", () => {
  assert.equal(classifyGmailRcptResponse(251, "251 User not local").status, "unknown");
});

test("explicit 550 5.1.1 is invalid", () => {
  assert.equal(classifyGmailRcptResponse(550, "550-5.1.1 The email account that you tried to reach does not exist").status, "invalid");
});

test("ambiguous negative response remains unknown", () => {
  assert.equal(classifyGmailRcptResponse(550, "550 5.7.1 Policy rejection").status, "unknown");
});
