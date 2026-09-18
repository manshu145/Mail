import crypto from "node:crypto";

export type EncryptedSetting = {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  data: string;
  hint: string;
};

function encryptionKey() {
  const secret = String(process.env.AUTH_SECRET || "").trim();
  if (secret.length < 32) throw new Error("AUTH_SECRET must be configured before encrypted workspace secrets can be stored.");
  return crypto.createHash("sha256").update("neximail:workspace-secret:v1:").update(secret).digest();
}

export function encryptWorkspaceSecret(value: string): EncryptedSetting {
  const plain = value.trim();
  if (!plain) throw new Error("Secret cannot be empty.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
    hint: plain.length <= 4 ? "••••" : `••••${plain.slice(-4)}`,
  };
}

export function decryptWorkspaceSecret(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<EncryptedSetting>;
  if (row.v !== 1 || row.alg !== "aes-256-gcm" || !row.iv || !row.tag || !row.data) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(row.iv, "base64"));
    decipher.setAuthTag(Buffer.from(row.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(row.data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function encryptedSettingHint(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const hint = (value as Partial<EncryptedSetting>).hint;
  return typeof hint === "string" ? hint : null;
}
