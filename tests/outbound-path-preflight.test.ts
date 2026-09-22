import assert from "node:assert/strict";
import test from "node:test";
import { classifySmtpBanner } from "../src/lib/outbound-path-preflight";

test("normal SMTP greeting is ready", () => {
  assert.deepEqual(classifySmtpBanner("220 mx.example ESMTP ready"), { ready: true, restricted: false, scope: "none" });
});

test("JFE bridge greeting is an upstream restriction", () => {
  const result = classifySmtpBanner("550 5.7.1 An unusual amount of content policy violations originating from your account has been detected (JFE050005)");
  assert.equal(result.ready, false);
  assert.equal(result.restricted, true);
  assert.equal(result.scope, "upstream");
});
