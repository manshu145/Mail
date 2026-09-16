import crypto from "node:crypto";

function key() {
  const secret = process.env.WEBHOOK_SECRET_KEY;
  if (!secret || secret.length < 32) throw new Error("WEBHOOK_SECRET_KEY must be at least 32 characters");
  return crypto.createHash("sha256").update(secret).digest();
}

export function newWebhookSecret() {
  return `whsec_${crypto.randomBytes(32).toString("base64url")}`;
}

export function encryptWebhookSecret(secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptWebhookSecret(ciphertext: string) {
  const packed = Buffer.from(ciphertext, "base64url");
  if (packed.length < 29) throw new Error("Invalid webhook secret ciphertext");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const encrypted = packed.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function signWebhookBody(secret: string, body: string) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}
