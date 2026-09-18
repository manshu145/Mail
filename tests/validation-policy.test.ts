import assert from "node:assert/strict";
import test from "node:test";
import { classifyGmailRcptResponse, validationAllowsSend } from "../src/lib/validation-policy";

test("Gmail 250 acceptance is recorded as accepted, not unknown", () => {
  assert.equal(classifyGmailRcptResponse(250, "250 2.1.5 OK").status, "accepted");
});

test("Gmail 251 acceptance is recorded as accepted, not unknown", () => {
  assert.equal(classifyGmailRcptResponse(251, "251 User not local").status, "accepted");
});

test("explicit 550 5.1.1 is invalid", () => {
  assert.equal(classifyGmailRcptResponse(550, "550-5.1.1 The email account that you tried to reach does not exist").status, "invalid");
});

test("temporary Gmail response remains unknown", () => {
  assert.equal(classifyGmailRcptResponse(421, "421 4.7.0 Temporary rate limit").status, "unknown");
});

test("ambiguous negative response remains unknown", () => {
  assert.equal(classifyGmailRcptResponse(550, "550 5.7.1 Policy rejection").status, "unknown");
});


test("validation is optional for campaign sending", () => {
  assert.equal(validationAllowsSend("person@gmail.com", "pending"), true);
  assert.equal(validationAllowsSend("person@googlemail.com", "unknown"), true);
  assert.equal(validationAllowsSend("person@example.com", "error"), true);
});

test("known invalid validation verdict blocks sending", () => {
  assert.equal(validationAllowsSend("person@gmail.com", "accepted"), true);
  assert.equal(validationAllowsSend("person@example.com", "pending"), true);
  assert.equal(validationAllowsSend("person@example.com", "invalid"), false);
});
