import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize } from "@/server/policies/authorize";

/**
 * Admin / Coach tracking table (Course Builder phase 7): one row per enrolment with progress, the current module
 * and lesson, audiobook listening share, quiz scores and attempts, assignment status, completion, and certification.
 * Coaches see the courses they own or are assigned to; Admin sees everything and may filter by coach.
 */
export const TRACKING_STATUSES = ["COMPLETED", "IN_PROGRESS", "FAILED", "NOT_STARTED"] as const;
export type TrackingStatus = (typeof TRACKING_STATUSES)[number];
export type TrackingFilters = { courseId?: string; coachUserId?: string; status?: TrackingStatus | ""; q?: string };

const QUESTION_TYPES = new Set(["QUIZ", "ASSESSMENT", "AUDIO"]);

export type TrackingRow = {
  enrollmentId: string;
  learner: { id: string; displayName: string; primaryRole: string | null };
  course: { id: string; title: string; coach: string };
  status: TrackingStatus;
  paymentPending: boolean;
  enrolledAt: Date;
  percent: number;
  requiredDone: number;
  requiredTotal: number;
  currentModule: string | null;
  currentLesson: { id: string; title: string; contentType: string; status: string } | null;
  /** Average listened share across the course's audio lessons, null when it has none. */
  listeningPercent: number | null;
  quizzes: Array<{ lessonId: string; title: string; best: number | null; passed: boolean; attempts: number; pendingReview: boolean }>;
  attempts: number;
  assignments: { total: number; graded: number; awaitingReview: number; returned: number } | null;
  completedAt: Date | null;
  lastActivityAt: Date | null;
  certification: { name: string; status: string; certificateNumber: string | null } | null;
};

