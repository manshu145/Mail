import assert from "node:assert/strict";
import test from "node:test";
import { classifyMailboxRcptResponse } from "../src/lib/mailbox-validator";

test("SMTP RCPT 250 is accepted", () => {
  assert.equal(classifyMailboxRcptResponse(250, "250 2.1.5 Recipient OK").status, "accepted");
});

test("explicit missing mailbox is invalid", () => {
  assert.equal(classifyMailboxRcptResponse(550, "550 5.1.1 User unknown").status, "invalid");
  assert.equal(classifyMailboxRcptResponse(550, "550 recipient does not exist").status, "invalid");
});

test("temporary SMTP response stays unknown", () => {
  assert.equal(classifyMailboxRcptResponse(451, "451 4.7.1 Try again later").status, "unknown");
});

test("ambiguous policy rejection stays unknown", () => {
  assert.equal(classifyMailboxRcptResponse(550, "550 5.7.1 Access denied by policy").status, "unknown");
});
