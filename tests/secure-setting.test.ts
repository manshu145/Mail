import assert from "node:assert/strict";
import test from "node:test";
import { decryptWorkspaceSecret, encryptWorkspaceSecret, encryptedSettingHint } from "../src/lib/secure-setting";

test("workspace secrets round-trip encrypted without storing plaintext", () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "test-auth-secret-that-is-long-enough-for-encryption-12345";
  try {
    const raw = "example-provider-key-123456789";
    const encrypted = encryptWorkspaceSecret(raw);
    assert.equal(encrypted.v, 1);
    assert.equal(encrypted.alg, "aes-256-gcm");
    assert.notEqual(encrypted.data, raw);
    assert.equal(JSON.stringify(encrypted).includes(raw), false);
    assert.equal(decryptWorkspaceSecret(encrypted), raw);
    assert.match(encryptedSettingHint(encrypted) || "", /^••••/);
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  }
});

test("tampered encrypted settings do not decrypt", () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "test-auth-secret-that-is-long-enough-for-encryption-12345";
  try {
    const encrypted = encryptWorkspaceSecret("another-provider-key-123456");
    assert.equal(decryptWorkspaceSecret({ ...encrypted, data: encrypted.data.slice(0, -2) + "AA" }), null);
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  }
});
