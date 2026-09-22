import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { academyRepository } from "@/server/repositories/academy.repository";
import { certificationRepository } from "@/server/repositories/certification.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { evaluateCertification } from "./certification.service";
import { toCourseAgentView, toCourseCoachView, toEnrollmentAgentView } from "@/server/views/academy.views";

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const courseSchema = z.object({
  title: z.string().trim().min(3, "Give the course a title.").max(120),
  category: z.string().trim().min(2).max(60),
  description: z.string().trim().min(20, "Describe the course in at least 20 characters.").max(2000),
  syllabus: optionalText(20000),
  contentUrl: z.string().trim().url("Enter a full URL").optional().or(z.literal("")),
  /** USD, e.g. "49.00". Empty or 0 = free. */
  priceUsd: z.string().trim().regex(/^\d{0,5}(\.\d{1,2})?$/, "Enter a price like 49 or 49.50").optional().or(z.literal("")),
  passingScore: z.coerce.number().int().min(1).max(100).default(70),
  requiresCoachReview: z.coerce.boolean().default(false),
});
export type CourseInput = z.infer<typeof courseSchema>;

export function usdToCents(v: string | undefined): number {
  if (!v) return 0;
  return Math.round(Number(v) * 100);
}

function slug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
}

/** Coach or Admin sees a course they may edit. Coaches: own or assigned courses only (INV-P5). */
async function loadEditable(db: PrismaClient, actor: Actor, courseId: string) {
  const c = await academyRepository.findCourse(db, courseId);
  if (!c) throw new NotFoundError();
  if (actor.permissions.has("course.manage")) return c;
  authorize(actor, "course.create_own");
  const mine = c.ownerCoachUserId === actor.userId || c.coaches.some((x) => x.coachUserId === actor.userId);
  if (!mine) throw new NotFoundError();
  return c;
}

// ---------------------------------------------------------------------------
// Coach: courses
// ---------------------------------------------------------------------------

export async function createCourse(db: PrismaClient, actor: Actor, input: CourseInput) {
  if (!actor.permissions.has("course.manage")) authorize(actor, "course.create_own");
  const priceCents = usdToCents(input.priceUsd || undefined);
  let code = slug(input.title) || `course-${Date.now()}`;
  if (await academyRepository.findCourseByCode(db, code)) code = `${code}-${Date.now().toString(36).slice(-4)}`;
  const course = await db.$transaction(async (tx) => {
    const c = await academyRepository.createCourse(tx, { code, title: input.title, category: input.category, description: input.description, syllabus: input.syllabus || null, contentUrl: input.contentUrl || null, ownerCoachUserId: actor.userId, priceCents, passingScore: input.passingScore, requiresCoachReview: input.requiresCoachReview });
    await audit(tx, { actor, action: "COURSE_CREATED", entityType: "AcademyCourse", entityId: c.id, newValue: { title: c.title, priceCents, currency: "USD" } });
    return c;
  });
  return course.id;
}

export async function updateCourse(db: PrismaClient, actor: Actor, courseId: string, input: CourseInput) {
  const c = await loadEditable(db, actor, courseId);
  const priceCents = usdToCents(input.priceUsd || undefined);
  await db.$transaction(async (tx) => {
    await academyRepository.updateCourse(tx, c.id, { title: input.title, category: input.category, description: input.description, syllabus: input.syllabus || null, contentUrl: input.contentUrl || null, priceCents, passingScore: input.passingScore, requiresCoachReview: input.requiresCoachReview });
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "AcademyCourse", entityId: c.id, newValue: { title: input.title, passingScore: input.passingScore } });
    if (priceCents !== c.priceCents) await audit(tx, { actor, action: "COURSE_PRICE_CHANGED", entityType: "AcademyCourse", entityId: c.id, previousValue: { priceCents: c.priceCents }, newValue: { priceCents, currency: "USD" } });
  });
}

/** Coach submits for Admin publishing. A published course being edited stays published. */
export async function submitCourseForApproval(db: PrismaClient, actor: Actor, courseId: string) {
  const c = await loadEditable(db, actor, courseId);
  if (c.status !== "DRAFT") throw new Error("Only draft courses can be submitted.");
  if (!c.exam || c.exam.questions.length === 0) throw new Error("Add an exam with at least one question before submitting.");
  await db.$transaction(async (tx) => {
    await academyRepository.setCourseStatus(tx, c.id, "PENDING_APPROVAL");
    await audit(tx, { actor, action: "COURSE_SUBMITTED", entityType: "AcademyCourse", entityId: c.id });
    await publishEvent(tx, "COURSE_SUBMITTED_FOR_APPROVAL", { courseId: c.id, title: c.title, coachUserId: c.ownerCoachUserId, priceCents: c.priceCents });
  });
}

