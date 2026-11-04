import type { Db, PrismaClient } from "@/server/db/types";
import { systemActor } from "@/server/auth/actor";
import { academyRepository } from "@/server/repositories/academy.repository";
import { onlinePaymentRepository, type OnlinePaymentRecord } from "@/server/repositories/online-payment.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { settleEnrollmentPaymentTx } from "./academy.service";

/**
 * The half of online payments every provider shares. A provider service looks the payment up at its own gateway and, when
 * the gateway says it is paid, hands the facts here. This decides whether to believe them (amount, currency, and reference
 * must be exactly what we asked for) and settles the enrolment once, through the same settlement staff use for offline
 * payments, so access, audit, referral commissions, and the coach wallet behave identically for Maya, PayPal, and staff.
 */

export type ReconcileResult = { status: "NOT_FOUND" | "PAID" | "PENDING" | "FAILED" | "EXPIRED" | "CANCELLED" | "MISMATCH" | "PROBLEM" };

export type OnlineProvider = "MAYA" | "PAYPAL";
export const PROVIDER_LABEL: Record<OnlineProvider, string> = { MAYA: "Maya", PAYPAL: "PayPal" };

/** Statuses a payment attempt may still move to PAID or MISMATCH from. */
export const NOT_YET_FINAL = ["CREATED", "PENDING"] as const;
const SETTLEABLE_FROM = [...NOT_YET_FINAL, "FAILED", "EXPIRED", "CANCELLED"] as const;

/** What a gateway says about a payment it reports as paid. */
export type ConfirmedPayment = {
  providerPaymentId: string;
  amountMinor: number | null;
  currency: string | null;
  /** Our reference number as the gateway echoes it; null when it does not. */
  reference: string | null;
  /** The gateway's own fee, when it reports one. A null fee leaves the coach's earning waiting for the real fee. */
  feeMinor: number | null;
};

export async function flagProblem(db: Db, row: { id: string; enrollment: { id: string; course: { title: string }; agentProfile: { user: { email: string } } } }, reason: string) {
  await audit(db, { actor: systemActor(), action: "ONLINE_PAYMENT_PROBLEM", entityType: "OnlinePayment", entityId: row.id, newValue: { enrollmentId: row.enrollment.id }, reason });
  await publishEvent(db, "ONLINE_PAYMENT_PROBLEM", { onlinePaymentId: row.id, enrollmentId: row.enrollment.id, courseTitle: row.enrollment.course.title, learnerEmail: row.enrollment.agentProfile.user.email, reason });
}

/**
 * The gateway says this attempt was paid. Trust it only if it is the amount, currency, and reference we asked for, then
 * settle the enrolment exactly once. Safe to call any number of times: a payment already settled is left alone.
 */
export async function settleConfirmedPayment(db: PrismaClient, row: OnlinePaymentRecord, provider: OnlineProvider, paid: ConfirmedPayment): Promise<ReconcileResult> {
  const label = PROVIDER_LABEL[provider];
  const matches = paid.amountMinor === row.amountMinor && paid.currency === row.currency && (paid.reference ?? row.id) === row.id && row.amountMinor === row.enrollment.priceCents && row.currency === row.enrollment.currency;
  if (!matches) {
    const changed = await onlinePaymentRepository.transition(db, row.id, [...SETTLEABLE_FROM], { status: "MISMATCH", providerPaymentId: paid.providerPaymentId, failureReason: `${label} reported ${paid.amountMinor} ${paid.currency}, expected ${row.amountMinor} ${row.currency}` });
    if (changed === 1) await flagProblem(db, row, `${label} reported a payment of ${paid.amountMinor ?? "?"} ${paid.currency ?? "?"} for ${row.amountMinor} ${row.currency}. Check it in ${label} and handle it manually.`);
    return { status: "MISMATCH" };
  }

  let problem: string | null = null;
  const settled = await db.$transaction(async (tx) => {
    const claimed = await onlinePaymentRepository.transition(tx, row.id, [...SETTLEABLE_FROM], { status: "PAID", providerPaymentId: paid.providerPaymentId, paidAt: new Date(), failureReason: null });
    if (claimed !== 1) return false;
    const e = await academyRepository.findEnrollmentById(tx, row.enrollmentId);
    if (!e) return true;
    if (e.paymentStatus !== "PENDING") {
      // The money arrived but the enrolment was already settled another way (staff recorded a bank transfer, or it was refunded).
      problem = `Paid online (${paid.providerPaymentId}) but the enrolment is already ${e.paymentStatus.toLowerCase()}. Refund the ${label} payment if it is a duplicate.`;
      return true;
    }
    await settleEnrollmentPaymentTx(tx, systemActor(), e, { paidCents: row.amountMinor, reference: `${provider}:${paid.providerPaymentId}`, waived: false, recordedById: null, channel: provider, gatewayFeeMinor: paid.feeMinor });
    await audit(tx, { actor: systemActor(), action: "ONLINE_PAYMENT_CONFIRMED", entityType: "OnlinePayment", entityId: row.id, newValue: { provider, providerPaymentId: paid.providerPaymentId, amountMinor: row.amountMinor, currency: row.currency, enrollmentId: row.enrollmentId } });
    return true;
  });
  if (settled && problem) await flagProblem(db, row, problem);
  return { status: settled && problem ? "PROBLEM" : "PAID" };
}
