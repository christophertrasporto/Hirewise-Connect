import type { Db } from "@/server/db/types";

/** v2 phase 6b: tenant-scoped aggregates for the agency Reports tab. Every query is bounded by the agency id. */
export const agencyReportRepository = {
  async team(db: Db, agencyId: string) {
    const members = await db.agentProfile.findMany({ where: { primaryAgencyId: agencyId, deletedAt: null }, select: { id: true, status: true, availabilityStatus: true, verificationLevel: true, yearsExperience: true, _count: { select: { certifications: { where: { status: "APPROVED" } }, assessments: { where: { status: "FINAL" } } } } } });
    return members;
  },

  async training(db: Db, agencyId: string) {
    const [enrollments, purchases] = await Promise.all([
      db.courseEnrollment.groupBy({ by: ["status"], _count: { _all: true }, where: { agentProfile: { primaryAgencyId: agencyId }, status: { not: "REVOKED" } } }),
      db.coursePurchase.aggregate({ where: { agencyId, status: { in: ["PAID", "WAIVED"] } }, _sum: { seatCount: true } }),
    ]);
    return { enrollments: Object.fromEntries(enrollments.map((e) => [e.status, e._count._all])) as Record<string, number>, seatsPurchased: purchases._sum.seatCount ?? 0 };
  },

  async submissions(db: Db, agencyId: string) {
    const rows = await db.submission.groupBy({ by: ["status"], _count: { _all: true }, where: { agencyId } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Record<string, number>;
  },

  async interviews(db: Db, agencyId: string) {
    const [requests, scheduled] = await Promise.all([
      db.interviewRequestCandidate.count({ where: { agentProfile: { primaryAgencyId: agencyId } } }),
      db.interview.count({ where: { agentProfile: { primaryAgencyId: agencyId } } }),
    ]);
    return { requests, scheduled };
  },

  async placements(db: Db, agencyId: string) {
    const rows = await db.placement.groupBy({ by: ["status"], _count: { _all: true }, where: { agentProfile: { primaryAgencyId: agencyId } } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Record<string, number>;
  },
};