/** Admin publishes (or archives). Linking a certification template is part of publishing (Section 4.4). */
export async function publishCourse(db: PrismaClient, actor: Actor, courseId: string, opts: { certificationTemplateId?: string | null }) {
  authorize(actor, "course.manage");
  const c = await academyRepository.findCourse(db, courseId);
  if (!c) throw new NotFoundError();
  if (!c.exam || c.exam.questions.length === 0) throw new Error("The course needs a published exam before it can go live.");
  await db.$transaction(async (tx) => {
    if (opts.certificationTemplateId !== undefined) await academyRepository.updateCourse(tx, c.id, { certificationTemplateId: opts.certificationTemplateId || null });
    if (c.exam!.status !== "PUBLISHED") await academyRepository.setExamStatus(tx, c.exam!.id, "PUBLISHED");
    await academyRepository.setCourseStatus(tx, c.id, "PUBLISHED", { publishedById: actor.userId, publishedAt: new Date() });
    await audit(tx, { actor, action: "COURSE_PUBLISHED", entityType: "AcademyCourse", entityId: c.id, newValue: { certificationTemplateId: opts.certificationTemplateId ?? c.certificationTemplateId, priceCents: c.priceCents } });
    await publishEvent(tx, "COURSE_PUBLISHED", { courseId: c.id, title: c.title, coachUserId: c.ownerCoachUserId });
  });
}

export async function archiveCourse(db: PrismaClient, actor: Actor, courseId: string) {
  authorize(actor, "course.manage");
  await db.$transaction(async (tx) => {
    await academyRepository.setCourseStatus(tx, courseId, "ARCHIVED");
    await audit(tx, { actor, action: "COURSE_ARCHIVED", entityType: "AcademyCourse", entityId: courseId });
  });
}

export async function addCoachToCourse(db: PrismaClient, actor: Actor, courseId: string, coachUserId: string) {
  authorize(actor, "course.manage");
  await academyRepository.addCoach(db, courseId, coachUserId);
}

export async function listCoursesForCoach(db: PrismaClient, actor: Actor) {
  if (actor.permissions.has("course.manage")) return (await academyRepository.listCourses(db, {})).map(toCourseCoachView);
  authorize(actor, "course.read_assigned");
  return (await academyRepository.listCourses(db, { coachUserId: actor.userId })).map(toCourseCoachView);
}

export async function getCourseForCoach(db: PrismaClient, actor: Actor, courseId: string) {
  const c = await loadEditable(db, actor, courseId);
  const enrollments = await academyRepository.listEnrollmentsForCourse(db, c.id);
  return { course: toCourseCoachView(c), enrollments: enrollments.map((e) => ({ id: e.id, agent: e.agentProfile, status: e.status, paymentStatus: e.paymentStatus, enrolledAt: e.enrolledAt, completedAt: e.completion?.completedAt ?? null, examScore: e.completion?.examScore ?? e.attempts[0]?.scorePercent ?? null })) };
}

// ---------------------------------------------------------------------------
// Coach: exams
// ---------------------------------------------------------------------------

export const examSchema = z.object({
  title: z.string().trim().min(2).max(120),
  instructions: optionalText(2000),
  timeLimitMin: z.coerce.number().int().min(5).max(240).optional().or(z.literal("")),
  maxAttempts: z.coerce.number().int().min(1).max(10).default(2),
  questions: z.array(z.object({
    prompt: z.string().trim().min(5, "Write the question.").max(1000),
    options: z.array(z.string().trim().min(1)).min(2, "At least two options.").max(6),
    correctIndex: z.coerce.number().int().min(0),
    points: z.coerce.number().int().min(1).max(20).default(1),
    explanation: optionalText(1000),
  })).min(1, "Add at least one question.").max(100),
});

