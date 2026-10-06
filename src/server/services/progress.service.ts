import type { Db } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { ForbiddenError } from "@/server/policies/authorize";
import { academyRepository } from "@/server/repositories/academy.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { evaluateCertification } from "./certification.service";

/**
 * Course progress = completed required lessons / required lessons, over published modules and lessons.
 * Recalculated after every lesson event and after curriculum edits. When every required lesson is done the
 * enrolment completes once (CourseCompletion, COURSE_COMPLETED, certification pipeline).
 *
 * Completion rules (course settings):
 * - every required lesson complete (always);
 * - `completionRequiresQuizPass`: quiz lessons only complete on a pass (enforced in the quiz engine);
 * - `completionRequiresFinalAssessment`: the last published assessment lesson counts as required even when optional.
 * Sequential unlock (course setting): a lesson opens only when every earlier required lesson is complete.
 */
const systemActor = (): Actor => ({ userId: "system", role: "SUPER_ADMIN", permissions: new Set() });

type LessonLite = { id: string; title: string; isRequired: boolean; contentType: string; status: string };
type ModuleLite = { status: string; lessons: LessonLite[] };
type CourseLite = { sequentialUnlock: boolean; completionRequiresFinalAssessment: boolean; modules: ModuleLite[] };

/** Published lessons in course order. */
export function orderedLessons(course: CourseLite): LessonLite[] {
  return course.modules.filter((m) => m.status === "PUBLISHED").flatMap((m) => m.lessons.filter((l) => l.status === "PUBLISHED"));
}

/** The last published assessment lesson, which the completion rule can make mandatory. */
export function finalAssessmentId(course: CourseLite): string | null {
  const a = orderedLessons(course).filter((l) => l.contentType === "ASSESSMENT");
  return a.length ? a[a.length - 1].id : null;
}

/** Lessons that count towards completion: required ones, plus the final assessment when the course asks for it. */
export function requiredLessons(course: CourseLite): LessonLite[] {
  const final = course.completionRequiresFinalAssessment ? finalAssessmentId(course) : null;
  return orderedLessons(course).filter((l) => l.isRequired || l.id === final);
}

/** Sequential unlock: lessonId → why it is locked ("Finish \"X\" first."). Empty when the course does not use it. */
export function lockedLessons(course: CourseLite, doneIds: Set<string>): Record<string, string> {
  if (!course.sequentialUnlock) return {};
  const required = new Set(requiredLessons(course).map((l) => l.id));
  const locked: Record<string, string> = {};
  let blocker: LessonLite | null = null;
  for (const l of orderedLessons(course)) {
    if (blocker) locked[l.id] = `Finish "${blocker.title}" first.`;
    else if (required.has(l.id) && !doneIds.has(l.id)) blocker = l;
  }
  return locked;
}

async function doneLessonIds(db: Db, lessonIds: string[], agentProfileId: string): Promise<Set<string>> {
  if (!lessonIds.length) return new Set();
  const rows = await db.lessonProgress.findMany({ where: { agentProfileId, lessonId: { in: lessonIds }, status: "COMPLETED" }, select: { lessonId: true } });
  return new Set(rows.map((r) => r.lessonId));
}

async function loadCourseLite(db: Db, courseId: string) {
  return db.academyCourse.findUnique({ where: { id: courseId }, select: { id: true, title: true, sequentialUnlock: true, completionRequiresFinalAssessment: true, modules: { orderBy: { order: "asc" }, select: { status: true, lessons: { orderBy: { order: "asc" }, select: { id: true, title: true, isRequired: true, contentType: true, status: true } } } } } });
}

/** Refuses any learner action on a lesson that sequential unlock has not opened yet. */
export async function assertLessonUnlocked(db: Db, lesson: { id: string; module: { courseId: string } }, agentProfileId: string): Promise<void> {
  const course = await loadCourseLite(db, lesson.module.courseId);
  if (!course?.sequentialUnlock) return;
  const done = await doneLessonIds(db, orderedLessons(course).map((l) => l.id), agentProfileId);
  const reason = lockedLessons(course, done)[lesson.id];
  if (reason) throw new ForbiddenError(reason);
}

/** Locked lessons for the course page. */
export async function lockedLessonsFor(db: Db, courseId: string, agentProfileId: string): Promise<Record<string, string>> {
  const course = await loadCourseLite(db, courseId);
  if (!course?.sequentialUnlock) return {};
  const done = await doneLessonIds(db, orderedLessons(course).map((l) => l.id), agentProfileId);
  return lockedLessons(course, done);
}

export async function recalculateCourseProgress(db: Db, courseId: string, agentProfileId: string): Promise<{ requiredTotal: number; requiredDone: number; percent: number; completedNow: boolean }> {
  const course = await loadCourseLite(db, courseId);
  if (!course) return { requiredTotal: 0, requiredDone: 0, percent: 0, completedNow: false };
  const required = requiredLessons(course);
  const doneIds = await doneLessonIds(db, required.map((l) => l.id), agentProfileId);
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
  const quizLessonIds = orderedLessons(course).filter((l) => l.contentType === "QUIZ" || l.contentType === "ASSESSMENT" || l.contentType === "AUDIO").map((l) => l.id);
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

/**
 * After a curriculum edit (a required lesson added, removed, reordered, or flipped), refresh every enrolled
 * learner's cached progress. Existing completions are never revoked; a learner who now satisfies the rules completes.
 */
export async function recalculateAllForCourse(db: Db, courseId: string): Promise<number> {
  const rows = await db.courseEnrollment.findMany({ where: { courseId, paymentStatus: { not: "PENDING" } }, select: { agentProfileId: true } });
  for (const r of rows) await recalculateCourseProgress(db, courseId, r.agentProfileId);
  return rows.length;
}
