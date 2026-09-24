import type { Prisma } from "@/server/db/types";
import type { courseInclude } from "@/server/repositories/academy.repository";

type CourseRecord = Prisma.AcademyCourseGetPayload<{ include: ReturnType<typeof courseInclude> }>;
type EnrollmentRecord = { id: string; status: string; paymentStatus: string; priceCents: number; paidCents: number | null; paymentReference: string | null; paidAt: Date | null; enrolledAt: Date; completion: { completedAt: Date; examScore: number | null } | null; attempts: Array<{ id: string; status: string; scorePercent: number | null; passed: boolean | null; submittedAt: Date | null }> };

type LessonRecord = CourseRecord["modules"][number]["lessons"][number];

/** Lesson as an enrolled agent sees it: never the storage key (files are streamed through a signed URL after an enrollment check). */
function lessonAgentView(l: LessonRecord) {
  return { id: l.id, order: l.order, title: l.title, contentType: l.contentType, body: l.body, url: l.url, hasFile: !!l.storageKey, fileName: l.fileName, contentMime: l.contentMime, sizeBytes: l.sizeBytes, durationSec: l.durationSec };
}

/** Curriculum outline (titles and types only) for the catalog and locked enrolments. */
export function curriculumOutline(c: CourseRecord) {
  return c.modules.map((m) => ({ id: m.id, order: m.order, title: m.title, description: m.description, lessons: m.lessons.map((l) => ({ id: l.id, order: l.order, title: l.title, contentType: l.contentType, durationSec: l.durationSec })) }));
}

export function priceLabel(cents: number) {
  return cents === 0 ? "Free" : `USD ${(cents / 100).toFixed(2)}`;
}

/** Catalog card for agents. Syllabus and content are included only when unlocked. */
export function toCourseAgentView(c: CourseRecord, unlocked = false) {
  return {
    id: c.id,
    code: c.code,
    title: c.title,
    category: c.category,
    description: c.description,
    priceCents: c.priceCents,
    priceLabel: priceLabel(c.priceCents),
    passingScore: c.passingScore,
    certification: c.certificationTemplate ? { id: c.certificationTemplate.id, name: c.certificationTemplate.name } : null,
    coach: c.ownerCoach.email.split("@")[0],
    hasExam: !!c.exam && c.exam.status === "PUBLISHED",
    questionCount: c.exam?.questions.length ?? 0,
    syllabus: unlocked ? c.syllabus : null,
    contentUrl: unlocked ? c.contentUrl : null,
    lessonCount: c.modules.reduce((n, m) => n + m.lessons.length, 0),
    outline: curriculumOutline(c),
    modules: unlocked ? c.modules.map((m) => ({ id: m.id, order: m.order, title: m.title, description: m.description, lessons: m.lessons.map(lessonAgentView) })) : null,
    enrolledCount: c._count.enrollments,
  };
}

export function toEnrollmentAgentView(e: EnrollmentRecord) {
  return {
    id: e.id,
    status: e.status,
    paymentStatus: e.paymentStatus,
    priceCents: e.priceCents,
    priceLabel: priceLabel(e.priceCents),
    paidAt: e.paidAt,
    enrolledAt: e.enrolledAt,
    completedAt: e.completion?.completedAt ?? null,
    examScore: e.completion?.examScore ?? null,
    attempts: e.attempts.filter((a) => a.status !== "IN_PROGRESS").map((a) => ({ id: a.id, scorePercent: a.scorePercent, passed: a.passed, submittedAt: a.submittedAt })),
  };
}

/** Coach / admin view: includes the exam with correct answers. */
export function toCourseCoachView(c: CourseRecord) {
  return {
    id: c.id,
    code: c.code,
    title: c.title,
    category: c.category,
    description: c.description,
    syllabus: c.syllabus,
    contentUrl: c.contentUrl,
    priceCents: c.priceCents,
    priceLabel: priceLabel(c.priceCents),
    passingScore: c.passingScore,
    requiresCoachReview: c.requiresCoachReview,
    status: c.status,
    publishedAt: c.publishedAt,
    ownerCoach: c.ownerCoach,
    coaches: c.coaches.map((x) => x.coach),
    certificationTemplate: c.certificationTemplate,
    enrolledCount: c._count.enrollments,
    modules: c.modules.map((m) => ({ id: m.id, order: m.order, title: m.title, description: m.description, lessons: m.lessons.map((l) => ({ id: l.id, order: l.order, title: l.title, contentType: l.contentType, body: l.body, url: l.url, storageKey: l.storageKey, fileName: l.fileName, contentMime: l.contentMime, sizeBytes: l.sizeBytes, durationSec: l.durationSec })) })),
    lessonCount: c.modules.reduce((n, m) => n + m.lessons.length, 0),
    exam: c.exam ? { id: c.exam.id, title: c.exam.title, instructions: c.exam.instructions, timeLimitMin: c.exam.timeLimitMin, maxAttempts: c.exam.maxAttempts, status: c.exam.status, questions: c.exam.questions.map((q) => ({ id: q.id, order: q.order, prompt: q.prompt, options: q.options, correctIndex: q.correctIndex, points: q.points, explanation: q.explanation })) } : null,
    createdAt: c.createdAt,
  };
}
