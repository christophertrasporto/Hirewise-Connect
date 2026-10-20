import type { Prisma, BypassReportStatus, RoleKey } from "@prisma/client";
import type { Db } from "@/server/db/types";

/** v2 phase 6a: bypass report cases. */

export const bypassInclude = {
  reporter: { select: { id: true, email: true } },
  reportedUser: { select: { id: true, email: true, status: true, role: { select: { key: true } }, agentProfiles: { where: { archivedAt: null }, select: { id: true, displayName: true, status: true }, take: 1 }, clientContact: { select: { clientId: true, name: true } } } },
  reportedAgency: { select: { id: true, name: true, status: true, ownerUserId: true } },
  reportedClient: { select: { id: true, companyName: true, status: true } },
  assignedTo: { select: { id: true, email: true } },
  events: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.BypassReportInclude;
export type BypassReportRecord = Prisma.BypassReportGetPayload<{ include: typeof bypassInclude }>;

export const bypassRepository = {
  create(db: Db, d: { reporterUserId: string; reporterRole: RoleKey; reportedUserId: string | null; reportedAgencyId: string | null; reportedClientId: string | null; relatedType: string | null; relatedId: string | null; description: string }) {
    return db.bypassReport.create({ data: { ...d, events: { create: { fromStatus: null, toStatus: "REPORTED", byUserId: d.reporterUserId, note: null } } }, include: bypassInclude });
  },

  findById(db: Db, id: string) {
    return db.bypassReport.findUnique({ where: { id }, include: bypassInclude });
  },

  list(db: Db, f: { status?: BypassReportStatus; open?: boolean } = {}, take = 200) {
    return db.bypassReport.findMany({ where: f.status ? { status: f.status } : f.open ? { status: { notIn: ["CLOSED"] } } : {}, include: bypassInclude, orderBy: { createdAt: "desc" }, take });
  },

  listByReporter(db: Db, reporterUserId: string, take = 50) {
    return db.bypassReport.findMany({ where: { reporterUserId }, include: bypassInclude, orderBy: { createdAt: "desc" }, take });
  },

  transition(db: Db, id: string, d: { from: BypassReportStatus; to: BypassReportStatus; byUserId: string; note: string | null; decisionNotes?: string | null; restrictionEndsAt?: Date | null; assignedToUserId?: string | null }) {
    return db.bypassReport.update({
      where: { id },
      data: {
        status: d.to,
        ...(d.decisionNotes !== undefined ? { decisionNotes: d.decisionNotes } : {}),
        ...(d.restrictionEndsAt !== undefined ? { restrictionEndsAt: d.restrictionEndsAt } : {}),
        ...(d.assignedToUserId !== undefined ? { assignedToUserId: d.assignedToUserId } : {}),
        ...(["WARNING_ISSUED", "RESTRICTED", "SUSPENDED", "CLOSED"].includes(d.to) ? { decidedById: d.byUserId, decidedAt: new Date() } : {}),
        events: { create: { fromStatus: d.from, toStatus: d.to, byUserId: d.byUserId, note: d.note } },
      },
      include: bypassInclude,
    });
  },

  addEvidence(db: Db, id: string, documentId: string) {
    return db.bypassReport.update({ where: { id }, data: { evidenceDocumentIds: { push: documentId } }, select: { id: true } });
  },

  countOpen(db: Db) {
    return db.bypassReport.count({ where: { status: { notIn: ["CLOSED"] } } });
  },
};
