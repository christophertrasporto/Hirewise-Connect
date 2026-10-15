import type { SeatRequestRecord, SeatPurchaseRecord } from "@/server/repositories/seat.repository";

export type SeatTotals = { base: number; additional: number; promo: number; adjustments: number; total: number; used: number; pendingRelease: number; available: number };

export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);
}

export function toPlanView(p: { id: string; key: string; name: string; baseAgentSeats: number | null; priceMinor: number; currency: string; billingPeriod: string; trainingAccess: boolean; opportunityAccess: boolean; features: string[]; isActive: boolean; sortOrder: number }) {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    baseAgentSeats: p.baseAgentSeats,
    priceMinor: p.priceMinor,
    currency: p.currency,
    priceLabel: p.priceMinor === 0 ? "Price to be set" : `${formatMoney(p.priceMinor, p.currency)} / ${p.billingPeriod === "ANNUAL" ? "year" : "month"}`,
    billingPeriod: p.billingPeriod,
    trainingAccess: p.trainingAccess,
    opportunityAccess: p.opportunityAccess,
    features: p.features,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
  };
}
export type PlanView = ReturnType<typeof toPlanView>;

export function toPackageView(p: { id: string; name: string; seatCount: number; priceMinor: number; currency: string; isActive: boolean; sortOrder: number }) {
  return { id: p.id, name: p.name, seatCount: p.seatCount, priceMinor: p.priceMinor, currency: p.currency, priceLabel: p.priceMinor === 0 ? "Price to be set" : formatMoney(p.priceMinor, p.currency), isActive: p.isActive, sortOrder: p.sortOrder };
}
export type PackageView = ReturnType<typeof toPackageView>;

export function toLedgerEntryView(e: { id: string; changeType: string; quantity: number; reason: string | null; effectiveAt: Date; createdAt: Date; relatedMembershipId: string | null; relatedAgentProfileId: string | null; seatPurchaseId: string | null; plan: { name: string } | null }) {
  const capacity = ["PLAN_BASE", "PURCHASE", "PROMO_GRANT", "ADMIN_ADD", "OVERRIDE"].includes(e.changeType) ? e.quantity : e.changeType === "ADMIN_REMOVE" ? -e.quantity : 0;
  const usage = e.changeType === "CONSUMED" ? e.quantity : e.changeType === "RELEASED" ? -e.quantity : 0;
  return { id: e.id, changeType: e.changeType, quantity: e.quantity, capacityDelta: capacity, usageDelta: usage, reason: e.reason, effectiveAt: e.effectiveAt, createdAt: e.createdAt, planName: e.plan?.name ?? null, relatedMembershipId: e.relatedMembershipId, relatedAgentProfileId: e.relatedAgentProfileId, seatPurchaseId: e.seatPurchaseId };
}

export function toSeatRequestView(r: SeatRequestRecord) {
  return { id: r.id, agencyId: r.agencyId, agencyName: r.agency.name, requestedSeats: r.requestedSeats, note: r.note, status: r.status, grantedSeats: r.grantedSeats, decisionNote: r.decisionNote, createdAt: r.createdAt, reviewedAt: r.reviewedAt };
}
export type SeatRequestView = ReturnType<typeof toSeatRequestView>;

export function toSeatPurchaseView(p: SeatPurchaseRecord) {
  return { id: p.id, agencyId: p.agencyId, agencyName: p.agency.name, packageName: p.package.name, seatCount: p.seatCount, amountMinor: p.amountMinor, currency: p.currency, amountLabel: p.amountMinor === 0 ? "Price to be set" : formatMoney(p.amountMinor, p.currency), status: p.status, paymentReference: p.paymentReference, paidAt: p.paidAt, note: p.note, createdAt: p.createdAt };
}
export type SeatPurchaseView = ReturnType<typeof toSeatPurchaseView>;
