import { z } from "zod";
import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { assertClientOwns } from "@/server/policies/ownership";
import { billingRepository } from "@/server/repositories/billing.repository";
import { placementRepository } from "@/server/repositories/placement.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { getStorage } from "@/server/adapters/storage";
import { renderSimplePdf } from "@/server/adapters/pdf";
import { getPaymentProvider } from "@/server/adapters/payments";
import { getEnv } from "@/server/env";
import { toInvoiceClientView, toInvoiceStaffView, money } from "@/server/views/commercial.views";

/**
 * Deposits, invoices, and payments (Section 4.7, 8.6). Money is integer minor units.
 * Payment recording is manual in Phase 4 (ASSUMPTION A5); the provider adapter is the seam for Stripe.
 */

export const depositPolicySchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(80),
  type: z.enum(["ONE_MONTH", "TWO_WEEKS", "FIXED", "PERCENTAGE", "CUSTOM"]),
  /** FIXED/CUSTOM in USD ("500.00"); PERCENTAGE in percent ("50") */
  value: z.string().trim().regex(/^\d{0,7}(\.\d{1,2})?$/).optional().or(z.literal("")),
  currency: z.string().trim().length(3).optional().or(z.literal("")),
  isDefault: z.coerce.boolean().default(false),
  isActive: z.coerce.boolean().default(true),
});

export const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  amountUsd: z.string().trim().regex(/^\d{1,7}(\.\d{1,2})?$/, "Enter an amount like 1500 or 1500.50"),
  method: z.enum(["BANK_TRANSFER", "CARD", "PAYPAL", "OTHER"]),
  reference: z.string().trim().max(120).optional().or(z.literal("")),
  paidAt: z.string().trim().optional().or(z.literal("")),
});

export async function listDepositPolicies(db: PrismaClient, actor: Actor) {
  authorize(actor, "deposit.read");
  return billingRepository.policies(db, false);
}