export async function saveExam(db: PrismaClient, actor: Actor, courseId: string, input: z.infer<typeof examSchema>) {
  const c = await loadEditable(db, actor, courseId);
  for (const q of input.questions) if (q.correctIndex >= q.options.length) throw new Error(`Question "${q.prompt.slice(0, 40)}" marks an answer that does not exist.`);
  await db.$transaction(async (tx) => {
    const exam = await academyRepository.upsertExam(tx, c.id, { title: input.title, instructions: input.instructions || null, timeLimitMin: input.timeLimitMin === "" || input.timeLimitMin === undefined ? null : input.timeLimitMin, maxAttempts: input.maxAttempts });
    await academyRepository.replaceQuestions(tx, exam.id, input.questions.map((q) => ({ prompt: q.prompt, options: q.options, correctIndex: q.correctIndex, points: q.points, explanation: q.explanation || null })));
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "Exam", entityId: exam.id, newValue: { questions: input.questions.length, maxAttempts: input.maxAttempts } });
  });
}

// ---------------------------------------------------------------------------
// Agent: catalog, enrollment, payment, exam
// ---------------------------------------------------------------------------

function ownProfileId(actor: Actor) {
  if (actor.role !== "AGENT" || !actor.agentProfileId) throw new ForbiddenError("Only talent enrol in courses");
  return actor.agentProfileId;
}

export async function catalogForAgent(db: PrismaClient, actor: Actor) {
  const profileId = ownProfileId(actor);
  const [courses, enrollments] = await Promise.all([academyRepository.listCourses(db, { status: ["PUBLISHED"] }), academyRepository.listEnrollmentsForAgent(db, profileId)]);
  const byCourse = new Map(enrollments.map((e) => [e.courseId, e]));
  return courses.map((c) => ({ ...toCourseAgentView(c), enrollment: byCourse.has(c.id) ? toEnrollmentAgentView(byCourse.get(c.id)!) : null }));
}

export async function enrol(db: PrismaClient, actor: Actor, courseId: string) {
  const profileId = ownProfileId(actor);
  const c = await academyRepository.findCourse(db, courseId);
  if (!c || c.status !== "PUBLISHED") throw new NotFoundError();
  if (await academyRepository.findEnrollment(db, courseId, profileId)) return;
  await db.$transaction(async (tx) => {
    const e = await academyRepository.enroll(tx, { courseId, agentProfileId: profileId, priceCents: c.priceCents });
    await audit(tx, { actor, action: "COURSE_ENROLLED", entityType: "CourseEnrollment", entityId: e.id, newValue: { courseId, priceCents: c.priceCents, paymentStatus: e.paymentStatus } });
    await publishEvent(tx, "COURSE_ENROLLED", { courseId, title: c.title, agentProfileId: profileId, agentUserId: actor.userId, coachUserIds: [c.ownerCoachUserId, ...c.coaches.map((x) => x.coachUserId)], paymentRequired: c.priceCents > 0, priceCents: c.priceCents });
  });
}

export async function getEnrollmentForAgent(db: PrismaClient, actor: Actor, courseId: string) {
  const profileId = ownProfileId(actor);
  const e = await academyRepository.findEnrollment(db, courseId, profileId);
  if (!e) {
    const c = await academyRepository.findCourse(db, courseId);
    if (!c || c.status !== "PUBLISHED") throw new NotFoundError();
    return { course: toCourseAgentView(c), enrollment: null, exam: null };
  }
  const unlocked = e.paymentStatus === "NOT_REQUIRED" || e.paymentStatus === "PAID" || e.paymentStatus === "WAIVED";
  const exam = e.course.exam;
  return {
    course: toCourseAgentView(e.course, unlocked),
    enrollment: toEnrollmentAgentView(e),
    exam: exam && exam.status === "PUBLISHED" && unlocked ? { id: exam.id, title: exam.title, instructions: exam.instructions, timeLimitMin: exam.timeLimitMin, maxAttempts: exam.maxAttempts, questionCount: exam.questions.length, attemptsUsed: e.attempts.filter((a) => a.status !== "IN_PROGRESS").length, openAttemptId: e.attempts.find((a) => a.status === "IN_PROGRESS")?.id ?? null } : null,
  };
}

