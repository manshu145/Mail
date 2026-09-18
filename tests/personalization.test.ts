import assert from "node:assert/strict";
import test from "node:test";
import { personalizeContactText, samplePersonalization } from "../src/lib/personalization";

test("renders standard and custom contact fields", () => {
  const result = personalizeContactText("Hi {{first_name|Customer}} from {{city}} — {{email}}", {
    email: "person@example.com",
    firstName: "Manshu",
    lastName: "Sinha",
    attributes: { city: "Raipur" },
  });
  assert.equal(result, "Hi Manshu from Raipur — person@example.com");
});

test("uses explicit fallback when contact name is absent", () => {
  const result = personalizeContactText("Dear {{first_name|Customer}}", { email: "person@example.com" });
  assert.equal(result, "Dear Customer");
});

test("keeps unsubscribe token for the delivery layer", () => {
  const result = personalizeContactText("{{unsubscribe_url}}", { email: "person@example.com" });
  assert.equal(result, "{{unsubscribe_url}}");
});

test("sample personalization gives preview-safe values", () => {
  const result = samplePersonalization("Hi {{first_name|Customer}} in {{city}}", "manshu.test@example.com");
  assert.equal(result, "Hi Manshu in Raipur");
});

test("HTML personalization escapes imported markup and attribute quotes", async () => {
  const { personalizeContactHtml } = await import("../src/lib/personalization");
  const contact = { email: "a@example.com", firstName: '<img src=x onerror="alert(1)">', attributes: { city: "A&B" } };
  assert.equal(personalizeContactHtml('<p title="{{first_name}}">{{city}}</p>', contact), '<p title="&lt;img src=x onerror=&quot;alert(1)&quot;&gt;">A&amp;B</p>');
  assert.equal(personalizeContactText("{{first_name}}", contact), contact.firstName);
});
