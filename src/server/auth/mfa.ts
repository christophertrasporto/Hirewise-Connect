import { TOTP, Secret } from "otpauth";
import QRCode from "qrcode";
import { decryptSecret, encryptSecret } from "./crypto";

const ISSUER = "Hirewise Connect";

export function generateMfaSecret(): { secretBase32: string; secretEnc: string } {
  const secret = new Secret({ size: 20 });
  return { secretBase32: secret.base32, secretEnc: encryptSecret(secret.base32) };
}

function totpFor(secretBase32: string, label: string) {
  return new TOTP({ issuer: ISSUER, label, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secretBase32) });
}

export function otpauthUri(secretBase32: string, label: string): string {
  return totpFor(secretBase32, label).toString();
}

export async function otpauthQrDataUrl(secretBase32: string, label: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri(secretBase32, label), { margin: 1, width: 200 });
}

/** Accepts the current code and one step either side to absorb clock drift. */
export function verifyTotp(secretEnc: string, code: string, label = "user"): boolean {
  const cleaned = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  const delta = totpFor(decryptSecret(secretEnc), label).validate({ token: cleaned, window: 1 });
  return delta !== null;
}
