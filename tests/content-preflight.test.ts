import assert from "node:assert/strict";
import test from "node:test";
import { scanCampaignContent } from "../src/lib/content-preflight";

test("safe campaign content passes without a blocking finding", () => {
  const result = scanCampaignContent({ subject: "September update", html: '<p>News from Example.</p><a href="https://example.com/news">Read more</a><a href="{{unsubscribe_url}}">Unsubscribe</a>', text: "News from Example. Unsubscribe: {{unsubscribe_url}}", fromEmail: "news@example.com" });
  assert.notEqual(result.status, "blocked");
});

test("deceptive link target blocks launch", () => {
  const result = scanCampaignContent({ subject: "Update", html: '<a href="https://evil.example/phish">https://example.com/account</a>', text: "Update", fromEmail: "news@example.com" });
  assert.equal(result.status, "blocked");
  assert.ok(result.findings.some((finding) => finding.code === "mismatched_link_text"));
});

test("dangerous attachment blocks launch", () => {
  const result = scanCampaignContent({ subject: "File", html: "<p>Attached.</p>", text: "Attached.", fromEmail: "news@example.com", attachmentNames: ["invoice.exe"] });
  assert.equal(result.status, "blocked");
});
