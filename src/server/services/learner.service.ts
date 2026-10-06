import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { ForbiddenError } from "@/server/policies/authorize";
import { priceLabel } from "@/server/views/academy.views";

/**
 * Learner dashboard (Course Builder phase 7): one card per enrolment with progress, the next lesson and where the
 * learner is on it, and the actions waiting on them. Example: "Cold Calling Mastery · 65% · Next: Gatekeeper
 * Audiobook · Listening, 45%".
 */
export type CourseCardStatus = "LOCKED" | "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
export type CourseCard = {
  courseId: string;
  title: string;
  category: string;
  status: CourseCardStatus;
  percent: number;
  requiredDone: number;
  requiredTotal: number;
  enrolledAt: Date;
  completedAt: Date | null;
  priceLabel: string;
  nextLesson: { id: string; title: string; contentType: string; detail: string } | null;
  actions: Array<{ label: string; lessonId: string | null }>;
  certification: { name: string; status: string; certificateNumber: string | null } | null;
};

const QUESTION_TYPES = new Set(["QUIZ", "ASSESSMENT", "AUDIO"]);
const TYPE_LABEL: Record<string, string> = { VIDEO: "Video", AUDIO: "Audiobook", LINK: "Link", DOCUMENT: "Document", TEXT: "Reading", QUIZ: "Quiz", ASSIGNMENT: "Assignment", ASSESSMENT: "Assessment" };

function ownProfileId(actor: Actor) {
  if (actor.role !== "AGENT" || !actor.agentProfileId) throw new ForbiddenError("Only talent have a course dashboard");
  return actor.agentProfileId;
}

