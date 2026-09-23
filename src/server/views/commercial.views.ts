import type { Prisma } from "@/server/db/types";
import type { placementInclude } from "@/server/repositories/placement.repository";
import type { invoiceInclude } from "@/server/repositories/billing.repository";

type PlacementRecord = Prisma.PlacementGetPayload<{ include: ReturnType<typeof placementInclude> }>;
type InvoiceRecord = Prisma.InvoiceGetPayload<{ include: ReturnType<typeof invoiceInclude> }>;

export function money(cents: number, currency: string) {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

export function rateLabel(r: { amount: number; currency: string; unit: string }) {
  return `${money(r.amount, r.currency)} / ${r.unit === "HOURLY" ? "hour" : "month"}`;
}

/** Invoice as the paying client sees it (own invoices only, enforced by the service). */
export function toInvoiceClientView(i: InvoiceRecord) {
  const paid = i.payments.reduce((s, p) => s + p.amount, 0);
  return {
    id: i.id,
    number: i.number,
    description: i.description,
    amount: i.amount,
    currency: i.currency,
    amountLabel: money(i.amount, i.currency),
    status: i.status,
    issuedAt: i.issuedAt,
    dueAt: i.dueAt,
    paidAt: i.paidAt,
    paidAmount: paid,
    balance: Math.max(0, i.amount - paid),
    hasPdf: !!i.pdfKey,
    placement: i.placement ? { id: i.placement.id, positionTitle: i.placement.positionTitle, displayName: i.placement.agentProfile.displayName } : null,
    payments: i.payments.map((p) => ({ id: p.id, amount: p.amount, currency: p.currency, method: p.method, reference: p.reference, paidAt: p.paidAt })),
  };
}

export function toInvoiceStaffView(i: InvoiceRecord) {
  return { ...toInvoiceClientView(i), client: i.client, voidReason: i.voidReason, deposit: i.deposit, payments: i.payments.map((p) => ({ id: p.id, amount: p.amount, currency: p.currency, method: p.method, reference: p.reference, paidAt: p.paidAt, recordedBy: p.recordedBy.email })) };
}

function depositView(d: PlacementRecord["deposit"]) {
  if (!d) return null;
  return { id: d.id, requiredAmount: d.requiredAmount, currency: d.currency, amountLabel: money(d.requiredAmount, d.currency), dueDate: d.dueDate, status: d.status, policy: d.policy.name };
}

/**
 * Client placement detail (Section 6): status, schedule, billing-rate snapshot, deposit,
 * own invoices, agreement state. Never compensation, never internal notes.
 */
export function toPlacementClientView(p: PlacementRecord) {
  return {
    id: p.id,
    status: p.status,
    positionTitle: p.positionTitle,
    schedule: p.schedule,
    timezone: p.timezone,
    startDate: p.startDate,
    createdAt: p.createdAt,
    activatedAt: p.activatedAt,
    endedAt: p.endedAt,
    agent: { id: p.agentProfile.id, displayName: p.agentProfile.displayName, primaryRole: p.agentProfile.primaryRole },
    billingRate: p.clientBillingRate ? { amount: p.clientBillingRate.amount, currency: p.clientBillingRate.currency, unit: p.clientBillingRate.unit, label: rateLabel(p.clientBillingRate) } : null,
    deposit: depositView(p.deposit),
    invoices: p.invoices.map((i) => ({ id: i.id, number: i.number, amount: i.amount, currency: i.currency, amountLabel: money(i.amount, i.currency), status: i.status, dueAt: i.dueAt, issuedAt: i.issuedAt })),
    agreement: { acceptedAt: p.agreementAcceptedAt, signedUpload: !!p.signedAgreementKey },
  };
}

/**
 * Agent placement detail: status, schedule, company, own compensation snapshot,
 * and a boolean "client rate published" flag. No billing amounts, deposits, or invoices (INV-C2).
 */
export function toPlacementAgentView(p: PlacementRecord) {
  return {
    id: p.id,
    status: p.status,
    positionTitle: p.positionTitle,
    schedule: p.schedule,
    timezone: p.timezone,
    startDate: p.startDate,
    createdAt: p.createdAt,
    activatedAt: p.activatedAt,
    endedAt: p.endedAt,
    client: { companyName: p.client.companyName, timezone: p.client.timezone },
    compensation: p.agentCompensation ? { amount: p.agentCompensation.amount, currency: p.agentCompensation.currency, unit: p.agentCompensation.unit, label: rateLabel(p.agentCompensation) } : null,
    clientRatePublished: !!p.clientBillingRate,
    checklistProgress: p.checklistItems.length ? { done: p.checklistItems.filter((c) => c.isDone).length, total: p.checklistItems.length } : null,
  };
}

/** Staff placement detail. Compensation only for holders of compensation.read (INV-C1). */
export function toPlacementStaffView(p: PlacementRecord, opts: { canSeeCompensation: boolean; canSeeBillingRate: boolean }) {
  return {
    ...toPlacementClientView(p),
    client: { id: p.client.id, companyName: p.client.companyName, timezone: p.client.timezone },
    agent: { ...toPlacementClientView(p).agent, availabilityStatus: p.agentProfile.availabilityStatus, userId: p.agentProfile.userId },
    accountManager: p.accountManager,
    approvedById: p.approvedById,
    cancelledReason: p.cancelledReason,
    endReason: p.endReason,
    pausedAt: p.pausedAt,
    billingRate: opts.canSeeBillingRate ? toPlacementClientView(p).billingRate : null,
    compensation: opts.canSeeCompensation && p.agentCompensation ? { amount: p.agentCompensation.amount, currency: p.agentCompensation.currency, unit: p.agentCompensation.unit, label: rateLabel(p.agentCompensation) } : null,
    invoices: p.invoices.map((i) => ({ id: i.id, number: i.number, amount: i.amount, currency: i.currency, amountLabel: money(i.amount, i.currency), status: i.status, dueAt: i.dueAt, issuedAt: i.issuedAt, paidAt: i.paidAt })),
    checklist: p.checklistItems.map((c) => ({ id: c.id, order: c.order, label: c.label, isRequired: c.isRequired, isDone: c.isDone, doneAt: c.doneAt })),
    signedAgreementKey: p.signedAgreementKey,
  };
}
