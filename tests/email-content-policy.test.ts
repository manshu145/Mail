import test from "node:test";
import assert from "node:assert/strict";
import { emailContentBlockReason } from "../src/lib/email-content-policy";

test("content policy accepts normal multipart marketing content", () => {
  assert.equal(emailContentBlockReason({
    subject: "September product update",
    html: "<p>Here is a useful update for subscribers with enough readable copy.</p>",
    text: "Here is a useful update for subscribers with enough readable copy.",
  }), null);
});

test("content policy blocks empty and unsafe content", () => {
  assert.equal(emailContentBlockReason({ subject: "", html: "<p>Hello</p>", text: "Hello" }), "subject_missing");
  assert.equal(emailContentBlockReason({ subject: "Hello", html: "<script>alert(1)</script>", text: "Hello there" }), "unsafe_html_element");
  assert.equal(emailContentBlockReason({ subject: "Hello", html: '<a href="javascript:alert(1)">Click</a>', text: "Click this link" }), "unsafe_link_scheme");
});

test("content policy blocks image-only email", () => {
  assert.equal(emailContentBlockReason({ subject: "Offer", html: '<img src="https://example.com/a.jpg" alt="">', text: "" }), "image_only_content");
});