export async function myCourses(db: PrismaClient, actor: Actor): Promise<{ cards: CourseCard[]; inProgress: number; completed: number; certifications: number }> {
  const profileId = ownProfileId(actor);
  const enrollments = await db.courseEnrollment.findMany({
    where: { agentProfileId: profileId },
    orderBy: { enrolledAt: "desc" },
    include: { completion: { select: { completedAt: true } }, course: { select: { id: true, title: true, category: true, priceCents: true, categoryRef: { select: { name: true } }, certificationTemplate: { select: { name: true } }, modules: { where: { status: "PUBLISHED" }, orderBy: { order: "asc" }, select: { lessons: { where: { status: "PUBLISHED" }, orderBy: { order: "asc" }, select: { id: true, title: true, contentType: true, isRequired: true, requiredPercent: true } } } } } } },
  });
  if (!enrollments.length) return { cards: [], inProgress: 0, completed: 0, certifications: 0 };
  const courseIds = enrollments.map((e) => e.courseId);
  const lessonIds = enrollments.flatMap((e) => e.course.modules.flatMap((m) => m.lessons.map((l) => l.id)));
  const [progress, courseProgress, submissions, certs] = await Promise.all([
    lessonIds.length ? db.lessonProgress.findMany({ where: { agentProfileId: profileId, lessonId: { in: lessonIds } }, select: { lessonId: true, status: true, mediaPercent: true, mediaCompletedAt: true } }) : [],
    db.courseProgress.findMany({ where: { agentProfileId: profileId, courseId: { in: courseIds } } }),
    lessonIds.length ? db.assignmentSubmission.findMany({ where: { agentProfileId: profileId, lessonId: { in: lessonIds } }, select: { lessonId: true, status: true }, orderBy: { submittedAt: "desc" } }) : [],
    db.certification.findMany({ where: { agentProfileId: profileId, courseId: { in: courseIds } }, select: { courseId: true, status: true, certificateNumber: true, template: { select: { name: true } } } }),
  ]);
  const lp = new Map(progress.map((p) => [p.lessonId, p]));
  const latestSub = new Map<string, string>();
  for (const s of submissions) if (!latestSub.has(s.lessonId)) latestSub.set(s.lessonId, s.status);

  const detailFor = (l: { id: string; contentType: string; requiredPercent: number | null }) => {
    const p = lp.get(l.id);
    const sub = latestSub.get(l.id);
    if (l.contentType === "AUDIO") {
      if (!p) return "Not started";
      if (!p.mediaCompletedAt) return `Listening, ${p.mediaPercent}%`;
      if (p.status === "RETAKE_REQUIRED" || p.status === "FAILED") return "Quiz: retake";
      if (p.status === "PENDING_REVIEW") return "Quiz awaiting review";
      return "Quiz pending";
    }
    if (l.contentType === "VIDEO") return p ? (p.mediaPercent ? `Watching, ${p.mediaPercent}%` : "In progress") : "Not started";
    if (l.contentType === "ASSIGNMENT") return sub === "SUBMITTED" ? "Awaiting review" : sub === "RETURNED" ? "Returned for changes" : "Not submitted";
    if (QUESTION_TYPES.has(l.contentType)) return p?.status === "RETAKE_REQUIRED" || p?.status === "FAILED" ? "Retake required" : p?.status === "PENDING_REVIEW" ? "Awaiting review" : p ? "In progress" : "Not started";
    return p ? "In progress" : "Not started";
  };

  const cards: CourseCard[] = enrollments.map((e) => {
    const lessons = e.course.modules.flatMap((m) => m.lessons);
    const cp = courseProgress.find((c) => c.courseId === e.courseId) ?? null;
    const required = lessons.filter((l) => l.isRequired);
    const paymentPending = e.paymentStatus === "PENDING";
    const currentId = cp?.currentLessonId ?? required.find((l) => lp.get(l.id)?.status !== "COMPLETED")?.id ?? null;
    const current = currentId ? lessons.find((l) => l.id === currentId) ?? null : null;
    const started = lessons.some((l) => lp.has(l.id) || latestSub.has(l.id));
    const status: CourseCardStatus = paymentPending ? "LOCKED" : e.completion ? "COMPLETED" : started ? "IN_PROGRESS" : "NOT_STARTED";
    const actions: CourseCard["actions"] = [];
    if (paymentPending) actions.push({ label: `Pay ${priceLabel(e.priceCents)} to Hirewise to unlock`, lessonId: null });
    for (const l of lessons) {
      const p = lp.get(l.id);
      if (p && (p.status === "RETAKE_REQUIRED" || p.status === "FAILED") && QUESTION_TYPES.has(l.contentType)) actions.push({ label: `Retake the ${l.contentType === "AUDIO" ? "audiobook quiz" : TYPE_LABEL[l.contentType].toLowerCase()}: ${l.title}`, lessonId: l.id });
      if (l.contentType === "ASSIGNMENT" && latestSub.get(l.id) === "RETURNED") actions.push({ label: `Resubmit: ${l.title}`, lessonId: l.id });
    }
    const cert = certs.find((c) => c.courseId === e.courseId) ?? null;
    return {
      courseId: e.courseId,
      title: e.course.title,
      category: e.course.categoryRef?.name ?? e.course.category,
      status,
      percent: cp?.percent ?? (e.completion ? 100 : 0),
      requiredDone: cp?.requiredDone ?? (e.completion ? required.length : 0),
      requiredTotal: cp?.requiredTotal ?? required.length,
      enrolledAt: e.enrolledAt,
      completedAt: e.completion?.completedAt ?? null,
      priceLabel: priceLabel(e.priceCents),
      nextLesson: e.completion || paymentPending || !current ? null : { id: current.id, title: current.title, contentType: TYPE_LABEL[current.contentType] ?? current.contentType, detail: detailFor(current) },
      actions,
      certification: cert ? { name: cert.template.name, status: cert.status, certificateNumber: cert.certificateNumber } : e.course.certificationTemplate ? { name: e.course.certificationTemplate.name, status: "NOT_YET", certificateNumber: null } : null,
    };
  });
  const order: Record<CourseCardStatus, number> = { IN_PROGRESS: 0, NOT_STARTED: 1, LOCKED: 2, COMPLETED: 3 };
  cards.sort((a, b) => order[a.status] - order[b.status] || b.enrolledAt.getTime() - a.enrolledAt.getTime());
  return { cards, inProgress: cards.filter((c) => c.status === "IN_PROGRESS").length, completed: cards.filter((c) => c.status === "COMPLETED").length, certifications: certs.filter((c) => c.status === "APPROVED").length };
}
