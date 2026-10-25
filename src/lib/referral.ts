/** Pure referral helpers: codes, email normalization, display names, and commission math. No I/O. */

/** Where a commission came from: a talent enrolment payment or an agency Course Seat purchase. */
export type CommissionSource = "ENROLLMENT" | "COURSE_PURCHASE";

/** No I, L, O, 0, or 1: codes are read aloud and typed by hand. */
const SUFFIX_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_SUFFIX_LENGTH = 6;
export const CODE_SHAPE = /^[A-Z]{2,8}-[A-HJ-KM-NP-Z2-9]{6}$/;

/** First name in capital ASCII letters, 2 to 8 long, so FRIENDLY-XXXXXX reads like MARIA-7K2QX9. */
export function codePrefix(displayName: string | null | undefined): string {
  const first = (displayName ?? "").normalize("NFKD").replace(/[^\x00-\x7F]/g, "").trim().split(/\s+/)[0] ?? "";
  const letters = first.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 8);
  return letters.length >= 2 ? letters : "HIRE";
}

/** `randomInt(n)` must be cryptographically secure and return an integer in [0, n). */
export function makeReferralCode(displayName: string | null | undefined, randomInt: (maxExclusive: number) => number): string {
  let suffix = "";
  for (let i = 0; i < CODE_SUFFIX_LENGTH; i++) suffix += SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)];
  return `${codePrefix(displayName)}-${suffix}`;
}

export function isReferralCodeShape(code: string | null | undefined): code is string {
  return !!code && CODE_SHAPE.test(code);
}

/**
 * Collapses the ways one mailbox can be written: case, +tags, and for Gmail the dots in the local part
 * (and googlemail.com). Two sign-ups that normalize equal are the same mailbox.
 */
export function normalizeEmail(email: string): string {
  const [localRaw, domainRaw] = email.trim().toLowerCase().split("@");
  if (!domainRaw) return email.trim().toLowerCase();
  let domain = domainRaw;
  let local = localRaw.split("+")[0];
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export function digitsOnly(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

/** Privacy: members see buyers as "Maria S." only. */
export function firstNameLastInitial(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Member";
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1].replace(/[^\p{L}]/gu, "");
  return last ? `${parts[0]} ${last[0].toUpperCase()}.` : parts[0];
}

/**
 * What a commission is calculated on: the amount actually paid, after discounts (the paid amount already reflects
 * them), minus taxes and payment fees, never above the list price, never negative. Minor units only.
 */
export function commissionBase(p: { paid: number; taxes?: number; fees?: number; listPrice?: number | null }): number {
  for (const n of [p.paid, p.taxes ?? 0, p.fees ?? 0]) if (!Number.isInteger(n) || n < 0) throw new Error("Amounts must be non-negative integers in minor units.");
  const capped = p.listPrice != null ? Math.min(p.paid, p.listPrice) : p.paid;
  return Math.max(0, capped - (p.taxes ?? 0) - (p.fees ?? 0));
}

/** Integer commission, rounded down: 15% of 4999 is 749, never a fraction of a cent. */
export function commissionAmount(base: number, rateBps: number): number {
  if (!Number.isInteger(base) || base < 0) throw new Error("Base must be a non-negative integer in minor units.");
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) throw new Error("Rate must be between 0 and 10000 basis points.");
  return Math.floor((base * rateBps) / 10_000);
}

export function rateLabel(rateBps: number): string {
  const pct = rateBps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, "")}%`;
}