export async function saveDepositPolicy(db: PrismaClient, actor: Actor, input: z.infer<typeof depositPolicySchema>) {
  authorize(actor, "deposit.manage");
  authorize(actor, "settings.manage");
  const raw = input.value ? Number(input.value) : 0;
  const value = input.type === "PERCENTAGE" ? Math.round(raw * 100) : Math.round(raw * 100); // percent → basis points; USD → cents
  const row = await billingRepository.upsertPolicy(db, { id: input.id || undefined, name: input.name, type: input.type, value, currency: input.currency ? input.currency.toUpperCase() : null, isDefault: input.isDefault, isActive: input.isActive });
  await audit(db, { actor, action: "DEPOSIT_POLICY_CHANGED", entityType: "DepositPolicy", entityId: row.id, newValue: { name: row.name, type: row.type, value: row.value, isDefault: row.isDefault } });
  return row.id;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/** Renders and stores the invoice PDF; returns the storage key. Failure to render never blocks issuing. */
export async function renderInvoicePdf(inv: { id: string; number: string; description: string; amount: number; currency: string; issuedAt: Date; dueAt: Date; client: { companyName: string }; placement: { positionTitle: string; agentProfile: { displayName: string } } | null }): Promise<string | null> {
  try {
    const key = `invoices/${inv.id}/${inv.number}.pdf`;
    const pdf = renderSimplePdf([
      { text: "Hirewise Virtual Assistance Services", bold: true, size: 16 },
      { text: "Hirewise Connect - Invoice", size: 11 },
      { text: `Invoice ${inv.number}`, bold: true, size: 14, gap: 14 },
      { text: `Issued: ${inv.issuedAt.toISOString().slice(0, 10)}    Due: ${inv.dueAt.toISOString().slice(0, 10)}` },
      { text: `Bill to: ${inv.client.companyName}`, gap: 10 },
      ...(inv.placement ? [{ text: `Placement: ${inv.placement.agentProfile.displayName} - ${inv.placement.positionTitle}` }] : []),
      { text: inv.description, gap: 14 },
      { text: `Amount due: ${money(inv.amount, inv.currency)}`, bold: true, size: 13, gap: 8 },
      { text: getPaymentProvider().paymentInstructions(), gap: 14 },
      { text: "Reference the invoice number with your payment. Thank you.", gap: 6 },
    ]);
    await getStorage().put(key, pdf, "application/pdf");
    return key;
  } catch {
    return null;
  }
}

/** Issue an invoice inside the caller's transaction (used by the placement pipeline). */
export async function issueInvoice(tx: Db, actor: Actor, d: { clientId: string; placementId: string | null; depositId: string | null; description: string; amount: number; currency: string; dueAt: Date }) {
  const number = await billingRepository.nextInvoiceNumber(tx);
  const inv = await billingRepository.createInvoice(tx, { ...d, number });
  await audit(tx, { actor, action: "INVOICE_ISSUED", entityType: "Invoice", entityId: inv.id, newValue: { number, amount: d.amount, currency: d.currency, clientId: d.clientId, placementId: d.placementId } });
  return inv;
}

export async function listInvoicesForClient(db: PrismaClient, actor: Actor) {
  if (actor.role !== "CLIENT" || !actor.clientId) throw new ForbiddenError("Clients only");
  return (await billingRepository.listInvoicesForClient(db, actor.clientId)).map(toInvoiceClientView);
}

/** Direct-URL access: a client asking for another client's invoice gets NotFound (no existence leak). */
export async function getInvoiceForClient(db: PrismaClient, actor: Actor, id: string) {
  const inv = await billingRepository.findInvoice(db, id);
  if (!inv) throw new NotFoundError();
  assertClientOwns(actor, inv, "invoice.manage");
  return { invoice: toInvoiceClientView(inv), paymentInstructions: getPaymentProvider().paymentInstructions() };
}

export async function listInvoicesForStaff(db: PrismaClient, actor: Actor, status?: "DRAFT" | "ISSUED" | "PAID" | "VOID") {
  if (!actor.permissions.has("invoice.manage") && !actor.permissions.has("deposit.read")) throw new ForbiddenError("Invoices require invoice.manage or deposit.read");
  return (await billingRepository.listInvoicesForStaff(db, status)).map(toInvoiceStaffView);
}

export async function getInvoiceForStaff(db: PrismaClient, actor: Actor, id: string) {
  if (!actor.permissions.has("invoice.manage") && !actor.permissions.has("deposit.read")) throw new ForbiddenError("Invoices require invoice.manage or deposit.read");
  const inv = await billingRepository.findInvoice(db, id);
  if (!inv) throw new NotFoundError();
  return toInvoiceStaffView(inv);
}

/** Signed URL for the PDF: the owning client, or staff who may read invoices. */
export async function invoicePdfUrl(db: PrismaClient, actor: Actor, id: string): Promise<string> {
  const inv = await billingRepository.findInvoice(db, id);
  if (!inv) throw new NotFoundError();
  if (actor.role === "CLIENT") assertClientOwns(actor, inv);
  else if (!actor.permissions.has("invoice.manage") && !actor.permissions.has("deposit.read")) throw new ForbiddenError("Invoices require invoice.manage or deposit.read");
  let key = inv.pdfKey;
  if (!key) {
    key = await renderInvoicePdf(inv);
    if (!key) throw new Error("The PDF could not be generated.");
    await billingRepository.updateInvoice(db, inv.id, { pdfKey: key });
  }
  return getStorage().createDownloadUrl(key);
}

export async function voidInvoice(db: PrismaClient, actor: Actor, id: string, reason: string) {
  authorize(actor, "invoice.manage");
  if (!reason.trim()) throw new Error("A reason is required to void an invoice.");
  const inv = await billingRepository.findInvoice(db, id);
  if (!inv) throw new NotFoundError();
  if (inv.status === "PAID") throw new Error("A paid invoice cannot be voided.");
  await db.$transaction(async (tx) => {
    await billingRepository.updateInvoice(tx, inv.id, { status: "VOID", voidReason: reason });
    await audit(tx, { actor, action: "INVOICE_VOIDED", entityType: "Invoice", entityId: inv.id, previousValue: { status: inv.status }, newValue: { status: "VOID" }, reason });
  });
}

// ---------------------------------------------------------------------------
// Payments (manual provider)
// ---------------------------------------------------------------------------

/**
 * Record an offline payment. Updates the invoice, then the deposit, and when the
 * deposit is settled, moves the placement to DEPLOYMENT_PREP (system transition).
 */
export async function recordPayment(db: PrismaClient, actor: Actor, input: z.infer<typeof paymentSchema>) {
  authorize(actor, "payment.record");
  const inv = await billingRepository.findInvoice(db, input.invoiceId);
  if (!inv) throw new NotFoundError();
  if (inv.status === "VOID") throw new Error("This invoice is void.");
  if (inv.status === "PAID") throw new Error("This invoice is already paid.");
  const amount = Math.round(Number(input.amountUsd) * 100);
  if (amount <= 0) throw new Error("Amount must be positive.");
  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) throw new Error("Invalid payment date.");

  return db.$transaction(async (tx) => {
    const payment = await billingRepository.createPayment(tx, { invoiceId: inv.id, amount, currency: inv.currency, method: input.method, reference: input.reference || null, paidAt, recordedById: actor.userId, providerPayload: { provider: getPaymentProvider().name } });
    const paidTotal = await billingRepository.paidTotal(tx, inv.id);
    const invoicePaid = paidTotal >= inv.amount;
    if (invoicePaid) await billingRepository.updateInvoice(tx, inv.id, { status: "PAID", paidAt });
    await audit(tx, { actor, action: "PAYMENT_RECORDED", entityType: "Payment", entityId: payment.id, newValue: { invoiceId: inv.id, number: inv.number, amount, currency: inv.currency, method: input.method, reference: input.reference || null, invoiceStatus: invoicePaid ? "PAID" : "ISSUED" } });

    let depositSettled = false;
    if (inv.depositId) {
      const deposit = await billingRepository.findDeposit(tx, inv.depositId);
      if (deposit && deposit.status !== "WAIVED") {
        const depositPaid = deposit.invoices.filter((i) => i.status !== "VOID").reduce((s, i) => s + i.payments.reduce((a, p) => a + p.amount, 0), 0);
        const status = depositPaid >= deposit.requiredAmount ? "PAID" : depositPaid > 0 ? "PARTIALLY_PAID" : "PENDING";
        await billingRepository.updateDeposit(tx, deposit.id, { status });
        await audit(tx, { actor, action: "DEPOSIT_RECORDED", entityType: "Deposit", entityId: deposit.id, previousValue: { status: deposit.status }, newValue: { status, paid: depositPaid, required: deposit.requiredAmount } });
        if (status === "PAID" && deposit.status !== "PAID") {
          depositSettled = true;
          const { onDepositSettled } = await import("./placement.service");
          await onDepositSettled(tx, actor, deposit.placementId, "PAID");
        }
      }
    }
    return { paymentId: payment.id, invoicePaid, depositSettled };
  });
}

