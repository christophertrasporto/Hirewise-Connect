import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/types";
import { lessonAccessRepository } from "@/server/repositories/lesson-access.repository";
import { ForbiddenError, NotFoundError } from "./authorize";

/**
 * The one rule for who may watch (or download, or track progress on) a lesson. Every route, API, and service that serves
 * lesson content calls `canWatchLesson` or `assertCanWatchLesson`; no page or component decides access on its own.
 *
 * A lesson may be watched when
 *  - the lesson, its module, and its course are published and the lesson is a free preview (anyone, signed in or not), or
 *  - the viewer owns the course: a free, paid, or waived enrolment that has not been refunded, charged back, or revoked,
 *    and the lesson and its module are published, or
 *  - the viewer is staff who manage the course (course.manage, or a coach of the course), including unpublished lessons.
 *
 * Access follows the `isFreePreview` flag only, never the lesson's position, so reordering unlocks nothing.
 */

type Published = "DRAFT" | "PUBLISHED";

export type LessonAccessLesson = {
  status: Published;
  isFreePreview: boolean;
  module: { status: Published; courseId: string; course: { status: string; ownerCoachUserId: string; coaches: Array<{ coachUserId: string }> } };
};

export type EnrollmentAccess = { status: string; paymentStatus: string; accessRevokedAt: Date | null } | null;

/** A completed, non-refunded purchase (or a free or waived enrolment) that has not been revoked. */
export function entitledToCourse(e: EnrollmentAccess): boolean {
  if (!e) return false;
  if (e.status === "REVOKED" || e.accessRevokedAt) return false;
  return e.paymentStatus === "NOT_REQUIRED" || e.paymentStatus === "PAID" || e.paymentStatus === "WAIVED";
}

/** Staff who manage this course: course.manage, or a coach who owns or is assigned to it. */
export function managesCourse(actor: Actor | null, course: LessonAccessLesson["module"]["course"]): boolean {
  if (!actor) return false;
  if (actor.permissions.has("course.manage")) return true;
  if (!actor.permissions.has("course.create_own")) return false;
  return course.ownerCoachUserId === actor.userId || course.coaches.some((c) => c.coachUserId === actor.userId);
}

export function isPublished(l: LessonAccessLesson): boolean {
  return l.status === "PUBLISHED" && l.module.status === "PUBLISHED";
}

/** The rule, as a pure function. `enrollment` is the viewer's own enrolment in the lesson's course, if any. */
export function canWatchLessonWith(actor: Actor | null, lesson: LessonAccessLesson, enrollment: EnrollmentAccess): boolean {
  if (managesCourse(actor, lesson.module.course)) return true;
  if (!isPublished(lesson)) return false;
  if (lesson.isFreePreview && lesson.module.course.status === "PUBLISHED") return true;
  return entitledToCourse(enrollment);
}

async function load(db: Db, actor: Actor | null, lessonId: string) {
  const lesson = await lessonAccessRepository.findLesson(db, lessonId);
  if (!lesson) return null;
  const enrollment = actor?.role === "AGENT" && actor.agentProfileId ? await lessonAccessRepository.findEnrollment(db, lesson.module.courseId, actor.agentProfileId) : null;
  return { lesson, enrollment };
}

export async function canWatchLesson(db: Db, actor: Actor | null, lessonId: string): Promise<boolean> {
  const f = await load(db, actor, lessonId);
  return !!f && canWatchLessonWith(actor, f.lesson, f.enrollment);
}

export type LessonAccessDenial = "NOT_FOUND" | "SIGN_IN" | "NO_ACCESS";

/**
 * Throws NotFoundError for a lesson that does not exist or is hidden from this viewer (unpublished), and a
 * `LessonAccessError` for a published gated lesson the viewer does not own, so routes can answer 401 or 403.
 */
export class LessonAccessError extends Error {
  readonly status: number;
  constructor(readonly denial: Exclude<LessonAccessDenial, "NOT_FOUND">) {
    super(denial === "SIGN_IN" ? "Sign in to watch this lesson." : "Buy the course to watch this lesson.");
    this.name = "LessonAccessError";
    this.status = denial === "SIGN_IN" ? 401 : 403;
  }
}

export async function assertCanWatchLesson(db: Db, actor: Actor | null, lessonId: string) {
  const f = await load(db, actor, lessonId);
  if (!f) throw new NotFoundError();
  if (canWatchLessonWith(actor, f.lesson, f.enrollment)) return f.lesson;
  // Unpublished lessons do not exist for anyone but staff, whatever they own.
  if (!isPublished(f.lesson)) throw new NotFoundError();
  throw new LessonAccessError(actor ? "NO_ACCESS" : "SIGN_IN");
}

/**
 * For learner actions that write progress, take a quiz, or submit an assignment: free previews can be watched by anyone
 * but only an owner can track them. The viewer must own the course and the lesson must be published. Messages keep the
 * wording learners already see.
 */
export async function assertLearnerOwnsLesson(db: Db, actor: Actor, lessonId: string): Promise<void> {
  const f = await load(db, actor, lessonId);
  if (!f || !isPublished(f.lesson)) throw new NotFoundError();
  if (!f.enrollment) throw new NotFoundError();
  if (f.enrollment.paymentStatus === "PENDING") throw new ForbiddenError("This course unlocks once Hirewise records your payment.");
  if (!entitledToCourse(f.enrollment)) throw new ForbiddenError("Access to this course has ended.");
}
