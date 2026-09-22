import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { assertCoachAssigned } from "@/server/policies/ownership";
import { assessmentRepository } from "@/server/repositories/assessment.repository";
import { academyRepository } from "@/server/repositories/academy.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { evaluateCertification } from "./certification.service";
import { recomputeVerification } from "./verification.service";

const score = z.coerce.number().int().min(0).max(100).optional().or(z.literal(""));
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const assessmentSchema = z.object({
  courseId: z.string().min(1),
  agentProfileId: z.string().min(1),
  type: z.enum(["EXAM", "PRACTICAL", "ROLEPLAY", "MOCK_CALL", "SKILL"]),
  examScore: score,
  practicalScore: score,
  roleplayScore: score,
  communicationScore: score,
  comments: optionalText(4000),
  strengths: optionalText(2000),
  areasForImprovement: optionalText(2000),
  resultLabelId: z.string().min(1, "Choose a result."),
  certificationRecommended: z.coerce.boolean().default(false),
});

const n = (v: number | "" | undefined) => (v === "" || v === undefined ? null : v);

/**
 * Coach records a structured assessment for a student in one of their courses (INV-P5).
 * Finalised immediately; the certification pipeline runs and the verification level is recomputed.
 */
export async function recordAssessment(db: PrismaClient, actor: Actor, input: z.infer<typeof assessmentSchema>) {
  authorize(actor, "assessment.write");
  assertCoachAssigned(actor, input.courseId, "course.manage");
  const enrollment = await academyRepository.findEnrollment(db, input.courseId, input.agentProfileId);
  if (!enrollment) throw new NotFoundError("The agent is not enrolled in this course");
  const labels = await assessmentRepository.labels(db);
  const label = labels.find((l) => l.id === input.resultLabelId);
  if (!label) throw new NotFoundError("Unknown result label");
  const system: Actor = { userId: "system", role: "SUPER_ADMIN", permissions: new Set() };

  return db.$transaction(async (tx) => {
    const a = await assessmentRepository.create(tx, {
      courseId: input.courseId, agentProfileId: input.agentProfileId, coachUserId: actor.userId, type: input.type,
      examScore: n(input.examScore) ?? enrollment.completion?.examScore ?? null, practicalScore: n(input.practicalScore), roleplayScore: n(input.roleplayScore), communicationScore: n(input.communicationScore),
      skillScores: null, comments: input.comments || null, strengths: input.strengths || null, areasForImprovement: input.areasForImprovement || null,
      resultLabelId: label.id, certificationRecommended: input.certificationRecommended, status: "FINAL",
    });
    await audit(tx, { actor, action: "ASSESSMENT_FINALISED", entityType: "Assessment", entityId: a.id, newValue: { agentProfileId: input.agentProfileId, courseId: input.courseId, label: label.key, certificationRecommended: input.certificationRecommended } });
    await publishEvent(tx, "ASSESSMENT_FINALISED", { assessmentId: a.id, agentProfileId: input.agentProfileId, courseId: input.courseId, agentUserId: a.agentProfile.userId, agentEmail: a.agentProfile.user.email, label: label.label, courseTitle: a.course?.title ?? null });
    const certification = await evaluateCertification(tx, system, { agentProfileId: input.agentProfileId, courseId: input.courseId, templateId: enrollment.course.certificationTemplateId, examScore: enrollment.completion?.examScore ?? n(input.examScore), assessment: { id: a.id, certificationRecommended: input.certificationRecommended, resultLabelRank: label.rank }, completed: !!enrollment.completion });
    await recomputeVerification(tx, input.agentProfileId, actor);
    return { assessmentId: a.id, certification };
  });
}

export const evaluationSchema = z.object({
  agentProfileId: z.string().min(1),
  summary: z.string().trim().min(20, "Write a short summary.").max(2000),
  communication: z.coerce.number().int().min(1).max(5),
  reliability: z.coerce.number().int().min(1).max(5),
  coachability: z.coerce.number().int().min(1).max(5),
  overallLabelId: z.string().optional().or(z.literal("")),
  visibleToClients: z.coerce.boolean().default(true),
});

/** Coach evaluation: only for agents the coach teaches (enrolled in one of their courses). */
export async function recordEvaluation(db: PrismaClient, actor: Actor, input: z.infer<typeof evaluationSchema>) {
  authorize(actor, "assessment.write");
  if (!actor.permissions.has("course.manage")) {
    const enrollments = await academyRepository.listEnrollmentsForAgent(db, input.agentProfileId);
    const teaches = enrollments.some((e) => (actor.coachCourseIds ?? []).includes(e.courseId));
    if (!teaches) throw new NotFoundError();
  }
  await db.$transaction(async (tx) => {
    const ev = await assessmentRepository.createEvaluation(tx, { agentProfileId: input.agentProfileId, coachUserId: actor.userId, summary: input.summary, communication: input.communication, reliability: input.reliability, coachability: input.coachability, overallLabelId: input.overallLabelId || null, visibleToClients: input.visibleToClients });
    await audit(tx, { actor, action: "COACH_EVALUATION_RECORDED", entityType: "CoachEvaluation", entityId: ev.id, newValue: { agentProfileId: input.agentProfileId } });
  });
}

export async function listLabels(db: PrismaClient) {
  return assessmentRepository.labels(db);
}

export const labelSchema = z.object({ key: z.string().trim().regex(/^[A-Z_]{2,40}$/, "Use UPPER_SNAKE_CASE"), label: z.string().trim().min(2).max(60), rank: z.coerce.number().int().min(0).max(10), isActive: z.coerce.boolean().default(true) });

export async function saveLabel(db: PrismaClient, actor: Actor, input: z.infer<typeof labelSchema>) {
  authorize(actor, "verification.manage");
  await assessmentRepository.upsertLabel(db, input);
}

export async function listAssessmentsForCoach(db: PrismaClient, actor: Actor) {
  authorize(actor, "assessment.write");
  return assessmentRepository.listForCoach(db, actor.userId);
}

/** Students of a coach: everyone enrolled in a course they teach, with completion state. */
export async function studentsForCoach(db: PrismaClient, actor: Actor) {
  authorize(actor, "course.read_assigned");
  const courses = actor.permissions.has("course.manage") ? await academyRepository.listCourses(db, {}) : await academyRepository.listCourses(db, { coachUserId: actor.userId });
  const out: Array<{ courseId: string; courseTitle: string; enrollmentId: string; agentProfileId: string; displayName: string; status: string; paymentStatus: string; examScore: number | null; completedAt: Date | null }> = [];
  for (const c of courses) {
    const rows = await academyRepository.listEnrollmentsForCourse(db, c.id);
    for (const e of rows) out.push({ courseId: c.id, courseTitle: c.title, enrollmentId: e.id, agentProfileId: e.agentProfile.id, displayName: e.agentProfile.displayName, status: e.status, paymentStatus: e.paymentStatus, examScore: e.completion?.examScore ?? e.attempts[0]?.scorePercent ?? null, completedAt: e.completion?.completedAt ?? null });
  }
  return out;
}
