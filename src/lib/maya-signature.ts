import { createVerify } from "node:crypto";

/**
 * Maya webhook signature, version 1 (https://developers.maya.ph/reference/webhook-security): RSA-SHA256 over the
 * payload flattened to sorted "key=value" pairs (dot notation for nesting, null and empty values skipped) joined with
 * "&" and ending in "&nonce=<nonce>". Pure functions, no I/O.
 */

export const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

/** Exactly the documented flattening: nested keys joined with ".", arrays by index, empties skipped. */
export function flattenForSignature(obj: Record<string, unknown>, prefix = "", out: string[] = []): string[] {
  if (typeof obj !== "object" || obj === null) throw new Error("Input must be an object");
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === "" || typeof value === "undefined") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "object" && Object.keys(value as object).length === 0) continue;
    if (typeof value === "object") {
      flattenForSignature(value as Record<string, unknown>, full, out);
      continue;
    }
    out.push(`${full}=${String(value)}`);
  }
  return out;
}

export function signedString(payload: Record<string, unknown>, nonce: string): string {
  return `${flattenForSignature(payload).sort().join("&")}&nonce=${nonce}`;
}

/** "nonce=abc,v1=ff00..." to its parts. Split on commas, then on the first "=". */
export function parseSignatureHeader(header: string | null | undefined): { nonce: string | null; v1: string | null } {
  const parts: Record<string, string> = {};
  for (const seg of (header ?? "").split(",")) {
    const i = seg.indexOf("=");
    if (i > 0) parts[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
  }
  return { nonce: parts.nonce ?? null, v1: parts.v1 ?? null };
}

export type SignatureResult = { valid: boolean; reason: "ok" | "no-signature" | "no-keys" | "bad-body" | "stale-timestamp" | "bad-signature" };

export function verifyMayaSignature(p: { rawBody: string; signatureHeader: string | null | undefined; timestampHeader: string | null | undefined; publicKeys: readonly string[]; now?: number }): SignatureResult {
  const { nonce, v1 } = parseSignatureHeader(p.signatureHeader);
  if (!nonce || !v1) return { valid: false, reason: "no-signature" };
  if (p.publicKeys.length === 0) return { valid: false, reason: "no-keys" };
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(p.rawBody);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { valid: false, reason: "bad-body" };
    payload = parsed as Record<string, unknown>;
  } catch {
    return { valid: false, reason: "bad-body" };
  }
  const ts = Number(p.timestampHeader);
  if (!Number.isFinite(ts) || Math.abs((p.now ?? Date.now()) - ts) > TIMESTAMP_TOLERANCE_MS) return { valid: false, reason: "stale-timestamp" };
  const toVerify = signedString(payload, nonce);
  for (const key of p.publicKeys) {
    try {
      const verifier = createVerify("RSA-SHA256");
      verifier.update(toVerify);
      if (verifier.verify(key, v1, "hex")) return { valid: true, reason: "ok" };
    } catch {
      // A malformed key or signature simply fails this key; the next one is tried.
    }
  }
  return { valid: false, reason: "bad-signature" };
}
