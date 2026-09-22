import type { PlacementStatus } from "@prisma/client";
import type { Db } from "@/server/db/types";

export function placementInclude() {
  return {
    client: { select: { id: true, companyName: true, timezone: true } },
    agentProfile: { select: { id: true, displayName: true, primaryRole: true, availabilityStatus: true, userId: true } },
    accountManager: { select: { id: true, email: true } },
  } as const;
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

  setStatus(db: Db, id: string, status: PlacementStatus, extra: Partial<{ approvedById: string; activatedAt: Date; endedAt: Date; endReason: string; cancelledReason: string; startDate: Date }> = {}) {
    return db.placement.update({ where: { id }, data: { status, ...extra } });
  },

  countByStatus(db: Db) {
    return db.placement.groupBy({ by: ["status"], _count: { _all: true } });
  },
};
