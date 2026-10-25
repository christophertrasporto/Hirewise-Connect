import type { Prisma, CoursePurchaseStatus, CredentialSource } from "@prisma/client";
import type { Db } from "@/server/db/types";

const OPEN_MEMBERSHIP = ["INVITED", "PENDING_VERIFICATION", "ACTIVE", "EXIT_REQUESTED", "REMOVAL_REQUESTED", "ENDING"] as const;

const purchaseInclude = {
  agency: { select: { id: true, name: true, ownerUserId: true, owner: { select: { email: true } } } },
  course: { select: { id: true, title: true, priceCents: true } },
  _count: { select: { assignments: true } },
} satisfies Prisma.CoursePurchaseInclude;
export type CoursePurchaseRecord = Prisma.CoursePurchaseGetPayload<{ include: typeof purchaseInclude }>;

/** v2 phase 4: Course Seats (distinct from Agent Seats), assignments, and the agency's view of its members' credentials. */
export const trainingRepository = {
  publishedCourses(db: Db) {
    return db.academyCourse.findMany({ where: { status: "PUBLISHED" }, orderBy: { title: "asc" }, select: { id: true, title: true, category: true, description: true, priceCents: true, certificationTemplate: { select: { name: true } }, _count: { select: { modules: true } } } });
  },
  course(db: Db, id: string) {
    return db.academyCourse.findUnique({ where: { id }, select: { id: true, title: true, priceCents: true, status: true, ownerCoachUserId: true, coaches: { select: { coachUserId: true } } } });
  },

  // ---- purchases
  createPurchase(db: Db, d: { agencyId: string; courseId: string; seatCount: number; amountMinor: number; currency: string; requestedById: string; note: string | null; status?: CoursePurchaseStatus }) {
    return db.coursePurchase.create({ data: { ...d, note: d.note ?? undefined, status: d.status ?? "PENDING" }, include: purchaseInclude });
  },
  findPurchase(db: Db, id: string) {
    return db.coursePurchase.findUnique({ where: { id }, include: purchaseInclude });
  },
  listPurchases(db: Db, f: { agencyId?: string; status?: CoursePurchaseStatus }, take = 100) {
    return db.coursePurchase.findMany({ where: { ...(f.agencyId ? { agencyId: f.agencyId } : {}), ...(f.status ? { status: f.status } : {}) }, orderBy: { createdAt: "desc" }, take, include: purchaseInclude });
  },
  recordPurchase(db: Db, id: string, d: { status: CoursePurchaseStatus; recordedById: string; paymentReference: string | null; note: string | null; paidAt: Date | null }) {
    return db.coursePurchase.update({ where: { id }, data: { status: d.status, recordedById: d.recordedById, paymentReference: d.paymentReference ?? undefined, note: d.note ?? undefined, paidAt: d.paidAt ?? undefined }, include: purchaseInclude });
  },
  async refundPurchase(db: Db, id: string, d: { kind: "REFUND" | "CHARGEBACK"; reason: string }) {
    const r = await db.coursePurchase.updateMany({ where: { id, status: "PAID" }, data: { status: "REFUNDED", refundedAt: new Date(), refundKind: d.kind, refundReason: d.reason } });
    return r.count;
  },
  openAssignmentsForPurchase(db: Db, coursePurchaseId: string) {
    return db.courseSeatAssignment.findMany({ where: { coursePurchaseId, revokedAt: null }, select: { id: true, enrollmentId: true } });
  },
  enrollmentAccess(db: Db, id: string) {
    return db.courseEnrollment.findUnique({ where: { id }, select: { id: true, status: true, accessRevokedAt: true } });
  },
  async purchaseCounts(db: Db) {
    const rows = await db.coursePurchase.groupBy({ by: ["status"], _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<Record<CoursePurchaseStatus, number>>;
  },
  /** Paid or waived purchases of a course that still have unassigned seats, oldest first. */
  async purchasesWithCapacity(db: Db, agencyId: string, courseId: string) {
    const rows = await db.coursePurchase.findMany({ where: { agencyId, courseId, status: { in: ["PAID", "WAIVED"] } }, orderBy: { createdAt: "asc" }, select: { id: true, seatCount: true, _count: { select: { assignments: { where: { revokedAt: null } } } } } });
    return rows.filter((r) => r._count.assignments < r.seatCount);
  },
  /** Seats bought minus seats in use, per course, for the agency's catalog. */
  async seatsByCourse(db: Db, agencyId: string): Promise<Record<string, { bought: number; used: number }>> {
    const [bought, used] = await Promise.all([
      db.coursePurchase.groupBy({ by: ["courseId"], where: { agencyId, status: { in: ["PAID", "WAIVED"] } }, _sum: { seatCount: true } }),
      db.courseSeatAssignment.groupBy({ by: ["courseId"], where: { agencyId, revokedAt: null, coursePurchaseId: { not: null } }, _count: { _all: true } }),
    ]);
    const out: Record<string, { bought: number; used: number }> = {};
    for (const b of bought) out[b.courseId] = { bought: b._sum.seatCount ?? 0, used: 0 };
    for (const u of used) out[u.courseId] = { bought: out[u.courseId]?.bought ?? 0, used: u._count._all };
    return out;
  },

  // ---- assignments
  createAssignment(db: Db, d: { coursePurchaseId: string | null; agencyId: string; courseId: string; agentProfileId: string; assignedById: string }) {
    return db.courseSeatAssignment.create({ data: { ...d, coursePurchaseId: d.coursePurchaseId ?? undefined } });
  },
  linkAssignmentEnrollment(db: Db, id: string, enrollmentId: string) {
    return db.courseSeatAssignment.update({ where: { id }, data: { enrollmentId }, select: { id: true } });
  },
  openAssignmentsForAgent(db: Db, agencyId: string, agentProfileId: string) {
    return db.courseSeatAssignment.findMany({ where: { agencyId, agentProfileId, revokedAt: null } });
  },
  revokeAssignment(db: Db, id: string, reason: string) {
    return db.courseSeatAssignment.update({ where: { id }, data: { revokedAt: new Date(), revokeReason: reason }, select: { id: true } });
  },

  // ---- enrollments: sponsored creation and revocation
  createSponsoredEnrollment(db: Db, d: { courseId: string; agentProfileId: string; priceCents: number; sponsoringAgencyId: string; courseSeatAssignmentId: string }) {
    return db.courseEnrollment.create({ data: { courseId: d.courseId, agentProfileId: d.agentProfileId, priceCents: d.priceCents, paymentStatus: d.priceCents > 0 ? "WAIVED" : "NOT_REQUIRED", paymentReference: d.priceCents > 0 ? "Agency course seat" : undefined, paidAt: d.priceCents > 0 ? new Date() : undefined, source: "INTERNAL", credentialSource: "AGENCY_SPONSORED", sponsoringAgencyId: d.sponsoringAgencyId, courseSeatAssignmentId: d.courseSeatAssignmentId } });
  },
  sponsoredEnrollments(db: Db, agencyId: string, agentProfileId: string) {
    return db.courseEnrollment.findMany({ where: { agentProfileId, sponsoringAgencyId: agencyId, credentialSource: "AGENCY_SPONSORED", accessRevokedAt: null }, select: { id: true, status: true, courseId: true, course: { select: { title: true } } } });
  },
  revokeEnrollment(db: Db, id: string, d: { status: "REVOKED" | null; reason: string }) {
    return db.courseEnrollment.update({ where: { id }, data: { ...(d.status ? { status: d.status } : {}), accessRevokedAt: new Date(), revokeReason: d.reason }, select: { id: true } });
  },
  setEnrollmentSource(db: Db, id: string, credentialSource: CredentialSource) {
    return db.courseEnrollment.update({ where: { id }, data: { credentialSource }, select: { id: true } });
  },
  enrollmentSourceFor(db: Db, courseId: string, agentProfileId: string) {
    return db.courseEnrollment.findUnique({ where: { courseId_agentProfileId: { courseId, agentProfileId } }, select: { credentialSource: true, sponsoringAgencyId: true } });
  },

  // ---- certifications and assessments: sponsored items
  sponsoredCertifications(db: Db, agencyId: string, agentProfileId: string) {
    return db.certification.findMany({ where: { agentProfileId, sponsoringAgencyId: agencyId, credentialSource: "AGENCY_SPONSORED", status: { in: ["APPROVED", "PENDING_REVIEW"] } }, select: { id: true, status: true, template: { select: { name: true } } } });
  },
  inactivateCertification(db: Db, id: string, reason: string) {
    return db.certification.update({ where: { id }, data: { status: "INACTIVE_FOR_PLATFORM_USE", inactivatedAt: new Date(), inactiveReason: reason }, select: { id: true } });
  },
  sponsoredAssessments(db: Db, agencyId: string, agentProfileId: string) {
    return db.assessment.findMany({ where: { agentProfileId, sponsoringAgencyId: agencyId, credentialSource: "AGENCY_SPONSORED", status: { in: ["FINAL", "SUBMITTED", "DRAFT"] } }, select: { id: true, status: true } });
  },
  historicalAssessment(db: Db, id: string) {
    return db.assessment.update({ where: { id }, data: { status: "HISTORICAL", historicalAt: new Date() }, select: { id: true } });
  },

  // ---- the agency's view of its members
  memberTraining(db: Db, agencyId: string) {
    return db.agencyMembership.findMany({
      where: { agencyId, status: { in: [...OPEN_MEMBERSHIP] } },
      orderBy: { joinedAt: "asc" },
      select: {
        id: true,
        status: true,
        agentProfile: {
          select: {
            id: true, displayName: true, primaryRole: true, verificationLevel: true,
            enrollments: { select: { id: true, status: true, credentialSource: true, sponsoringAgencyId: true, accessRevokedAt: true, enrolledAt: true, course: { select: { id: true, title: true } }, completion: { select: { completedAt: true, examScore: true } } }, orderBy: { enrolledAt: "desc" } },
            courseProgress: { select: { courseId: true, percent: true } },
            certifications: { select: { id: true, status: true, credentialSource: true, sponsoringAgencyId: true, issuedAt: true, expiresAt: true, template: { select: { name: true } } } },
            assessments: { where: { status: { in: ["FINAL", "HISTORICAL"] } }, select: { id: true, status: true, type: true, credentialSource: true, sponsoringAgencyId: true, assessedAt: true, resultLabel: { select: { label: true } }, course: { select: { title: true } } } },
          },
        },
      },
    });
  },
};