/** INV-C5: waiving needs deposit.override and a reason, and is audited. */
export async function waiveDeposit(db: PrismaClient, actor: Actor, depositId: string, reason: string) {
  authorize(actor, "deposit.override");
  if (!reason.trim()) throw new Error("A reason is required to waive a deposit.");
  const deposit = await billingRepository.findDeposit(db, depositId);
  if (!deposit) throw new NotFoundError();
  if (deposit.status === "PAID" || deposit.status === "WAIVED") throw new Error("This deposit is already settled.");
  await db.$transaction(async (tx) => {
    await billingRepository.updateDeposit(tx, deposit.id, { status: "WAIVED", waivedById: actor.userId, waivedReason: reason, waivedAt: new Date() });
    for (const inv of deposit.invoices) {
      if (inv.status === "ISSUED") {
        await billingRepository.updateInvoice(tx, inv.id, { status: "VOID", voidReason: `Deposit waived: ${reason}` });
        await audit(tx, { actor, action: "INVOICE_VOIDED", entityType: "Invoice", entityId: inv.id, reason: `Deposit waived: ${reason}` });
      }
    }
    await audit(tx, { actor, action: "DEPOSIT_WAIVED", entityType: "Deposit", entityId: deposit.id, previousValue: { status: deposit.status }, newValue: { status: "WAIVED" }, reason });
    const { onDepositSettled } = await import("./placement.service");
    await onDepositSettled(tx, actor, deposit.placementId, "WAIVED");
  });
}

