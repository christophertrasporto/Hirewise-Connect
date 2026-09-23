import type { BillingRateStatus, RateUnit } from "@prisma/client";
import type { Db } from "@/server/db/types";

/**
 * ClientBillingRate and AgentCompensation live in separate repositories functions and are
 * never joined here (INV-C1). Reports that need both check both permissions first.
 */
export const rateRepository = {
  // --- Client billing rates ---
  createBillingRate(db: Db, d: { agentProfileId: string; amount: number; currency: string; unit: RateUnit; proposedById: string; effectiveFrom: Date; positioningNotes: string | null; status: BillingRateStatus }) {
    return db.clientBillingRate.create({ data: { ...d, positioningNotes: d.positioningNotes ?? undefined } });
  },

  findBillingRate(db: Db, id: string) {
    return db.clientBillingRate.findUnique({ where: { id }, include: { proposedBy: { select: { email: true } }, approvedBy: { select: { email: true } }, agentProfile: { select: { id: true, displayName: true, userId: true, status: true } } } });
  },

  publishedForAgent(db: Db, agentProfileId: string) {
    return db.clientBillingRate.findFirst({ where: { agentProfileId, status: "PUBLISHED" }, orderBy: { effectiveFrom: "desc" } });
  },

  listForAgent(db: Db, agentProfileId: string) {
    return db.clientBillingRate.findMany({ where: { agentProfileId }, include: { proposedBy: { select: { email: true } }, approvedBy: { select: { email: true } } }, orderBy: { createdAt: "desc" } });
  },

  listPending(db: Db, take = 100) {
    return db.clientBillingRate.findMany({ where: { status: "PENDING_APPROVAL" }, include: { proposedBy: { select: { email: true } }, agentProfile: { select: { id: true, displayName: true, primaryRole: true } } }, orderBy: { createdAt: "asc" }, take });
  },

  setBillingRateStatus(db: Db, id: string, status: BillingRateStatus, extra: { approvedById?: string; effectiveTo?: Date; decisionReason?: string } = {}) {
    return db.clientBillingRate.update({ where: { id }, data: { status, ...extra } });
  },

  // --- Agent compensation ---
  createCompensation(db: Db, d: { agentProfileId: string; amount: number; currency: string; unit: RateUnit; setById: string; effectiveFrom: Date; notes: string | null }) {
    return db.agentCompensation.create({ data: { ...d, notes: d.notes ?? undefined } });
  },

  currentCompensation(db: Db, agentProfileId: string) {
    return db.agentCompensation.findFirst({ where: { agentProfileId, effectiveTo: null }, orderBy: { effectiveFrom: "desc" } });
  },

  endCompensation(db: Db, id: string, at: Date) {
    return db.agentCompensation.update({ where: { id }, data: { effectiveTo: at } });
  },

  listCompensation(db: Db, agentProfileId: string) {
    return db.agentCompensation.findMany({ where: { agentProfileId }, include: { setBy: { select: { email: true } } }, orderBy: { effectiveFrom: "desc" } });
  },

  // --- History (INV-C4) ---
  addHistory(db: Db, d: { subjectType: "CLIENT_BILLING_RATE" | "AGENT_COMPENSATION"; subjectId: string; agentProfileId: string; previousAmount: number | null; newAmount: number; currency: string; unit: RateUnit; previousStatus: string | null; newStatus: string | null; changedById: string; reason: string | null }) {
    return db.rateHistory.create({ data: { ...d, previousAmount: d.previousAmount ?? undefined, previousStatus: d.previousStatus ?? undefined, newStatus: d.newStatus ?? undefined, reason: d.reason ?? undefined } });
  },

  history(db: Db, subjectType: "CLIENT_BILLING_RATE" | "AGENT_COMPENSATION", agentProfileId: string) {
    return db.rateHistory.findMany({ where: { subjectType, agentProfileId }, include: { changedBy: { select: { email: true } } }, orderBy: { changedAt: "desc" } });
  },
};
