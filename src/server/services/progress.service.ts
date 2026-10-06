import type { Db } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { academyRepository } from "@/server/repositories/academy.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { evaluateCertification } from "./certification.service";

/**
 * Course progress = completed required lessons / required lessons, over published modules and lessons.
 * Recalculated after every lesson event. When every required lesson is done the enrolment completes once
 * (CourseCompletion, COURSE_COMPLETED, certification pipeline), exactly as the legacy exam flow did.
 * Phase 6 extends this with sequential unlock and certificate numbers.
 */
const systemActor = (): Actor => ({ userId: "system", role: "SUPER_ADMIN", permissions: new Set() });

export async function recalculateCourseProgress(db: Db, courseId: string, agentProfileId: string): Promise<{ requiredTotal: number; requiredDone: number; percent: number; completedNow: boolean }> {
  const course = await db.academyCourse.findUnique({ where: { id: courseId }, include: { modules: { where: { status: "PUBLISHED" }, orderBy: { order: "asc" }, include: { lessons: { where: { status: "PUBLISHED" }, orderBy: { order: "asc" } } } } } });
  if (!course) return { requiredTotal: 0, requiredDone: 0, percent: 0, completedNow: false };
  const required = course.modules.flatMap((m) => m.lessons).filter((l) => l.isRequired);
  const progress = required.length ? await db.lessonProgress.findMany({ where: { agentProfileId, lessonId: { in: required.map((l) => l.id) } } }) : [];
  const doneIds = new Set(progress.filter((p) => p.status === "COMPLETED").map((p) => p.lessonId));
  const requiredDone = required.filter((l) => doneIds.has(l.id)).length;
  const percent = required.length ? Math.floor((requiredDone / required.length) * 100) : 0;
  const current = required.find((l) => !doneIds.has(l.id)) ?? null;
  const allDone = required.length > 0 && requiredDone === required.length;

  const enrollment = await academyRepository.findEnrollment(db, courseId, agentProfileId);
  if (!enrollment) return { requiredTotal: required.length, requiredDone, percent, completedNow: false };

  await db.courseProgress.upsert({
    where: { courseId_agentProfileId: { courseId, agentProfileId } },
    create: { courseId, agentProfileId, requiredTotal: required.length, requiredDone, percent, currentLessonId: current?.id ?? null, completedAt: allDone ? new Date() : null },
    update: { requiredTotal: required.length, requiredDone, percent, currentLessonId: current?.id ?? null, ...(allDone ? { completedAt: enrollment.completion?.completedAt ?? new Date() } : {}) },
  });

  if (!allDone || enrollment.completion) return { requiredTotal: required.length, requiredDone, percent, completedNow: false };

  // Best quiz score across the course's question-bearing lessons feeds the certification rules.
  const quizLessonIds = course.modules.flatMap((m) => m.lessons).filter((l) => l.contentType === "QUIZ" || l.contentType === "ASSESSMENT" || l.contentType === "AUDIO").map((l) => l.id);
  const best = quizLessonIds.length ? await db.quizAttempt.aggregate({ where: { agentProfileId, lessonId: { in: quizLessonIds }, scorePercent: { not: null } }, _max: { scorePercent: true } }) : null;
  const examScore = best?._max.scorePercent ?? null;
  const system = systemActor();
  await academyRepository.createCompletion(db, { enrollmentId: enrollment.id, examScore });
  await academyRepository.setEnrollmentStatus(db, enrollment.id, "COMPLETED");
  await audit(db, { actor: { userId: enrollment.agentProfile.userId, role: "AGENT", permissions: new Set(), agentProfileId }, action: "COURSE_COMPLETED", entityType: "CourseEnrollment", entityId: enrollment.id, newValue: { courseId, examScore, requiredLessons: required.length } });
  await publishEvent(db, "COURSE_COMPLETED", {
    courseId,
    title: enrollment.course.title,
    agentProfileId,
    agentUserId: enrollment.agentProfile.userId,
    agentEmail: enrollment.agentProfile.user.email,
    displayName: enrollment.agentProfile.displayName,
    examScore,
    coachUserIds: [enrollment.course.ownerCoachUserId, ...enrollment.course.coaches.map((x) => x.coachUserId)],
    coachReviewRequired: enrollment.course.requiresCoachReview,
  });
  await evaluateCertification(db, system, { agentProfileId, courseId, templateId: enrollment.course.certificationTemplateId, examScore, assessment: null, completed: true });
  return { requiredTotal: required.length, requiredDone, percent, completedNow: true };
}
