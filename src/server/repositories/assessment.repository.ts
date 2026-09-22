import type { AssessmentType, Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";

export const assessmentRepository = {
  labels(db: Db) {
    return db.assessmentResultLabel.findMany({ where: { isActive: true }, orderBy: { rank: "asc" } });
  },

  upsertLabel(db: Db, d: { key: string; label: string; rank: number; isActive: boolean }) {
    return db.assessmentResultLabel.upsert({ where: { key: d.key }, create: d, update: { label: d.label, rank: d.rank, isActive: d.isActive } });
  },

  create(db: Db, d: { courseId: string | null; agentProfileId: string; coachUserId: string; type: AssessmentType; examScore: number | null; practicalScore: number | null; roleplayScore: number | null; communicationScore: number | null; skillScores: Prisma.InputJsonValue | null; comments: string | null; strengths: string | null; areasForImprovement: string | null; resultLabelId: string | null; certificationRecommended: boolean; status: "DRAFT" | "FINAL" }) {
    return db.assessment.create({
      data: {
        courseId: d.courseId ?? undefined, agentProfileId: d.agentProfileId, coachUserId: d.coachUserId, type: d.type,
        examScore: d.examScore ?? undefined, practicalScore: d.practicalScore ?? undefined, roleplayScore: d.roleplayScore ?? undefined, communicationScore: d.communicationScore ?? undefined,
        skillScores: d.skillScores ?? undefined, comments: d.comments ?? undefined, strengths: d.strengths ?? undefined, areasForImprovement: d.areasForImprovement ?? undefined,
        resultLabelId: d.resultLabelId ?? undefined, certificationRecommended: d.certificationRecommended, status: d.status,
      },
      include: { resultLabel: true, course: { select: { id: true, title: true, certificationTemplateId: true } }, agentProfile: { select: { id: true, displayName: true, userId: true, user: { select: { email: true } } } } },
    });
  },

  listForAgent(db: Db, agentProfileId: string) {
    return db.assessment.findMany({ where: { agentProfileId }, include: { resultLabel: true, course: { select: { id: true, title: true } }, coach: { select: { email: true } } }, orderBy: { assessedAt: "desc" } });
  },

  listForCoach(db: Db, coachUserId: string, take = 100) {
    return db.assessment.findMany({ where: { coachUserId }, include: { resultLabel: true, course: { select: { id: true, title: true } }, agentProfile: { select: { id: true, displayName: true } } }, orderBy: { assessedAt: "desc" }, take });
  },

  createEvaluation(db: Db, d: { agentProfileId: string; coachUserId: string; summary: string; communication: number; reliability: number; coachability: number; overallLabelId: string | null; visibleToClients: boolean }) {
    return db.coachEvaluation.create({ data: { ...d, overallLabelId: d.overallLabelId ?? undefined } });
  },
};