export async function learnerTracking(db: PrismaClient, actor: Actor, f: TrackingFilters = {}) {
  const manages = actor.permissions.has("course.manage");
  if (!manages) authorize(actor, "learner.progress.read");
  const scopeCoach = manages ? f.coachUserId || undefined : actor.userId;
  const courses = await db.academyCourse.findMany({
    where: { ...(f.courseId ? { id: f.courseId } : {}), ...(scopeCoach ? { OR: [{ ownerCoachUserId: scopeCoach }, { coaches: { some: { coachUserId: scopeCoach } } }] } : {}) },
    orderBy: { title: "asc" },
    select: { id: true, title: true, ownerCoachUserId: true, ownerCoach: { select: { email: true } }, modules: { where: { status: "PUBLISHED" }, orderBy: { order: "asc" }, select: { id: true, title: true, lessons: { where: { status: "PUBLISHED" }, orderBy: { order: "asc" }, select: { id: true, title: true, contentType: true, isRequired: true } } } } },
  });
  const coaches = [...new Map(courses.map((c) => [c.ownerCoachUserId, { userId: c.ownerCoachUserId, label: c.ownerCoach.email.split("@")[0] }])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const courseOptions = courses.map((c) => ({ id: c.id, title: c.title }));
  if (!courses.length) return { rows: [] as TrackingRow[], courses: courseOptions, coaches };

  const courseIds = courses.map((c) => c.id);
  const q = f.q?.trim();
  const enrollments = await db.courseEnrollment.findMany({
    where: { courseId: { in: courseIds }, ...(q ? { agentProfile: { OR: [{ displayName: { contains: q, mode: "insensitive" } }, { user: { email: { contains: q, mode: "insensitive" } } }] } } : {}) },
    include: { completion: { select: { completedAt: true } }, agentProfile: { select: { id: true, displayName: true, primaryRole: true } } },
    orderBy: { enrolledAt: "desc" },
  });
  if (!enrollments.length) return { rows: [] as TrackingRow[], courses: courseOptions, coaches };
  const profileIds = [...new Set(enrollments.map((e) => e.agentProfileId))];
  const lessonIds = courses.flatMap((c) => c.modules.flatMap((m) => m.lessons.map((l) => l.id)));
  const [progress, courseProgress, attempts, submissions, certs] = await Promise.all([
    lessonIds.length ? db.lessonProgress.findMany({ where: { agentProfileId: { in: profileIds }, lessonId: { in: lessonIds } }, select: { lessonId: true, agentProfileId: true, status: true, mediaPercent: true, updatedAt: true } }) : [],
    db.courseProgress.findMany({ where: { agentProfileId: { in: profileIds }, courseId: { in: courseIds } } }),
    lessonIds.length ? db.quizAttempt.findMany({ where: { agentProfileId: { in: profileIds }, lessonId: { in: lessonIds }, status: { not: "IN_PROGRESS" } }, select: { lessonId: true, agentProfileId: true, scorePercent: true, passed: true, status: true, submittedAt: true } }) : [],
    lessonIds.length ? db.assignmentSubmission.findMany({ where: { agentProfileId: { in: profileIds }, lessonId: { in: lessonIds } }, select: { lessonId: true, agentProfileId: true, status: true, submittedAt: true }, orderBy: { submittedAt: "desc" } }) : [],
    db.certification.findMany({ where: { agentProfileId: { in: profileIds }, courseId: { in: courseIds } }, select: { agentProfileId: true, courseId: true, status: true, certificateNumber: true, template: { select: { name: true } } } }),
  ]);

  const rows: TrackingRow[] = enrollments.map((e) => {
    const course = courses.find((c) => c.id === e.courseId)!;
    const lessons = course.modules.flatMap((m) => m.lessons.map((l) => ({ ...l, moduleTitle: m.title })));
    const lp = new Map(progress.filter((p) => p.agentProfileId === e.agentProfileId && lessons.some((l) => l.id === p.lessonId)).map((p) => [p.lessonId, p]));
    const cp = courseProgress.find((c) => c.agentProfileId === e.agentProfileId && c.courseId === e.courseId) ?? null;
    const myAttempts = attempts.filter((a) => a.agentProfileId === e.agentProfileId && lessons.some((l) => l.id === a.lessonId));
    const mySubs = submissions.filter((s) => s.agentProfileId === e.agentProfileId && lessons.some((l) => l.id === s.lessonId));
    const audio = lessons.filter((l) => l.contentType === "AUDIO");
    const listeningPercent = audio.length ? Math.round(audio.reduce((s, l) => s + (lp.get(l.id)?.mediaPercent ?? 0), 0) / audio.length) : null;
    const quizzes = lessons.filter((l) => QUESTION_TYPES.has(l.contentType)).map((l) => {
      const at = myAttempts.filter((a) => a.lessonId === l.id);
      const scored = at.filter((a) => a.scorePercent !== null).map((a) => a.scorePercent as number);
      return { lessonId: l.id, title: l.title, best: scored.length ? Math.max(...scored) : null, passed: at.some((a) => a.passed === true), attempts: at.length, pendingReview: at.some((a) => a.status === "PENDING_REVIEW") };
    });
    const assignmentLessons = lessons.filter((l) => l.contentType === "ASSIGNMENT");
    const latestSub = (lessonId: string) => mySubs.find((s) => s.lessonId === lessonId) ?? null;
    const assignments = assignmentLessons.length ? { total: assignmentLessons.length, graded: assignmentLessons.filter((l) => latestSub(l.id)?.status === "GRADED").length, awaitingReview: assignmentLessons.filter((l) => latestSub(l.id)?.status === "SUBMITTED").length, returned: assignmentLessons.filter((l) => latestSub(l.id)?.status === "RETURNED").length } : null;
    const required = lessons.filter((l) => l.isRequired);
    const currentId = cp?.currentLessonId ?? required.find((l) => lp.get(l.id)?.status !== "COMPLETED")?.id ?? null;
    const current = currentId ? lessons.find((l) => l.id === currentId) ?? null : null;
    const paymentPending = e.paymentStatus === "PENDING";
    const started = lp.size > 0 || myAttempts.length > 0 || mySubs.length > 0;
    const status: TrackingStatus = e.completion ? "COMPLETED" : [...lp.values()].some((p) => p.status === "FAILED") ? "FAILED" : started ? "IN_PROGRESS" : "NOT_STARTED";
    const activity = [...[...lp.values()].map((p) => p.updatedAt.getTime()), ...myAttempts.map((a) => a.submittedAt?.getTime() ?? 0), ...mySubs.map((s) => s.submittedAt.getTime())].filter(Boolean);
    const cert = certs.find((c) => c.agentProfileId === e.agentProfileId && c.courseId === e.courseId) ?? null;
    return {
      enrollmentId: e.id,
      learner: e.agentProfile,
      course: { id: course.id, title: course.title, coach: course.ownerCoach.email.split("@")[0] },
      status,
      paymentPending,
      enrolledAt: e.enrolledAt,
      // Completions recorded before lesson tracking existed have no cached progress row: show them as done.
      percent: cp?.percent ?? (e.completion ? 100 : 0),
      requiredDone: cp?.requiredDone ?? (e.completion ? required.length : 0),
      requiredTotal: cp?.requiredTotal ?? required.length,
      currentModule: e.completion ? null : current?.moduleTitle ?? null,
      currentLesson: e.completion || !current ? null : { id: current.id, title: current.title, contentType: current.contentType, status: lp.get(current.id)?.status ?? "NOT_STARTED" },
      listeningPercent,
      quizzes,
      attempts: myAttempts.length,
      assignments,
      completedAt: e.completion?.completedAt ?? null,
      lastActivityAt: activity.length ? new Date(Math.max(...activity)) : null,
      certification: cert ? { name: cert.template.name, status: cert.status, certificateNumber: cert.certificateNumber } : null,
    };
  });
  const filtered = f.status ? rows.filter((r) => r.status === f.status) : rows;
  return { rows: filtered, courses: courseOptions, coaches };
}
