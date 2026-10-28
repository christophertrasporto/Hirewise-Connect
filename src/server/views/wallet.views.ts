import type { CoachEarningRecord, WithdrawalRecord } from "@/server/repositories/wallet.repository";
import { formatMoney } from "./seat.views";

/**
 * Allow-list projections for the Coach Wallet. What a coach sees of a sale: when, the buyer's first name and last
 * initial (and the email only if staff switch that on), the course, the money breakdown, the status, and when it
 * becomes available. Never the affiliate commission, the buyer's phone, or anything about who referred them.
 */

const m = (minor: number | null, currency: string) => (minor === null ? null : formatMoney(minor, currency));

export const COACH_SALE_FIELDS = ["id", "paidAt", "buyer", "buyerEmail", "courseId", "courseTitle", "currency", "saleAmount", "gatewayFee", "netAmount", "coachRatePercent", "coachAmount", "platformAmount", "status", "availableAt", "refundedSaleMinor", "labels"] as const;

export function toCoachSaleView(e: CoachEarningRecord, opts: { buyerEmail: string | null }) {
  return {
    id: e.id,
    paidAt: e.paidAt,
    buyer: e.buyerLabel,
    buyerEmail: opts.buyerEmail,
    courseId: e.courseId,
    courseTitle: e.courseTitle,
    currency: e.currency,
    saleAmount: e.saleAmount,
    gatewayFee: e.gatewayFee,
    netAmount: e.netAmount,
    coachRatePercent: e.coachRateBps / 100,
    coachAmount: e.coachAmount === null ? null : e.coachAmount - e.coachReversedMinor,
    platformAmount: e.platformAmount,
    status: e.status,
    availableAt: e.availableAt,
    refundedSaleMinor: e.refundedSaleMinor,
    labels: { sale: m(e.saleAmount, e.currency)!, fee: m(e.gatewayFee, e.currency), net: m(e.netAmount, e.currency), coach: m(e.coachAmount === null ? null : e.coachAmount - e.coachReversedMinor, e.currency), platform: m(e.platformAmount, e.currency) },
  };
}
export type CoachSaleView = ReturnType<typeof toCoachSaleView>;

export function toWithdrawalView(w: WithdrawalRecord, opts: { includeCoach?: boolean } = {}) {
  return {
    id: w.id,
    amount: w.amount,
    currency: w.currency,
    label: formatMoney(w.amount, w.currency),
    method: w.method,
    account: w.accountLabel,
    status: w.status,
    reference: w.reference,
    rejectionReason: w.rejectionReason,
    requestedAt: w.requestedAt,
    paidAt: w.paidAt,
    ...(opts.includeCoach ? { coachUserId: w.coachUserId, coachEmail: w.coach.email } : {}),
  };
}
export type WithdrawalView = ReturnType<typeof toWithdrawalView>;
