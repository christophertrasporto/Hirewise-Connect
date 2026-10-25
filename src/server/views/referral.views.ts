import { firstNameLastInitial, rateLabel } from "@/lib/referral";

/** Referral projections. Members never see a buyer's full name, email, or id. */

type CommissionRow = { id: string; courseTitle: string; saleAmount: number; rateBps: number; commissionAmount: number; currency: string; status: string; availableAt: Date; createdAt: Date; paidAt: Date | null };

export function toCommissionMemberView(c: CommissionRow, buyerName: string | null) {
  return {
    id: c.id,
    buyer: buyerName ? firstNameLastInitial(buyerName) : "Partner agency",
    course: c.courseTitle,
    price: c.saleAmount,
    rateBps: c.rateBps,
    rateLabel: rateLabel(c.rateBps),
    commission: c.commissionAmount,
    currency: c.currency,
    status: c.status,
    availableAt: c.availableAt,
    date: c.createdAt,
  };
}
export type CommissionMemberView = ReturnType<typeof toCommissionMemberView>;

export function toPayoutMemberView(p: { id: string; amount: number; currency: string; method: string; accountLabel: string; status: string; reference: string | null; rejectReason: string | null; requestedAt: Date; paidAt: Date | null }) {
  return { id: p.id, amount: p.amount, currency: p.currency, method: p.method, accountLabel: p.accountLabel, status: p.status, reference: p.status === "PAID" ? p.reference : null, rejectReason: p.rejectReason, requestedAt: p.requestedAt, paidAt: p.paidAt };
}
export type PayoutMemberView = ReturnType<typeof toPayoutMemberView>;

/** Payout details as the member sees them back: the account number is masked, never returned in full. */
export function toPayoutDetailsView(d: { method: string; accountName: string; bankName: string | null; updatedAt: Date } | null, maskedAccount: string | null) {
  return d ? { method: d.method, accountName: d.accountName, bankName: d.bankName, accountMasked: maskedAccount, updatedAt: d.updatedAt } : null;
}
export type PayoutDetailsView = ReturnType<typeof toPayoutDetailsView>;

export function maskAccount(number: string): string {
  const d = number.replace(/\s/g, "");
  return d.length <= 4 ? "****" : `${"*".repeat(Math.max(4, d.length - 4))}${d.slice(-4)}`;
}