/** Sales may switch the policy while the deposit is still unpaid; re-issues the invoice. */
export async function changeDepositPolicy(db: PrismaClient, actor: Actor, depositId: string, policyId: string, customUsd?: string) {
  authorize(actor, "deposit.manage");
  const deposit = await billingRepository.findDeposit(db, depositId);
  if (!deposit) throw new NotFoundError();
  if (deposit.status !== "PENDING") throw new Error("Only an unpaid deposit can be recalculated.");
  const policy = await billingRepository.findPolicy(db, policyId);
  if (!policy || !policy.isActive) throw new NotFoundError();
  const placement = await placementRepository.findById(db, deposit.placementId);
  if (!placement?.clientBillingRate) throw new Error("The placement has no billing-rate snapshot.");
  const { getSetting } = await import("./setting.service");
  const hours = await getSetting(db, "hoursPerMonthDefault");
  const { computeDeposit } = await import("@/server/state/placement");
  const next = computeDeposit(policy, placement.clientBillingRate, hours, customUsd ? Math.round(Number(customUsd) * 100) : null);
  await db.$transaction(async (tx) => {
    await billingRepository.updateDeposit(tx, deposit.id, { policyId: policy.id, requiredAmount: next.amount, currency: next.currency });
    for (const inv of deposit.invoices) if (inv.status === "ISSUED") await billingRepository.updateInvoice(tx, inv.id, { status: "VOID", voidReason: "Deposit recalculated" });
    const inv = await issueInvoice(tx, actor, { clientId: placement.clientId, placementId: placement.id, depositId: deposit.id, description: `Placement deposit (${policy.name}) for ${placement.agentProfile.displayName} - ${placement.positionTitle}`, amount: next.amount, currency: next.currency, dueAt: deposit.dueDate });
    await audit(tx, { actor, action: "DEPOSIT_RECALCULATED", entityType: "Deposit", entityId: deposit.id, previousValue: { policyId: deposit.policyId, requiredAmount: deposit.requiredAmount }, newValue: { policyId: policy.id, requiredAmount: next.amount, invoiceId: inv.id } });
    await publishEvent(tx, "DEPOSIT_REQUIRED", { placementId: placement.id, clientUserId: placement.client.contacts[0]?.userId ?? null, clientEmail: placement.client.contacts[0]?.businessEmail ?? null, companyName: placement.client.companyName, invoiceNumber: inv.number, amount: next.amount, currency: next.currency, dueAt: deposit.dueDate.toISOString(), displayName: placement.agentProfile.displayName });
  });
}

// ---------------------------------------------------------------------------
// Online payments (Phase 5): hosted checkout through the provider adapter and webhook recording
// ---------------------------------------------------------------------------

/** The owning client starts a hosted checkout for an open invoice. Returns null when the provider has none. */
export async function createCheckout(db: PrismaClient, actor: Actor, invoiceId: string): Promise<{ url: string } | null> {
  const inv = await billingRepository.findInvoice(db, invoiceId);
  if (!inv) throw new NotFoundError();
  assertClientOwns(actor, inv);
  if (inv.status !== "ISSUED") throw new Error("Only open invoices can be paid.");
  const balance = inv.amount - inv.payments.reduce((s, p) => s + p.amount, 0);
  if (balance <= 0) throw new Error("This invoice has no balance.");
  const contact = await db.clientContact.findFirst({ where: { clientId: inv.clientId, userId: actor.userId }, select: { businessEmail: true } });
  const base = getEnv().APP_URL;
  const checkout = await getPaymentProvider().createCheckout({ invoiceId: inv.id, number: inv.number, amount: balance, currency: inv.currency, description: inv.description, clientEmail: contact?.businessEmail ?? null, successUrl: `${base}/billing/invoices/${inv.id}?paid=1`, cancelUrl: `${base}/billing/invoices/${inv.id}` });
  if (!checkout) return null;
  await billingRepository.updateInvoice(db, inv.id, { providerCheckoutId: checkout.sessionId });
  await audit(db, { actor, action: "CHECKOUT_CREATED", entityType: "Invoice", entityId: inv.id, newValue: { provider: getPaymentProvider().name, sessionId: checkout.sessionId, amount: balance } });
  return { url: checkout.url };
}

