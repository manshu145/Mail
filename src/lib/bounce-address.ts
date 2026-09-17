import { createHmac, timingSafeEqual } from "node:crypto";

function secret() {
  const value = process.env.BOUNCE_SECRET?.trim();
  if (!value || value.length < 24) throw new Error("BOUNCE_SECRET must be configured with at least 24 characters");
  return value;
}

export function getBounceDomain() {
  const value = process.env.BOUNCE_DOMAIN?.trim().toLowerCase();
  if (!value || !/^[a-z0-9.-]+$/.test(value)) throw new Error("BOUNCE_DOMAIN is not configured");
  return value;
}

function compactMessageId(messageId: string) {
  const compact = messageId.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) throw new Error("Invalid message id for bounce address");
  return compact;
}

function signature(compact: string) {
  return createHmac("sha256", secret()).update(`neximail-bounce:${compact}`).digest("hex").slice(0, 24);
}

export function makeBounceAddress(messageId: string) {
  const compact = compactMessageId(messageId);
  return `b+${compact}.${signature(compact)}@${getBounceDomain()}`;
}

export function parseBounceAddress(address: string): { messageId: string } | null {
  const match = address.trim().toLowerCase().match(/^b\+([0-9a-f]{32})\.([0-9a-f]{24})@([a-z0-9.-]+)$/);
  if (!match || match[3] !== getBounceDomain()) return null;
  const expected = signature(match[1]);
  const supplied = match[2];
  if (expected.length !== supplied.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return null;
  const compact = match[1];
  return { messageId: `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}` };
}
