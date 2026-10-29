import { z } from "zod";
import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { systemActor } from "@/server/auth/actor";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { referralRepository } from "@/server/repositories/referral.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { getSetting } from "./setting.service";
import { commissionAmount, commissionBase, type CommissionSource } from "@/lib/referral";
import { proportionalShare } from "@/lib/coach-wallet";
type CommissionSourceType = CommissionSource;

/**
 * Commission ledger. Commissions are created only from a confirmed payment (today: the staff payment recordings for
 * course enrolments and agency course-seat purchases), exactly once per payment, with the rate locked at the sale.
 */

export type PaymentFacts = {
  sourceType: CommissionSourceType;
  sourceId: string;
  buyerUserId: string;
  courseId: string;
  courseTitle: string;
  /** Amount confirmed as paid, in minor units. */
  paidMinor: number;
  /** List price, so an overpayment never earns more than the price. */
  listMinor?: number | null;
  /** For a checkout that has them; zero when the sale has no taxes or fees. */
  taxesMinor?: number;
  feesMinor?: number;
  currency: string;
  paidAt: Date;
};

/**
 * Idempotent: a repeated payment event (a webhook retry, or staff pressing the button twice) finds the existing
 * commission and returns it. Returns null when the buyer has no referrer or the sale earns nothing.
 */
export async function recordCommissionForPayment(tx: Db, p: PaymentFacts): Promise<{ commissionId: string; created: boolean } | null> {
  const existing = await referralRepository.findBySource(tx, p.sourceType, p.sourceId);
  if (existing) return { commissionId: existing.id, created: false };
  const buyer = await referralRepository.userBasics(tx, p.buyerUserId);
  if (!buyer?.referredByUserId || buyer.referredByUserId === buyer.id) return null;
  const referrer = await referralRepository.userBasics(tx, buyer.referredByUserId);
  if (!referrer || referrer.deletedAt) return null;

  const settings = await getSetting(tx, "referrals");
  const base = commissionBase({ paid: p.paidMinor, taxes: p.taxesMinor, fees: p.feesMinor, listPrice: p.listMinor ?? null });
  const amount = commissionAmount(base, settings.commissionRateBps);
  if (base <= 0 || amount <= 0) return null;

  const availableAt = new Date(p.paidAt.getTime() + settings.holdDays * 86_400_000);
  const created = await referralRepository.createCommissionOnce(tx, {
    referrerId: referrer.id,
    buyerId: buyer.id,
    sourceType: p.sourceType,
    sourceId: p.sourceId,
    courseId: p.courseId,
    courseTitle: p.courseTitle,
    saleAmount: base,
    rateBps: settings.commissionRateBps,
    commissionAmount: amount,
    currency: p.currency,
    status: settings.holdDays === 0 ? "PAYABLE" : "ON_HOLD",
    availableAt,
  });
  const row = await referralRepository.findBySource(tx, p.sourceType, p.sourceId);
  if (!row) return null;
  if (created) {
    await audit(tx, { actor: systemActor(), action: "COMMISSION_CREATED", entityType: "Commission", entityId: row.id, newValue: { referrerId: referrer.id, buyerId: buyer.id, sourceType: p.sourceType, sourceId: p.sourceId, saleAmount: base, rateBps: settings.commissionRateBps, commissionAmount: amount, currency: p.currency } });
    await publishEvent(tx, "COMMISSION_CREATED", { commissionId: row.id, referrerUserId: referrer.id, courseTitle: p.courseTitle, commissionAmount: amount, currency: p.currency, availableAt: availableAt.toISOString() });
  }
  return { commissionId: row.id, created };
}

type ReversibleCommission = NonNullable<Awaited<ReturnType<typeof referralRepository.findCommission>>>;

/** Shared by the refund actions and the manual reverse. */
async function reverseTx(tx: Db, actor: Actor, c: ReversibleCommission, reason: string): Promise<boolean> {
  if (c.status === "REVERSED") return false;
  const afterPayout = c.status === "PAID";
  const openPayout = c.payout && (c.payout.status === "REQUESTED" || c.payout.status === "APPROVED") ? c.payout : null;
  await referralRepository.markReversed(tx, c.id, reason);
  // Part-refunds already took their share off this commission; the full reversal only takes what is left.
  const priorPartial = await referralRepository.partialRefundTotal(tx, c.id);
  if (afterPayout) {
    // Already paid out: the money is gone, so the referrer's balance takes the hit.
    await referralRepository.createAdjustment(tx, { referrerId: c.referrerId, commissionId: c.id, kind: "REFUND_AFTER_PAYOUT", amount: -(c.commissionAmount - priorPartial), currency: c.currency, note: `Refund after payout: ${reason}`, createdById: actor.userId });
  } else if (priorPartial > 0) {
    // The commission is gone entirely, so the earlier part-refund deductions are undone.
    await referralRepository.createAdjustment(tx, { referrerId: c.referrerId, commissionId: c.id, kind: "MANUAL", amount: priorPartial, currency: c.currency, note: "Part-refund deductions undone: the commission was fully reversed", createdById: actor.userId });
  }
  if (openPayout) {
    // Included in a payout nobody has paid yet: take it out of that payout.
    const payout = await referralRepository.findPayout(tx, openPayout.id);
    if (payout) {
      const remaining = payout.amount - c.commissionAmount;
      if (remaining <= 0) await referralRepository.setPayout(tx, payout.id, { status: "REJECTED", rejectReason: "Every included commission was reversed.", decidedAt: new Date(), amount: 0 });
      else await referralRepository.setPayout(tx, payout.id, { amount: remaining });
    }
  }
  await audit(tx, { actor, action: "COMMISSION_REVERSED", entityType: "Commission", entityId: c.id, previousValue: { status: c.status }, newValue: { status: "REVERSED", afterPayout }, reason });
  await publishEvent(tx, "COMMISSION_REVERSED", { commissionId: c.id, referrerUserId: c.referrerId, courseTitle: c.courseTitle, commissionAmount: c.commissionAmount, currency: c.currency, afterPayout });
  return true;
}

