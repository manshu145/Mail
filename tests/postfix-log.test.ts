import test from "node:test";
import assert from "node:assert/strict";
import { completeLogLines, parsePostfixLog } from "../src/lib/postfix-log";

test("Postfix cleanup maps queue ID to app message when acceptance reply is lost", () => {
  assert.deepEqual(parsePostfixLog("Sep 17 postfix/cleanup[1]: ABC123: message-id=<12345678-1234-1234-1234-123456789abc@example.com>"), {
    queueId: "ABC123", messageId: "12345678-1234-1234-1234-123456789abc", outcome: null,
  });
  assert.equal(parsePostfixLog("postfix/smtp[2]: ABC123: to=<a@b.com>, dsn=2.0.0, status=sent (OK)")?.outcome, "sent");
  assert.equal(parsePostfixLog("irrelevant log"), null);
});
test("Checkpoint stops before partial UTF-8 lines and replay has stable deduplication keys", () => {
  const data = Buffer.from("first é\nsecond incomplete");
  const batch = completeLogLines(data, 20);
  assert.equal(batch.nextOffset, 29);
  assert.equal(batch.lines.length, 1);
  assert.equal(batch.lines[0].line, "first é");
  assert.equal(batch.lines[0].key, completeLogLines(data, 20).lines[0].key);
  assert.notEqual(batch.lines[0].key, completeLogLines(data, 21).lines[0].key);
});
