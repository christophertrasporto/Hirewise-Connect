import type { Prisma } from "@/server/db/types";
import type { courseInclude } from "@/server/repositories/academy.repository";

type CourseRecord = Prisma.AcademyCourseGetPayload<{ include: ReturnType<typeof courseInclude> }>;
type EnrollmentRecord = { id: string; status: string; paymentStatus: string; priceCents: number; paidCents: number | null; paymentReference: string | null; paidAt: Date | null; enrolledAt: Date; completion: { completedAt: Date; examScore: number | null } | null; attempts: Array<{ id: string; status: string; scorePercent: number | null; passed: boolean | null; submittedAt: Date | null }> };

type LessonRecord = CourseRecord["modules"][number]["lessons"][number];

/** Learners only ever see published modules and published lessons. */
function visibleModules(c: CourseRecord) {
  return c.modules.filter((m) => m.status === "PUBLISHED").map((m) => ({ ...m, lessons: m.lessons.filter((l) => l.status === "PUBLISHED") }));
}

/** Lesson as an enrolled agent sees it: never the storage key (files are streamed through a signed URL after an enrollment check). */
function lessonAgentView(l: LessonRecord) {
  return { id: l.id, order: l.order, title: l.title, contentType: l.contentType, description: l.description, body: l.body, url: l.url, hasFile: !!l.storageKey, fileName: l.fileName, contentMime: l.contentMime, sizeBytes: l.sizeBytes, durationSec: l.durationSec, isRequired: l.isRequired, requiredPercent: l.requiredPercent, questionCount: l._count.questions };
}

/** Curriculum outline (titles and types only) for the catalog and locked enrolments. */
export function curriculumOutline(c: CourseRecord) {
  return visibleModules(c).map((m) => ({ id: m.id, order: m.order, title: m.title, description: m.description, lessons: m.lessons.map((l) => ({ id: l.id, order: l.order, title: l.title, contentType: l.contentType, durationSec: l.durationSec })) }));
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
    category: c.categoryRef?.name ?? c.category,
    categoryId: c.categoryId,
    difficulty: c.difficulty,
    estimatedMinutes: c.estimatedMinutes,
    isRequired: c.isRequired,
    sequentialUnlock: c.sequentialUnlock,
    displayOrder: c.displayOrder,
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
    lessonCount: visibleModules(c).reduce((n, m) => n + m.lessons.length, 0),
    outline: curriculumOutline(c),
    modules: unlocked ? visibleModules(c).map((m) => ({ id: m.id, order: m.order, title: m.title, description: m.description, isRequired: m.isRequired, lessons: m.lessons.map(lessonAgentView) })) : null,
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
    category: c.categoryRef?.name ?? c.category,
    categoryId: c.categoryId,
    difficulty: c.difficulty,
    estimatedMinutes: c.estimatedMinutes,
    isRequired: c.isRequired,
    sequentialUnlock: c.sequentialUnlock,
    displayOrder: c.displayOrder,
    description: c.description,
    syllabus: c.syllabus,
    contentUrl: c.contentUrl,
    priceCents: c.priceCents,
    priceLabel: priceLabel(c.priceCents),
    passingScore: c.passingScore,
    requiresCoachReview: c.requiresCoachReview,
    completionRequiresQuizPass: c.completionRequiresQuizPass,
    completionRequiresFinalAssessment: c.completionRequiresFinalAssessment,
    introVideoUrl: c.introVideoUrl,
    welcomeMessage: c.welcomeMessage,
    accessRules: (c.accessRules as { minVerificationLevel?: string } | null) ?? null,
    prerequisites: c.prerequisites.map((p) => ({ id: p.requires.id, title: p.requires.title })),
    status: c.status,
    publishedAt: c.publishedAt,
    ownerCoach: c.ownerCoach,
    coaches: c.coaches.map((x) => x.coach),
    certificationTemplate: c.certificationTemplate,
    enrolledCount: c._count.enrollments,
    modules: c.modules.map((m) => ({ id: m.id, order: m.order, title: m.title, description: m.description, isRequired: m.isRequired, status: m.status, lessons: m.lessons.map((l) => ({ id: l.id, order: l.order, title: l.title, contentType: l.contentType, description: l.description, body: l.body, url: l.url, storageKey: l.storageKey, fileName: l.fileName, contentMime: l.contentMime, sizeBytes: l.sizeBytes, durationSec: l.durationSec, isRequired: l.isRequired, status: l.status, version: l.version, requiredPercent: l.requiredPercent, passingScore: l.passingScore, maxAttempts: l.maxAttempts, timeLimitMin: l.timeLimitMin, randomizeCount: l.randomizeCount, shuffleAnswers: l.shuffleAnswers, showCorrectAnswers: l.showCorrectAnswers, showExplanations: l.showExplanations, retakeWaitMinutes: l.retakeWaitMinutes, scorePolicy: l.scorePolicy, reviewMode: l.reviewMode, dueAt: l.dueAt, points: l.points, submissionType: l.submissionType, questionCount: l._count.questions })) })),
    lessonCount: c.modules.reduce((n, m) => n + m.lessons.length, 0),
    exam: c.exam ? { id: c.exam.id, title: c.exam.title, instructions: c.exam.instructions, timeLimitMin: c.exam.timeLimitMin, maxAttempts: c.exam.maxAttempts, status: c.exam.status, questions: c.exam.questions.map((q) => ({ id: q.id, order: q.order, prompt: q.prompt, options: q.options, correctIndex: q.correctIndex, points: q.points, explanation: q.explanation })) } : null,
    createdAt: c.createdAt,
  };
}
