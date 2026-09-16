import crypto from "node:crypto";

function encryptionKey() {
  const secret = process.env.DKIM_SECRET_KEY;
  if (!secret || secret.length < 32) throw new Error("DKIM_SECRET_KEY must be at least 32 characters");
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptDkimPrivateKey(ciphertext: string) {
  const packed = Buffer.from(ciphertext, "base64url");
  if (packed.length < 29) throw new Error("Invalid DKIM key ciphertext");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const encrypted = packed.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function createDkimMaterial(selector = "default") {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const publicDer = crypto.createPublicKey(publicKey).export({ type: "spki", format: "der" });
  const publicKeyBase64 = Buffer.from(publicDer).toString("base64");
  return {
    selector,
    publicKey: publicKeyBase64,
    publicRecord: `v=DKIM1; k=rsa; p=${publicKeyBase64}`,
    privateKeyCiphertext: encrypt(privateKey),
  };
}