/**
 * Record a payment reported by the provider (webhook or the local fake route). Idempotent on the
 * provider reference. Runs as the system actor and reuses the same settlement path as manual recording.
 */
export async function recordProviderPayment(db: PrismaClient, p: { invoiceId: string; amount: number; currency: string; reference: string; payload: unknown }) {
  const inv = await billingRepository.findInvoice(db, p.invoiceId);
  if (!inv) throw new NotFoundError();
  if (inv.payments.some((x) => x.reference === p.reference)) return { duplicate: true as const };
  if (inv.status !== "ISSUED") return { duplicate: false as const, ignored: inv.status };
  if (p.currency.toUpperCase() !== inv.currency) throw new Error(`Currency mismatch: ${p.currency} vs ${inv.currency}`);
  const system: Actor = { userId: "system", role: "SUPER_ADMIN", permissions: new Set(["payment.record"]) };
  const paidAt = new Date();
  const result = await db.$transaction(async (tx) => {
    const payment = await billingRepository.createPayment(tx, { invoiceId: inv.id, amount: p.amount, currency: inv.currency, method: "CARD", reference: p.reference, paidAt, recordedById: inv.payments[0]?.recordedById ?? (await tx.user.findFirstOrThrow({ where: { role: { key: "SUPER_ADMIN" } }, select: { id: true } })).id, providerPayload: JSON.parse(JSON.stringify({ provider: getPaymentProvider().name, payload: p.payload })) });
    const paidTotal = await billingRepository.paidTotal(tx, inv.id);
    const invoicePaid = paidTotal >= inv.amount;
    if (invoicePaid) await billingRepository.updateInvoice(tx, inv.id, { status: "PAID", paidAt });
    await audit(tx, { actor: system, action: "PAYMENT_RECORDED", entityType: "Payment", entityId: payment.id, newValue: { invoiceId: inv.id, number: inv.number, amount: p.amount, currency: inv.currency, method: "CARD", reference: p.reference, provider: getPaymentProvider().name } });
    let depositSettled = false;
    if (inv.depositId) {
      const deposit = await billingRepository.findDeposit(tx, inv.depositId);
      if (deposit && deposit.status !== "WAIVED") {
        const depositPaid = deposit.invoices.filter((i) => i.status !== "VOID").reduce((s, i) => s + i.payments.reduce((a, x) => a + x.amount, 0), 0);
        const status = depositPaid >= deposit.requiredAmount ? "PAID" : depositPaid > 0 ? "PARTIALLY_PAID" : "PENDING";
        await billingRepository.updateDeposit(tx, deposit.id, { status });
        await audit(tx, { actor: system, action: "DEPOSIT_RECORDED", entityType: "Deposit", entityId: deposit.id, previousValue: { status: deposit.status }, newValue: { status, paid: depositPaid, required: deposit.requiredAmount } });
        if (status === "PAID" && deposit.status !== "PAID") {
          depositSettled = true;
          const { onDepositSettled } = await import("./placement.service");
          await onDepositSettled(tx, system, deposit.placementId, "PAID");
        }
      }
    }
    const contact = await tx.clientContact.findFirst({ where: { clientId: inv.clientId, isPrimary: true }, select: { userId: true } });
    const client = await tx.client.findUnique({ where: { id: inv.clientId }, select: { companyName: true, accountManagerUserId: true } });
    await publishEvent(tx, "ONLINE_PAYMENT_RECEIVED", { invoiceId: inv.id, number: inv.number, amount: p.amount, currency: inv.currency, clientUserId: contact?.userId ?? null, companyName: client?.companyName ?? "Client", salesUserId: client?.accountManagerUserId ?? null });
    return { duplicate: false as const, paymentId: payment.id, invoicePaid, depositSettled };
  });
  return result;
}
