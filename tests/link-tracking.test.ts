import assert from "node:assert/strict";
import test from "node:test";
import { rewriteTrackingLinks } from "../src/lib/link-tracking";

const APP_URL = "https://mail.example.com";
const MESSAGE_ID = "message-123";

async function signToken(payload: { messageId: string; url: string }) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

test("rewrites only absolute HTTP(S) anchor href attributes", async () => {
  const html = [
    '<a href="https://example.com/offer">Offer</a>',
    "<a class='secondary' HREF='https://example.com/pricing'>Pricing</a>",
  ].join("");

  const result = await rewriteTrackingLinks(html, APP_URL, MESSAGE_ID, signToken);

  assert.match(result, /href="https://mail.example.com/tracking/click//);
  assert.match(result, /HREF='https://mail.example.com/tracking/click//);
  assert.doesNotMatch(result, /href="https://example.com/offer"/);
  assert.doesNotMatch(result, /HREF='https://example.com/pricing'/);
});

test("does not rewrite resource href/src attributes outside anchors", async () => {
  const html = [
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">',
    '<img src="https://cdn.example.com/image.png" alt="Image">',
    '<script src="https://cdn.example.com/app.js"></script>',
    '<div data-href="https://example.com/not-a-click">Resource</div>',
    '<a href="https://example.com/real-click">Real click</a>',
  ].join("");

  const result = await rewriteTrackingLinks(html, APP_URL, MESSAGE_ID, signToken);

  assert.match(result, /fonts.googleapis.com/css2/);
  assert.match(result, /src="https://cdn.example.com/image.png"/);
  assert.match(result, /src="https://cdn.example.com/app.js"/);
  assert.match(result, /data-href="https://example.com/not-a-click"/);
  assert.match(result, /href="https://mail.example.com/tracking/click//);
});

test("preserves NexiMail unsubscribe and existing tracking links", async () => {
  const html = [
    '<a href="https://mail.example.com/unsubscribe/token">Unsubscribe</a>',
    '<a href="https://mail.example.com/tracking/click/existing">Existing tracking</a>',
    '<a href="https://example.com/real-click">Real click</a>',
  ].join("");

  const result = await rewriteTrackingLinks(html, APP_URL, MESSAGE_ID, signToken);

  assert.equal((result.match(/tracking\/click/g) || []).length, 2);
  assert.match(result, /href="https://mail.example.com/unsubscribe/token"/);
  assert.match(result, /href="https://mail.example.com/tracking/click/existing"/);
  assert.match(result, /href="https://mail.example.com/tracking/click/[A-Za-z0-9_-]+"/);
});