/** A refund or chargeback on the source payment. Safe to call when the sale never earned a commission. */
export async function reverseCommissionForSource(tx: Db, actor: Actor, p: { sourceType: CommissionSourceType; sourceId: string; reason: string }): Promise<{ reversed: boolean }> {
  const c = await referralRepository.findBySource(tx, p.sourceType, p.sourceId);
  if (!c) return { reversed: false };
  return { reversed: await reverseTx(tx, actor, c, p.reason) };
}

/**
 * A partial refund takes the same share off the referral commission as it takes off the sale, as a signed adjustment (the
 * referrer's payable balance can dip below zero until the commission is payable, as it can after a refund on a paid one).
 * `refundedTotalMinor` is everything refunded on the sale so far, so repeated part-refunds never take more than their share.
 */
export async function reduceCommissionForPartialRefund(tx: Db, actor: Actor, p: { sourceType: CommissionSourceType; sourceId: string; refundedTotalMinor: number; paidMinor: number; reason: string }): Promise<{ reducedMinor: number }> {
  const c = await referralRepository.findBySource(tx, p.sourceType, p.sourceId);
  if (!c || c.status === "REVERSED") return { reducedMinor: 0 };
  const target = proportionalShare(c.commissionAmount, p.refundedTotalMinor, p.paidMinor);
  const delta = target - (await referralRepository.partialRefundTotal(tx, c.id));
  if (delta <= 0) return { reducedMinor: 0 };
  await referralRepository.createAdjustment(tx, { referrerId: c.referrerId, commissionId: c.id, kind: "REFUND_AFTER_PAYOUT", amount: -delta, currency: c.currency, note: `Partial refund: ${p.reason}`, createdById: actor.userId });
  await audit(tx, { actor, action: "COMMISSION_ADJUSTED", entityType: "Commission", entityId: c.id, newValue: { amount: -delta, partialRefund: true }, reason: p.reason });
  return { reducedMinor: delta };
}

export async function releaseCommissionHolds(db: Db, now = new Date()): Promise<number> {
  return referralRepository.releaseDue(db, now);
}

export const noteSchema = z.string().trim().min(3, "Add a note explaining why.").max(500);

export async function reverseCommissionManually(db: PrismaClient, actor: Actor, commissionId: string, note: string) {
  authorize(actor, "referral.manage");
  const reason = noteSchema.parse(note);
  await db.$transaction(async (tx) => {
    const c = await referralRepository.findCommission(tx, commissionId);
    if (!c) throw new NotFoundError();
    if (c.status === "REVERSED") throw new Error("This commission is already reversed.");
    await reverseTx(tx, actor, c, reason);
  });
}

export const adjustmentSchema = z.object({
  referrerId: z.string().min(1),
  amountMinor: z.coerce.number().int().refine((n) => n !== 0, "Enter a non-zero amount."),
  note: noteSchema,
});

/** A signed manual change to a referrer's balance, with a required note. */
export async function adjustReferrerBalance(db: PrismaClient, actor: Actor, raw: z.input<typeof adjustmentSchema>) {
  authorize(actor, "referral.manage");
  const input = adjustmentSchema.parse(raw);
  const settings = await getSetting(db, "referrals");
  const user = await referralRepository.userBasics(db, input.referrerId);
  if (!user || !referralRepository.isEligibleRole(user.role.key)) throw new NotFoundError();
  return db.$transaction(async (tx) => {
    const a = await referralRepository.createAdjustment(tx, { referrerId: user.id, commissionId: null, kind: "MANUAL", amount: input.amountMinor, currency: settings.payoutCurrency, note: input.note, createdById: actor.userId });
    await audit(tx, { actor, action: "COMMISSION_ADJUSTED", entityType: "User", entityId: user.id, newValue: { adjustmentId: a.id, amount: input.amountMinor, currency: settings.payoutCurrency }, reason: input.note });
    await publishEvent(tx, "COMMISSION_ADJUSTED", { adjustmentId: a.id, referrerUserId: user.id, amount: input.amountMinor, currency: settings.payoutCurrency, note: input.note });
    return { id: a.id };
  });
}

/**
 * What the referrer can do with their money. `payable` is what a payout request would take: payable commissions not
 * already in a payout, plus unsettled adjustments (negative after a refund on a paid commission). It can be negative.
 */
export async function balanceFor(db: Db, userId: string, currency: string) {
  const [sums, unassigned, adjustments, paid] = await Promise.all([
    referralRepository.sumByStatus(db, userId, currency),
    referralRepository.payableUnassigned(db, userId, currency),
    referralRepository.unsettledAdjustments(db, userId, currency),
    referralRepository.paidTotal(db, userId, currency),
  ]);
  const payableCommissions = unassigned.reduce((n, c) => n + c.commissionAmount, 0);
  const adjustmentTotal = adjustments.reduce((n, a) => n + a.amount, 0);
  return { onHold: sums.ON_HOLD, payable: payableCommissions + adjustmentTotal, payableCommissions, adjustments: adjustmentTotal, paid, reversed: sums.REVERSED };
}
