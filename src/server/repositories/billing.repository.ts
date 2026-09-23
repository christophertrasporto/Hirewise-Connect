import type { DepositStatus, InvoiceStatus, PaymentMethod, Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";

export function invoiceInclude() {
  return {
    payments: { include: { recordedBy: { select: { email: true } } }, orderBy: { paidAt: "asc" } },
    client: { select: { id: true, companyName: true } },
    placement: { select: { id: true, positionTitle: true, agentProfile: { select: { displayName: true } } } },
    deposit: { select: { id: true, status: true } },
  } satisfies Prisma.InvoiceInclude;
}

export const billingRepository = {
  // --- Deposit policies ---
  policies(db: Db, activeOnly = true) {
    return db.depositPolicy.findMany({ where: activeOnly ? { isActive: true } : {}, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  },

  defaultPolicy(db: Db) {
    return db.depositPolicy.findFirst({ where: { isDefault: true, isActive: true } });
  },

  findPolicy(db: Db, id: string) {
    return db.depositPolicy.findUnique({ where: { id } });
  },

  async upsertPolicy(db: Db, d: { id?: string; name: string; type: "ONE_MONTH" | "TWO_WEEKS" | "FIXED" | "PERCENTAGE" | "CUSTOM"; value: number; currency: string | null; isDefault: boolean; isActive: boolean }) {
    if (d.isDefault) await db.depositPolicy.updateMany({ where: { isDefault: true, ...(d.id ? { id: { not: d.id } } : {}) }, data: { isDefault: false } });
    const data = { name: d.name, type: d.type, value: d.value, currency: d.currency ?? undefined, isDefault: d.isDefault, isActive: d.isActive };
    return d.id ? db.depositPolicy.update({ where: { id: d.id }, data }) : db.depositPolicy.create({ data });
  },

  // --- Deposits ---
  createDeposit(db: Db, d: { placementId: string; policyId: string; requiredAmount: number; currency: string; dueDate: Date; approvedById: string }) {
    return db.deposit.create({ data: d });
  },

  findDeposit(db: Db, id: string) {
    return db.deposit.findUnique({ where: { id }, include: { policy: true, invoices: { include: invoiceInclude() }, placement: { select: { id: true, clientId: true, status: true, agentProfileId: true } } } });
  },

  depositForPlacement(db: Db, placementId: string) {
    return db.deposit.findUnique({ where: { placementId }, include: { policy: true, invoices: { include: invoiceInclude() } } });
  },

  updateDeposit(db: Db, id: string, data: { status?: DepositStatus; requiredAmount?: number; currency?: string; policyId?: string; dueDate?: Date; waivedById?: string; waivedReason?: string; waivedAt?: Date }) {
    return db.deposit.update({ where: { id }, data });
  },

  // --- Invoices ---
  async nextInvoiceNumber(db: Db): Promise<string> {
    const year = new Date().getUTCFullYear();
    const count = await db.invoice.count({ where: { number: { startsWith: `HW-${year}-` } } });
    return `HW-${year}-${String(count + 1).padStart(5, "0")}`;
  },

  createInvoice(db: Db, d: { clientId: string; placementId: string | null; depositId: string | null; number: string; description: string; amount: number; currency: string; dueAt: Date; pdfKey?: string | null }) {
    return db.invoice.create({ data: { ...d, placementId: d.placementId ?? undefined, depositId: d.depositId ?? undefined, pdfKey: d.pdfKey ?? undefined, status: "ISSUED" }, include: invoiceInclude() });
  },

  findInvoice(db: Db, id: string) {
    return db.invoice.findUnique({ where: { id }, include: invoiceInclude() });
  },

  listInvoicesForClient(db: Db, clientId: string) {
    return db.invoice.findMany({ where: { clientId }, include: invoiceInclude(), orderBy: { issuedAt: "desc" } });
  },

  listInvoicesForStaff(db: Db, status?: InvoiceStatus, take = 200) {
    return db.invoice.findMany({ where: status ? { status } : {}, include: invoiceInclude(), orderBy: { issuedAt: "desc" }, take });
  },

  updateInvoice(db: Db, id: string, data: { status?: InvoiceStatus; paidAt?: Date | null; voidReason?: string; pdfKey?: string; providerCheckoutId?: string }) {
    return db.invoice.update({ where: { id }, data });
  },

  paidTotal(db: Db, invoiceId: string) {
    return db.payment.aggregate({ where: { invoiceId }, _sum: { amount: true } }).then((r) => r._sum.amount ?? 0);
  },

  paidBetween(db: Db, from: Date, to: Date) {
    return db.payment.findMany({ where: { paidAt: { gte: from, lte: to } }, include: { invoice: { select: { number: true, clientId: true, client: { select: { companyName: true } }, placementId: true, depositId: true } } }, orderBy: { paidAt: "asc" } });
  },

  // --- Payments ---
  createPayment(db: Db, d: { invoiceId: string; amount: number; currency: string; method: PaymentMethod; reference: string | null; paidAt: Date; recordedById: string; providerPayload?: Prisma.InputJsonValue }) {
    return db.payment.create({ data: { ...d, reference: d.reference ?? undefined, providerPayload: d.providerPayload ?? undefined } });
  },

  // --- Deployment checklist ---
  createChecklist(db: Db, placementId: string, items: ReadonlyArray<{ label: string; isRequired: boolean }>) {
    return db.deploymentChecklistItem.createMany({ data: items.map((it, i) => ({ placementId, order: i + 1, label: it.label, isRequired: it.isRequired })) });
  },

  checklist(db: Db, placementId: string) {
    return db.deploymentChecklistItem.findMany({ where: { placementId }, orderBy: { order: "asc" } });
  },

  findChecklistItem(db: Db, id: string) {
    return db.deploymentChecklistItem.findUnique({ where: { id }, include: { placement: { select: { id: true, clientId: true, status: true } } } });
  },

  setChecklistItem(db: Db, id: string, done: boolean, byId: string) {
    return db.deploymentChecklistItem.update({ where: { id }, data: { isDone: done, doneById: done ? byId : null, doneAt: done ? new Date() : null } });
  },
};