/** Staff records an offline payment (bank transfer, GCash) or waives it. */
export async function recordCoursePayment(db: PrismaClient, actor: Actor, enrollmentId: string, p: { paidUsd?: string; reference?: string; waived: boolean; reason?: string }) {
  authorize(actor, "course.payment.record");
  const e = await academyRepository.findEnrollmentById(db, enrollmentId);
  if (!e) throw new NotFoundError();
  if (e.paymentStatus !== "PENDING") throw new Error("This enrolment does not have a pending payment.");
  if (p.waived && !p.reason?.trim()) throw new Error("A reason is required to waive a payment.");
  const paidCents = p.waived ? null : usdToCents(p.paidUsd);
  if (!p.waived && (paidCents ?? 0) < e.priceCents) throw new Error(`Payment must cover the course price (${(e.priceCents / 100).toFixed(2)} USD).`);
  await db.$transaction(async (tx) => {
    await academyRepository.recordPayment(tx, e.id, { paidCents, paymentReference: p.reference?.trim() || null, waived: p.waived, recordedById: actor.userId });
    await audit(tx, { actor, action: "COURSE_PAYMENT_RECORDED", entityType: "CourseEnrollment", entityId: e.id, newValue: { paidCents, waived: p.waived, reference: p.reference ?? null, currency: "USD" }, reason: p.reason });
    await publishEvent(tx, "COURSE_PAYMENT_RECORDED", { enrollmentId: e.id, courseTitle: e.course.title, agentUserId: e.agentProfile.userId, agentEmail: e.agentProfile.user.email, waived: p.waived });
  });
}

export async function listPendingCoursePayments(db: PrismaClient, actor: Actor) {
  authorize(actor, "course.payment.record");
  return academyRepository.listPendingPayments(db);
}

export async function startExamAttempt(db: PrismaClient, actor: Actor, courseId: string) {
  const profileId = ownProfileId(actor);
  const e = await academyRepository.findEnrollment(db, courseId, profileId);
  if (!e) throw new NotFoundError();
  if (e.paymentStatus === "PENDING") throw new ForbiddenError("This course unlocks once Hirewise records your payment.");
  const exam = e.course.exam;
  if (!exam || exam.status !== "PUBLISHED") throw new Error("This course has no published exam yet.");
  if (e.completion) throw new Error("You have already completed this course.");
  const open = await academyRepository.openAttempt(db, e.id);
  if (open) return open.id;
  const used = await academyRepository.countAttempts(db, e.id);
  if (used >= exam.maxAttempts) throw new Error(`You have used all ${exam.maxAttempts} attempts. Ask your coach for a retake.`);
  const attempt = await academyRepository.createAttempt(db, { examId: exam.id, enrollmentId: e.id, expiresAt: exam.timeLimitMin ? new Date(Date.now() + exam.timeLimitMin * 60_000) : null });
  if (e.status === "ENROLLED") await academyRepository.setEnrollmentStatus(db, e.id, "IN_PROGRESS");
  return attempt.id;
}

/** Exam as the agent sees it: never includes correctIndex (projection). */
export async function getAttemptForAgent(db: PrismaClient, actor: Actor, attemptId: string) {
  const profileId = ownProfileId(actor);
  const a = await academyRepository.findAttempt(db, attemptId);
  if (!a || a.enrollment.agentProfileId !== profileId) throw new NotFoundError();
  return {
    id: a.id,
    status: a.status,
    courseId: a.enrollment.courseId,
    courseTitle: a.enrollment.course.title,
    examTitle: a.exam.title,
    instructions: a.exam.instructions,
    expiresAt: a.expiresAt,
    questions: a.exam.questions.map((q) => ({ id: q.id, order: q.order, prompt: q.prompt, options: q.options, points: q.points })),
    result: a.status === "SUBMITTED" ? { scorePercent: a.scorePercent, passed: a.passed } : null,
  };
}

export function gradeAttempt(questions: Array<{ id: string; correctIndex: number; points: number }>, answers: Record<string, number>): { scorePercent: number; correct: number } {
  const total = questions.reduce((s, q) => s + q.points, 0) || 1;
  let earned = 0;
  let correct = 0;
  for (const q of questions) {
    if (answers[q.id] === q.correctIndex) {
      earned += q.points;
      correct++;
    }
  }
  return { scorePercent: Math.round((earned / total) * 100), correct };
}

