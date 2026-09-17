import assert from "node:assert/strict";
import test from "node:test";
import { injectPreheader } from "../src/lib/email-preheader";

test("injectPreheader inserts immediately after body tag", () => {
  const html = "<html><body class=\"mail\"><p>Hello</p></body></html>";
  const output = injectPreheader(html, "Your August invoice is ready");
  assert.match(output, /<body class="mail"><div style="display:none!important;/);
  assert.match(output, /Your August invoice is ready/);
});

test("injectPreheader safely escapes markup", () => {
  const output = injectPreheader("<p>Hello</p>", `<script>alert("x")</script>`);
  assert.doesNotMatch(output, /<script>/);
  assert.match(output, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
});

test("injectPreheader leaves HTML unchanged when blank", () => {
  assert.equal(injectPreheader("<p>Hello</p>", "   "), "<p>Hello</p>");
});
