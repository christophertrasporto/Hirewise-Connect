import type { PlacementStatus, Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";

export function placementInclude() {
  return {
    client: { select: { id: true, companyName: true, timezone: true, accountManagerUserId: true, contacts: { where: { isPrimary: true }, select: { userId: true, businessEmail: true, name: true }, take: 1 } } },
    agentProfile: { select: { id: true, displayName: true, primaryRole: true, availabilityStatus: true, userId: true, user: { select: { email: true } } } },
    accountManager: { select: { id: true, email: true } },
    // Snapshots (Section 4.6). The compensation snapshot is filtered out of every projection
    // except for holders of compensation.read (INV-C1).
    clientBillingRate: { select: { id: true, amount: true, currency: true, unit: true, status: true } },
    agentCompensation: { select: { id: true, amount: true, currency: true, unit: true } },
    deposit: { include: { policy: { select: { id: true, name: true, type: true } } } },
    invoices: { orderBy: { issuedAt: "desc" }, select: { id: true, number: true, amount: true, currency: true, status: true, dueAt: true, issuedAt: true, paidAt: true } },
    checklistItems: { orderBy: { order: "asc" } },
  } satisfies Prisma.PlacementInclude;
}

export const placementRepository = {
  create(db: Db, d: { clientId: string; agentProfileId: string; requirementId: string | null; interviewRequestId: string | null; interviewId: string | null; positionTitle: string; schedule: string | null; timezone: string | null; startDate: Date | null; accountManagerUserId: string | null }) {
    return db.placement.create({
      data: {
        clientId: d.clientId,
        agentProfileId: d.agentProfileId,
        requirementId: d.requirementId ?? undefined,
        interviewRequestId: d.interviewRequestId ?? undefined,
        interviewId: d.interviewId ?? undefined,
        positionTitle: d.positionTitle,
        schedule: d.schedule ?? undefined,
        timezone: d.timezone ?? undefined,
        startDate: d.startDate ?? undefined,
        accountManagerUserId: d.accountManagerUserId ?? undefined,
        status: "SELECTED",
      },
      include: placementInclude(),
    });
  },

  findById(db: Db, id: string) {
    return db.placement.findUnique({ where: { id }, include: placementInclude() });
  },

  findOpenForPair(db: Db, clientId: string, agentProfileId: string) {
    return db.placement.findFirst({ where: { clientId, agentProfileId, status: { notIn: ["COMPLETED", "CANCELLED"] } } });
  },

  listForClient(db: Db, clientId: string) {
    return db.placement.findMany({ where: { clientId }, include: placementInclude(), orderBy: { createdAt: "desc" } });
  },

  listForAgent(db: Db, agentProfileId: string) {
    return db.placement.findMany({ where: { agentProfileId }, include: placementInclude(), orderBy: { createdAt: "desc" } });
  },

  listForStaff(db: Db, status?: PlacementStatus, take = 100) {
    return db.placement.findMany({ where: status ? { status } : {}, include: placementInclude(), orderBy: { createdAt: "desc" }, take });
  },

  listByStatuses(db: Db, statuses: PlacementStatus[]) {
    return db.placement.findMany({ where: { status: { in: statuses } }, include: placementInclude(), orderBy: { activatedAt: "desc" } });
  },

  setStatus(db: Db, id: string, status: PlacementStatus, extra: Partial<{ approvedById: string; activatedAt: Date; endedAt: Date; endReason: string; cancelledReason: string; startDate: Date; pausedAt: Date | null; clientBillingRateId: string; agentCompensationId: string | null; agreementAcceptedAt: Date; signedAgreementKey: string }> = {}) {
    return db.placement.update({ where: { id }, data: { status, ...extra } });
  },

  update(db: Db, id: string, data: Partial<{ startDate: Date | null; schedule: string | null; timezone: string | null; agreementAcceptedAt: Date; signedAgreementKey: string }>) {
    return db.placement.update({ where: { id }, data });
  },

  countByStatus(db: Db) {
    return db.placement.groupBy({ by: ["status"], _count: { _all: true } });
  },

  countCreatedBetween(db: Db, from: Date, to: Date) {
    return db.placement.count({ where: { createdAt: { gte: from, lte: to } } });
  },
};
