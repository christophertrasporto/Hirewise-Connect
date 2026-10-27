/**
 * Promo code rules as pure functions: no database, no clock of their own. Money is integer minor units. The service
 * (`promo.service.ts`) loads the facts and calls these, so the maths and the validity rules are tested on their own.
 */

export type PromoDiscount = { type: "PERCENT"; percentBps: number } | { type: "AMOUNT"; amountMinor: number; currency: string };

export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,31}$/;

/** Upper-case, no spaces, so "spring 20" and "SPRING20" are the same code. */
export function normalizeCode(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function isValidCodeFormat(code: string): boolean {
  return CODE_PATTERN.test(code);
}

/**
 * The discount a code gives on a price, or null when it does not apply (an amount code in another currency). Percent
 * discounts round down to the centavo; an amount never exceeds the price, so the final price is never negative.
 */
export function computeDiscount(discount: PromoDiscount, price: { listMinor: number; currency: string }): { discountMinor: number; finalMinor: number } | null {
  if (!Number.isInteger(price.listMinor) || price.listMinor < 0) throw new Error("Price must be a non-negative integer in minor units.");
  let off: number;
  if (discount.type === "PERCENT") {
    if (!Number.isInteger(discount.percentBps) || discount.percentBps < 1 || discount.percentBps > 10_000) throw new Error("Percent must be between 1 and 10000 basis points.");
    off = Math.floor((price.listMinor * discount.percentBps) / 10_000);
  } else {
    if (!Number.isInteger(discount.amountMinor) || discount.amountMinor < 1) throw new Error("Amount must be a positive integer in minor units.");
    if (discount.currency !== price.currency) return null;
    off = discount.amountMinor;
  }
  const discountMinor = Math.min(off, price.listMinor);
  return { discountMinor, finalMinor: price.listMinor - discountMinor };
}

export type PromoRefusal = "NOT_ACTIVE" | "NOT_STARTED" | "EXPIRED" | "NOT_FOR_COURSE" | "CURRENCY_MISMATCH" | "BELOW_MINIMUM" | "FULLY_USED" | "LEARNER_LIMIT" | "NOTHING_TO_DISCOUNT";

export type PromoFacts = {
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  perLearnerLimit: number;
  minPriceMinor: number;
  appliesTo: "ALL_COURSES" | "SELECTED_COURSES";
  courseIds: string[];
  discount: PromoDiscount;
};

/**
 * Whether a code may be used right now for this course and learner, with the discount it would give. `usedTotal` and
 * `usedByLearner` count live (reserved or consumed) redemptions, not counting the enrolment being re-priced.
 */
export function evaluatePromo(
  promo: PromoFacts,
  ctx: { now: Date; courseId: string; listMinor: number; currency: string; usedTotal: number; usedByLearner: number },
): { ok: true; discountMinor: number; finalMinor: number } | { ok: false; reason: PromoRefusal } {
  if (promo.status !== "ACTIVE") return { ok: false, reason: "NOT_ACTIVE" };
  if (promo.startsAt && ctx.now < promo.startsAt) return { ok: false, reason: "NOT_STARTED" };
  if (promo.endsAt && ctx.now >= promo.endsAt) return { ok: false, reason: "EXPIRED" };
  if (promo.appliesTo === "SELECTED_COURSES" && !promo.courseIds.includes(ctx.courseId)) return { ok: false, reason: "NOT_FOR_COURSE" };
  if (ctx.listMinor <= 0) return { ok: false, reason: "NOTHING_TO_DISCOUNT" };
  if (ctx.listMinor < promo.minPriceMinor) return { ok: false, reason: "BELOW_MINIMUM" };
  const priced = computeDiscount(promo.discount, { listMinor: ctx.listMinor, currency: ctx.currency });
  if (!priced) return { ok: false, reason: "CURRENCY_MISMATCH" };
  if (promo.maxRedemptions !== null && ctx.usedTotal >= promo.maxRedemptions) return { ok: false, reason: "FULLY_USED" };
  if (ctx.usedByLearner >= promo.perLearnerLimit) return { ok: false, reason: "LEARNER_LIMIT" };
  return { ok: true, ...priced };
}

/** What the learner is told for every refusal, so codes cannot be probed for existence, expiry, or remaining uses. */
export const PROMO_REFUSAL_MESSAGE = "This code isn't valid for this course.";

/** "10% off" or "₱200.00 off", for staff lists and the learner's price line. */
export function discountLabel(discount: PromoDiscount): string {
  if (discount.type === "PERCENT") {
    const pct = discount.percentBps / 100;
    return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}% off`;
  }
  return `${new Intl.NumberFormat("en-US", { style: "currency", currency: discount.currency }).format(discount.amountMinor / 100)} off`;
}

/** A random, readable code for the "Generate" button: no 0/O or 1/I look-alikes. */
export function generateCode(prefix = "HW", random: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(random() * alphabet.length)];
  return `${prefix}-${s}`;
}
