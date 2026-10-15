import type { AgencyApplicationStatus, AgencyStatus, AgencyUserRole, Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";

export type ApplicationWrite = {
  applicantFullName: string;
  applicantEmail: string;
  applicantPhone: string | null;
  proposedAgencyName: string;
  proposedLogoKey: string | null;
  businessRegistration: string | null;
  country: string;
  city: string | null;
  website: string | null;
  socialLinks: string[];
  teamSize: number;
  yearsExperience: number;
  services: string[];
  description: string;
  preferredPlanKey: string | null;
};

export const applicationInclude = {
  applicant: { select: { id: true, email: true, role: { select: { key: true } }, agentProfiles: { where: { archivedAt: null }, take: 1, select: { id: true, platformIdentityId: true } } } },
  reviewer: { select: { id: true, email: true } },
  history: { orderBy: { changedAt: "asc" }, include: { changedBy: { select: { id: true, email: true } } } },
} satisfies Prisma.AgencyApplicationInclude;

export const agencyInclude = {
  owner: { select: { id: true, email: true } },
  users: { include: { user: { select: { id: true, email: true, role: { select: { key: true } } } } }, orderBy: { createdAt: "asc" } },
  application: { select: { id: true, submittedAt: true, reviewedAt: true } },
  _count: { select: { primaryAgents: true, memberships: true } },
} satisfies Prisma.AgencyInclude;

export const agencyRepository = {
  // ---- applications
  createApplication(db: Db, applicantUserId: string, d: ApplicationWrite) {
    return db.agencyApplication.create({ data: { applicantUserId, ...d }, include: applicationInclude });
  },

  updateApplication(db: Db, id: string, d: Partial<ApplicationWrite> & { status?: AgencyApplicationStatus; reviewerId?: string | null; reviewNotes?: string | null; applicantVisibleMessage?: string | null; rejectionReason?: string | null; reapplyAfter?: Date | null; reviewedAt?: Date | null; resubmittedAt?: Date | null; createdAgencyId?: string | null; agreementAcceptanceId?: string | null }) {
    return db.agencyApplication.update({ where: { id }, data: d, include: applicationInclude });
  },

  findApplication(db: Db, id: string) {
    return db.agencyApplication.findUnique({ where: { id }, include: applicationInclude });
  },

  /** The applicant's most recent application of any status. */
  latestForUser(db: Db, userId: string) {
    return db.agencyApplication.findFirst({ where: { applicantUserId: userId }, orderBy: { createdAt: "desc" }, include: applicationInclude });
  },

  openForUser(db: Db, userId: string, openStatuses: AgencyApplicationStatus[]) {
    return db.agencyApplication.findFirst({ where: { applicantUserId: userId, status: { in: openStatuses } }, include: applicationInclude });
  },

  listApplications(db: Db, f: { status?: AgencyApplicationStatus; country?: string; from?: Date; to?: Date; q?: string }) {
    return db.agencyApplication.findMany({
      where: {
        ...(f.status ? { status: f.status } : {}),
        ...(f.country ? { country: { equals: f.country, mode: "insensitive" } } : {}),
        ...(f.from || f.to ? { submittedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
        ...(f.q ? { OR: [{ proposedAgencyName: { contains: f.q, mode: "insensitive" } }, { applicantFullName: { contains: f.q, mode: "insensitive" } }, { applicantEmail: { contains: f.q, mode: "insensitive" } }] } : {}),
      },
      orderBy: [{ status: "asc" }, { submittedAt: "asc" }],
      include: applicationInclude,
    });
  },

  async applicationCounts(db: Db) {
    const rows = await db.agencyApplication.groupBy({ by: ["status"], _count: { _all: true } });
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = r._count._all;
    const decided = await db.agencyApplication.findMany({ where: { reviewedAt: { not: null }, status: { in: ["APPROVED", "REJECTED"] } }, select: { submittedAt: true, reviewedAt: true } });
    const avgReviewHours = decided.length ? Math.round(decided.reduce((s, r) => s + (r.reviewedAt!.getTime() - r.submittedAt.getTime()) / 3_600_000, 0) / decided.length) : null;
    return { counts, avgReviewHours };
  },

  addHistory(db: Db, d: { applicationId: string; previousStatus: AgencyApplicationStatus | null; newStatus: AgencyApplicationStatus; changedById: string | null; notes: string | null }) {
    return db.agencyApplicationHistory.create({ data: d });
  },

  listDocuments(db: Db, applicationId: string) {
    return db.document.findMany({ where: { ownerType: "AGENCY_APPLICATION", ownerId: applicationId }, orderBy: { createdAt: "asc" } });
  },

  addDocument(db: Db, d: { applicationId: string; kind: string; storageKey: string; uploadedById: string }) {
    return db.document.create({ data: { ownerType: "AGENCY_APPLICATION", ownerId: d.applicationId, kind: d.kind, storageKey: d.storageKey, uploadedById: d.uploadedById, visibility: "INTERNAL" } });
  },

  findDocument(db: Db, id: string) {
    return db.document.findUnique({ where: { id } });
  },

  deleteDocument(db: Db, id: string) {
    return db.document.delete({ where: { id } });
  },

  // ---- agencies
  createAgency(db: Db, d: { name: string; logoKey: string | null; ownerUserId: string; description: string | null; contactEmail: string; contactPhone: string | null; country: string; city: string | null; website: string | null }) {
    return db.agency.create({ data: d, include: agencyInclude });
  },

  updateAgency(db: Db, id: string, d: { name?: string; logoKey?: string | null; description?: string | null; contactEmail?: string; contactPhone?: string | null; country?: string; city?: string | null; website?: string | null; status?: AgencyStatus; statusReason?: string | null; suspendedAt?: Date | null; deactivatedAt?: Date | null; trainingAccess?: boolean; opportunityAccess?: boolean }) {
    return db.agency.update({ where: { id }, data: d, include: agencyInclude });
  },

  findAgency(db: Db, id: string) {
    return db.agency.findUnique({ where: { id }, include: agencyInclude });
  },

  listAgencies(db: Db, f: { status?: AgencyStatus; q?: string } = {}) {
    return db.agency.findMany({ where: { ...(f.status ? { status: f.status } : {}), ...(f.q ? { name: { contains: f.q, mode: "insensitive" } } : {}) }, orderBy: { joinedAt: "desc" }, include: agencyInclude });
  },

  // ---- seats (owners and managers)
  addSeat(db: Db, d: { agencyId: string; userId: string; role: AgencyUserRole; permissions: string[]; addedById: string | null }) {
    return db.agencyUser.create({ data: d });
  },

  seatFor(db: Db, userId: string) {
    return db.agencyUser.findFirst({ where: { userId }, include: { agency: { select: { id: true, status: true } } } });
  },

  // ---- agent memberships (history; writes live in membership.repository since v2 phase 2)
  membershipHistory(db: Db, agentProfileId: string) {
    return db.agencyMembership.findMany({ where: { agentProfileId }, orderBy: { joinedAt: "desc" }, include: { agency: { select: { id: true, name: true } } } });
  },

  /** Agents whose current primary agency is this one. Always called with an agencyId that came from the actor's scope. */
  agentsOf(db: Db, agencyId: string) {
    return db.agentProfile.findMany({ where: { primaryAgencyId: agencyId, deletedAt: null }, select: { id: true, displayName: true, primaryRole: true, status: true, availabilityStatus: true, verificationLevel: true, profileCompletion: true, user: { select: { email: true } } }, orderBy: { displayName: "asc" } });
  },
};
