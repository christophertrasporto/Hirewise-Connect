import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

/** Random URL-safe token for cookies and emailed links. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Tokens are stored hashed so a database leak does not yield usable sessions or links. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET must be set (at least 16 characters)");
  return scryptSync(secret, "hirewise-connect-mfa", 32);
}

/** AES-256-GCM for secrets at rest (TOTP secrets). Output: base64url(iv | tag | ciphertext). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

export function decryptSecret(enc: string): string {
  const buf = Buffer.from(enc, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
