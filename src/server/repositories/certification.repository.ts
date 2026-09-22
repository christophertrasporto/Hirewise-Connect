import type { CertificationStatus, Prisma, VerificationLevel } from "@prisma/client";
import type { Db } from "@/server/db/types";

export const certificationRepository = {
  templates(db: Db, activeOnly = true) {
    return db.certificationTemplate.findMany({ where: activeOnly ? { isActive: true } : {}, orderBy: { name: "asc" } });
  },

  findTemplate(db: Db, id: string) {
    return db.certificationTemplate.findUnique({ where: { id } });
  },

  upsertTemplate(db: Db, d: { id?: string; name: string; description: string | null; validityMonths: number | null; requiresCompletion: boolean; minExamScore: number | null; requiresCoachReview: boolean; minResultLabelRank: number | null; isActive: boolean }) {
    const data = { name: d.name, description: d.description ?? undefined, validityMonths: d.validityMonths, requiresCompletion: d.requiresCompletion, minExamScore: d.minExamScore, requiresCoachReview: d.requiresCoachReview, minResultLabelRank: d.minResultLabelRank, isActive: d.isActive };
    return d.id ? db.certificationTemplate.update({ where: { id: d.id }, data }) : db.certificationTemplate.create({ data });
  },

  findExisting(db: Db, agentProfileId: string, templateId: string, courseId: string | null) {
    return db.certification.findFirst({ where: { agentProfileId, templateId, courseId, status: { in: ["PENDING_REVIEW", "APPROVED"] } } });
  },

  create(db: Db, d: { agentProfileId: string; templateId: string; origin: "ACADEMY" | "ADMIN_ISSUED"; issuedById: string | null; assessmentId: string | null; courseId: string | null; status: CertificationStatus; expiresAt: Date | null; approvedById?: string | null }) {
    return db.certification.create({
      data: { agentProfileId: d.agentProfileId, templateId: d.templateId, origin: d.origin, issuedById: d.issuedById ?? undefined, assessmentId: d.assessmentId ?? undefined, courseId: d.courseId ?? undefined, status: d.status, expiresAt: d.expiresAt ?? undefined, approvedById: d.approvedById ?? undefined, approvedAt: d.status === "APPROVED" ? new Date() : undefined },
      include: { template: true, agentProfile: { select: { id: true, displayName: true, userId: true, user: { select: { email: true } } } } },
    });
  },

  findById(db: Db, id: string) {
    return db.certification.findUnique({ where: { id }, include: { template: true, agentProfile: { select: { id: true, displayName: true, userId: true, user: { select: { email: true } } } }, assessment: { select: { id: true, resultLabel: { select: { label: true } }, examScore: true } } } });
  },

  setStatus(db: Db, id: string, status: CertificationStatus, extra: { approvedById?: string; revokedReason?: string } = {}) {
    return db.certification.update({ where: { id }, data: { status, ...(status === "APPROVED" ? { approvedAt: new Date() } : {}), ...extra } });
  },

  listPending(db: Db, take = 100) {
    return db.certification.findMany({ where: { status: "PENDING_REVIEW" }, include: { template: true, agentProfile: { select: { id: true, displayName: true } }, assessment: { select: { examScore: true, resultLabel: { select: { label: true } } } } }, orderBy: { createdAt: "asc" }, take });
  },

  listForAgent(db: Db, agentProfileId: string) {
    return db.certification.findMany({ where: { agentProfileId }, include: { template: true }, orderBy: { issuedAt: "desc" } });
  },

  expiringBetween(db: Db, from: Date, to: Date) {
    return db.certification.findMany({ where: { status: "APPROVED", expiresAt: { gt: from, lte: to } }, include: { template: true, agentProfile: { select: { userId: true, user: { select: { email: true } } } } } });
  },

  expiredBy(db: Db, now: Date) {
    return db.certification.findMany({ where: { status: "APPROVED", expiresAt: { lte: now } }, select: { id: true, agentProfileId: true } });
  },

  // Verification requirements
  requirements(db: Db) {
    return db.verificationRequirement.findMany();
  },

  upsertRequirement(db: Db, level: VerificationLevel, rules: Prisma.InputJsonValue) {
    return db.verificationRequirement.upsert({ where: { level }, create: { level, rules }, update: { rules } });
  },

  /** Facts the verification ladder is evaluated against. */
  factsFor(db: Db, agentProfileId: string) {
    return db.agentProfile.findUnique({
      where: { id: agentProfileId },
      select: {
        status: true,
        verificationLevel: true,
        verificationIsManual: true,
        videos: { where: { status: "APPROVED" }, select: { id: true } },
        recordings: { where: { status: "APPROVED" }, select: { id: true } },
        certifications: { where: { status: "APPROVED" }, select: { id: true } },
        assessments: { where: { status: "FINAL" }, select: { resultLabel: { select: { rank: true } } } },
      },
    });
  },
};