/** Submit answers, grade, record completion on pass, and run the certification pipeline (Section 8.7). */
export async function submitExamAttempt(db: PrismaClient, actor: Actor, attemptId: string, answers: Record<string, number>) {
  const profileId = ownProfileId(actor);
  const a = await academyRepository.findAttempt(db, attemptId);
  if (!a || a.enrollment.agentProfileId !== profileId) throw new NotFoundError();
  if (a.status !== "IN_PROGRESS") throw new Error("This attempt was already submitted.");
  const expired = !!a.expiresAt && a.expiresAt.getTime() < Date.now() - 30_000;
  const { scorePercent } = gradeAttempt(a.exam.questions, answers);
  const passed = !expired && scorePercent >= a.enrollment.course.passingScore;
  const system: Actor = { userId: "system", role: "SUPER_ADMIN", permissions: new Set() };

  const result = await db.$transaction(async (tx) => {
    await academyRepository.submitAttempt(tx, a.id, { answers, scorePercent, passed, status: expired ? "EXPIRED" : "SUBMITTED" });
    if (!passed) return { scorePercent, passed, expired, certification: null as null | { issued: boolean; reason?: string } };
    await academyRepository.createCompletion(tx, { enrollmentId: a.enrollment.id, examScore: scorePercent });
    await academyRepository.setEnrollmentStatus(tx, a.enrollment.id, "COMPLETED");
    await audit(tx, { actor, action: "COURSE_COMPLETED", entityType: "CourseEnrollment", entityId: a.enrollment.id, newValue: { courseId: a.enrollment.courseId, examScore: scorePercent } });
    const course = a.enrollment.course;
    await publishEvent(tx, "COURSE_COMPLETED", { courseId: course.id, title: course.title, agentProfileId: profileId, agentUserId: actor.userId, agentEmail: a.enrollment.agentProfile.user.email, displayName: a.enrollment.agentProfile.displayName, examScore: scorePercent, coachUserIds: [course.ownerCoachUserId, ...course.coaches.map((c) => c.coachUserId)], coachReviewRequired: course.requiresCoachReview });
    const certification = await evaluateCertification(tx, system, { agentProfileId: profileId, courseId: course.id, templateId: course.certificationTemplateId, examScore: scorePercent, assessment: null, completed: true });
    return { scorePercent, passed, expired, certification };
  });
  return result;
}

/** Signed inbound completion from an external LMS (Section 8.7). Auth is checked by the route (HMAC). */
export async function syncExternalCompletion(db: PrismaClient, p: { externalCourseId: string; agentEmail: string; examScore: number | null; externalRef: string }) {
  const course = await db.academyCourse.findUnique({ where: { externalId: p.externalCourseId }, include: { coaches: true } });
  if (!course) throw new NotFoundError("Unknown external course");
  const user = await db.user.findUnique({ where: { email: p.agentEmail }, include: { agentProfile: { select: { id: true, displayName: true } } } });
  if (!user?.agentProfile) throw new NotFoundError("Unknown agent");
  const profileId = user.agentProfile.id;
  const system: Actor = { userId: "system", role: "SUPER_ADMIN", permissions: new Set() };
  await db.$transaction(async (tx) => {
    let e = await academyRepository.findEnrollment(tx, course.id, profileId);
    if (!e) {
      await academyRepository.enroll(tx, { courseId: course.id, agentProfileId: profileId, priceCents: 0, source: "ACADEMY_SYNC" });
      e = (await academyRepository.findEnrollment(tx, course.id, profileId))!;
    }
    if (e.completion) return;
    await academyRepository.createCompletion(tx, { enrollmentId: e.id, examScore: p.examScore, source: "ACADEMY_SYNC", externalRef: p.externalRef });
    await academyRepository.setEnrollmentStatus(tx, e.id, "COMPLETED");
    await audit(tx, { actor: system, action: "COURSE_COMPLETED", entityType: "CourseEnrollment", entityId: e.id, newValue: { source: "ACADEMY_SYNC", externalRef: p.externalRef, examScore: p.examScore } });
    await publishEvent(tx, "COURSE_COMPLETED", { courseId: course.id, title: course.title, agentProfileId: profileId, agentUserId: user.id, agentEmail: user.email, displayName: user.agentProfile!.displayName, examScore: p.examScore, coachUserIds: [course.ownerCoachUserId, ...course.coaches.map((c) => c.coachUserId)], coachReviewRequired: course.requiresCoachReview });
    await evaluateCertification(tx, system, { agentProfileId: profileId, courseId: course.id, templateId: course.certificationTemplateId, examScore: p.examScore, assessment: null, completed: true });
  });
}

export async function listTemplatesForAdmin(db: PrismaClient, actor: Actor) {
  authorize(actor, "course.manage");
  return certificationRepository.templates(db, true);
}

export async function listAllCoursesForStaff(db: PrismaClient, actor: Actor) {
  authorize(actor, "course.manage");
  return (await academyRepository.listCourses(db, {})).map(toCourseCoachView);
}
