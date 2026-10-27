import { z } from "zod";
import { sourceForSelfEnrolment, accessRevoked } from "@/server/services/credential.service";
import { trainingRepository } from "@/server/repositories/training.repository";
import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { academyRepository } from "@/server/repositories/academy.repository";
import { certificationRepository } from "@/server/repositories/certification.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { evaluateCertification } from "./certification.service";
import { recordCommissionForPayment, reverseCommissionForSource } from "./commission.service";
import { toCourseAgentView, toCourseCoachView, toEnrollmentAgentView } from "@/server/views/academy.views";
import { getStorage, newStorageKey } from "@/server/adapters/storage";
import { rateLimit } from "@/server/auth/rate-limit";
import type { LessonWrite } from "@/server/repositories/academy.repository";
import { coursesLockedFor } from "./onboarding.service";
import { recalculateAllForCourse, lockedLessonsFor, assertLessonUnlocked } from "./progress.service";
import { assertCanWatchLesson, entitledToCourse } from "@/server/policies/lesson-access";
import { getEnv } from "@/server/env";
import { recordLessonVersion, changedFields } from "./lesson-version.service";
import { categoryRepository } from "@/server/repositories/category.repository";
import { assignmentRepository } from "@/server/repositories/assignment.repository";
import { toSubmissionLearnerView as toSubmissionView, type SubmissionLearnerView } from "@/server/views/academy.views";
import { coverUrlsFor, coverUrlFor } from "./course-cover";
import { COVER_MAX_BYTES, COVER_MIMES, coverKeyPrefix } from "@/lib/course-cover";

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const COURSE_DIFFICULTIES = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;

export const courseSchema = z.object({
  title: z.string().trim().min(3, "Give the course a title.").max(120),
  /** Admin-managed CourseCategory id. The legacy `category` text column is kept in sync from the category name. */
  categoryId: z.string().trim().min(1, "Choose a category."),
  description: z.string().trim().min(20, "Describe the course in at least 20 characters.").max(2000),
  difficulty: z.enum(COURSE_DIFFICULTIES).default("BEGINNER"),
  estimatedMinutes: z.coerce.number().int().min(1).max(100000).optional().or(z.literal("")),
  introVideoUrl: z.string().trim().url("Enter a full URL, including https://").optional().or(z.literal("")),
  welcomeMessage: z.string().trim().max(4000).optional().or(z.literal("")),
  syllabus: optionalText(20000),
  contentUrl: z.string().trim().url("Enter a full URL").optional().or(z.literal("")),
  /** In the course currency, e.g. "499.00". Empty or 0 = free. */
  price: z.string().trim().regex(/^\d{0,7}(\.\d{1,2})?$/, "Enter a price like 499 or 499.50").optional().or(z.literal("")),
  /** The currency the price is in. Maya Checkout takes PHP. */
  currency: z.enum(["PHP", "USD"]).optional(),
  /** Legacy USD field: used only when price is not given. */
  priceUsd: z.string().trim().regex(/^\d{0,5}(\.\d{1,2})?$/, "Enter a price like 49 or 49.50").optional().or(z.literal("")),
  passingScore: z.coerce.number().int().min(1).max(100).default(70),
  requiresCoachReview: z.coerce.boolean().default(false),
});
export type CourseInput = z.input<typeof courseSchema>;
type CourseParsed = z.infer<typeof courseSchema>;

/** Settings tab: rules that change how learners move through the course. */
export const courseSettingsSchema = z.object({
  isRequired: z.boolean().default(false),
  sequentialUnlock: z.boolean().default(false),
  completionRequiresQuizPass: z.boolean().default(true),
  completionRequiresFinalAssessment: z.boolean().default(false),
  displayOrder: z.coerce.number().int().min(0).max(100000).default(0),
  /** Course ids that must be completed first. */
  prerequisiteIds: z.array(z.string().trim().min(1)).default([]),
  /** Minimum verification level required to enrol, or empty for any talent. */
  minVerificationLevel: z.enum(["", "BASIC", "VERIFIED", "CERTIFIED", "ELITE"]).default(""),
});
export type CourseSettingsInput = z.input<typeof courseSettingsSchema>;

/** Price and currency from the form: "price" is in the chosen currency (PHP unless said otherwise); legacy "priceUsd" is USD. */
function priceFrom(input: { price?: string; priceUsd?: string; currency?: "PHP" | "USD" }): { priceCents: number; currency: "PHP" | "USD" | undefined } {
  const raw = input.price !== undefined ? input.price : input.priceUsd;
  const currency = input.currency ?? (input.price !== undefined ? "PHP" : input.priceUsd !== undefined ? "USD" : undefined);
  return { priceCents: usdToCents(raw || undefined), currency };
}

export function usdToCents(v: string | undefined): number {
  if (!v) return 0;
  return Math.round(Number(v) * 100);
}

function slug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
}

/** Coach or Admin sees a course they may edit. Coaches: own or assigned courses only (INV-P5). */
export async function loadEditableCourse(db: PrismaClient, actor: Actor, courseId: string) {
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

function publishedLessonCount(c: { modules: Array<{ status: string; lessons: Array<{ status: string }> }> }) {
  return c.modules.filter((m) => m.status === "PUBLISHED").reduce((n, m) => n + m.lessons.filter((l) => l.status === "PUBLISHED").length, 0);
}

async function categoryOrThrow(db: PrismaClient, categoryId: string) {
  const cat = await categoryRepository.findById(db, categoryId);
  if (!cat || !cat.isActive) throw new Error("Choose an active category.");
  return cat;
}

function builderFields(input: CourseParsed, categoryName: string) {
  return {
    category: categoryName,
    categoryId: input.categoryId,
    difficulty: input.difficulty,
    estimatedMinutes: input.estimatedMinutes === "" || input.estimatedMinutes === undefined ? null : input.estimatedMinutes,
    introVideoUrl: input.introVideoUrl || null,
    welcomeMessage: input.welcomeMessage || null,
  };
}

export async function createCourse(db: PrismaClient, actor: Actor, raw: CourseInput) {
  if (!actor.permissions.has("course.manage")) authorize(actor, "course.create_own");
  const input = courseSchema.parse(raw);
  const cat = await categoryOrThrow(db, input.categoryId);
  const { priceCents, currency: chosenCurrency } = priceFrom(input);
  const currency = chosenCurrency ?? "PHP";
  let code = slug(input.title) || `course-${Date.now()}`;
  if (await academyRepository.findCourseByCode(db, code)) code = `${code}-${Date.now().toString(36).slice(-4)}`;
  const course = await db.$transaction(async (tx) => {
    const c = await academyRepository.createCourse(tx, { currency, code, title: input.title, ...builderFields(input, cat.name), description: input.description, syllabus: input.syllabus || null, contentUrl: input.contentUrl || null, ownerCoachUserId: actor.userId, priceCents, passingScore: input.passingScore, requiresCoachReview: input.requiresCoachReview });
    await audit(tx, { actor, action: "COURSE_CREATED", entityType: "AcademyCourse", entityId: c.id, newValue: { title: c.title, priceCents, currency } });
    return c;
  });
  return course.id;
}

export async function updateCourse(db: PrismaClient, actor: Actor, courseId: string, raw: CourseInput) {
  const c = await loadEditableCourse(db, actor, courseId);
  const input = courseSchema.parse(raw);
  const cat = await categoryOrThrow(db, input.categoryId);
  const { priceCents, currency: chosenCurrency } = priceFrom(input);
  const currency = chosenCurrency ?? (c.currency as "PHP" | "USD");
  await db.$transaction(async (tx) => {
    await academyRepository.updateCourse(tx, c.id, { currency, title: input.title, ...builderFields(input, cat.name), description: input.description, syllabus: input.syllabus || null, contentUrl: input.contentUrl || null, priceCents, passingScore: input.passingScore, requiresCoachReview: input.requiresCoachReview });
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "AcademyCourse", entityId: c.id, newValue: { title: input.title, passingScore: input.passingScore } });
    if (priceCents !== c.priceCents || currency !== c.currency) await audit(tx, { actor, action: "COURSE_PRICE_CHANGED", entityType: "AcademyCourse", entityId: c.id, previousValue: { priceCents: c.priceCents, currency: c.currency }, newValue: { priceCents, currency } });
  });
}

/** Settings tab: completion rules, sequential unlock, prerequisites, access gate. Editable at any status. */
export async function updateCourseSettings(db: PrismaClient, actor: Actor, courseId: string, raw: CourseSettingsInput) {
  const c = await loadEditableCourse(db, actor, courseId);
  const input = courseSettingsSchema.parse(raw);
  const prereqs = [...new Set(input.prerequisiteIds)].filter((id) => id !== c.id);
  if (prereqs.length) {
    const found = await db.academyCourse.count({ where: { id: { in: prereqs } } });
    if (found !== prereqs.length) throw new NotFoundError();
  }
  await db.$transaction(async (tx) => {
    await academyRepository.updateCourse(tx, c.id, {
      isRequired: input.isRequired,
      sequentialUnlock: input.sequentialUnlock,
      completionRequiresQuizPass: input.completionRequiresQuizPass,
      completionRequiresFinalAssessment: input.completionRequiresFinalAssessment,
      displayOrder: input.displayOrder,
    });
    await tx.academyCourse.update({ where: { id: c.id }, data: { accessRules: input.minVerificationLevel ? { minVerificationLevel: input.minVerificationLevel } : undefined } });
    if (!input.minVerificationLevel) await tx.academyCourse.update({ where: { id: c.id }, data: { accessRules: { set: null } as never } }).catch(() => tx.academyCourse.update({ where: { id: c.id }, data: { accessRules: undefined } }));
    await tx.coursePrerequisite.deleteMany({ where: { courseId: c.id } });
    if (prereqs.length) await tx.coursePrerequisite.createMany({ data: prereqs.map((requiresCourseId) => ({ courseId: c.id, requiresCourseId })), skipDuplicates: true });
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "AcademyCourse", entityId: c.id, newValue: { settings: { isRequired: input.isRequired, sequentialUnlock: input.sequentialUnlock, completionRequiresQuizPass: input.completionRequiresQuizPass, completionRequiresFinalAssessment: input.completionRequiresFinalAssessment, displayOrder: input.displayOrder, prerequisites: prereqs.length, minVerificationLevel: input.minVerificationLevel || null } } });
    await recalculateAllForCourse(tx, c.id);
  });
}

export async function duplicateModule(db: PrismaClient, actor: Actor, courseId: string, moduleId: string) {
  const c = await loadEditableCourse(db, actor, courseId);
  const m = await academyRepository.findModule(db, moduleId);
  if (!m || m.courseId !== c.id) throw new NotFoundError();
  return db.$transaction(async (tx) => {
    const copy = await academyRepository.duplicateModule(tx, m.id);
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "CourseModule", entityId: copy.id, newValue: { courseId: c.id, op: "duplicate", from: m.id } });
    return copy.id;
  });
}

export async function duplicateLesson(db: PrismaClient, actor: Actor, courseId: string, lessonId: string) {
  const c = await loadEditableCourse(db, actor, courseId);
  const l = await academyRepository.findLesson(db, lessonId);
  if (!l || l.module.courseId !== c.id) throw new NotFoundError();
  return db.$transaction(async (tx) => {
    const copy = await academyRepository.duplicateLesson(tx, l.id);
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "CourseLesson", entityId: copy.id, newValue: { courseId: c.id, op: "duplicate", from: l.id } });
    return copy.id;
  });
}

/** One lesson with its questions and learner-data counts, for the lesson page (Content / Questions / Settings / Preview). */
export async function getLessonForCoach(db: PrismaClient, actor: Actor, courseId: string, lessonId: string) {
  const c = await loadEditableCourse(db, actor, courseId);
  const l = await academyRepository.findLessonFull(db, lessonId);
  if (!l || l.module.courseId !== c.id) throw new NotFoundError();
  return { course: toCourseCoachView(c), lesson: l };
}

/**
 * Coach submits for Admin publishing. Course details, curriculum, and exam stay editable at every status,
 * including PUBLISHED: edits go live immediately and the course never leaves the catalog.
 */
export async function submitCourseForApproval(db: PrismaClient, actor: Actor, courseId: string) {
  const c = await loadEditableCourse(db, actor, courseId);
  if (c.status !== "DRAFT") throw new Error("Only draft courses can be submitted.");
  if (publishedLessonCount(c) === 0) throw new Error("Add at least one published lesson in a published module before submitting.");
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
  if (publishedLessonCount(c) === 0) throw new Error("The course needs at least one published lesson before it can go live.");
  await db.$transaction(async (tx) => {
    if (opts.certificationTemplateId !== undefined) await academyRepository.updateCourse(tx, c.id, { certificationTemplateId: opts.certificationTemplateId || null });
    await academyRepository.setCourseStatus(tx, c.id, "PUBLISHED", { publishedById: actor.userId, publishedAt: new Date() });
    await audit(tx, { actor, action: "COURSE_PUBLISHED", entityType: "AcademyCourse", entityId: c.id, newValue: { certificationTemplateId: opts.certificationTemplateId ?? c.certificationTemplateId, priceCents: c.priceCents } });
    await publishEvent(tx, "COURSE_PUBLISHED", { courseId: c.id, title: c.title, coachUserId: c.ownerCoachUserId });
  });
}

/** Admin links (or clears) the certification template outside the publish step; same rule as publishing (Section 4.4). */
export async function setCourseCertificationTemplate(db: PrismaClient, actor: Actor, courseId: string, certificationTemplateId: string | null) {
  authorize(actor, "course.manage");
  const c = await academyRepository.findCourse(db, courseId);
  if (!c) throw new NotFoundError();
  if (certificationTemplateId) {
    const t = await db.certificationTemplate.findUnique({ where: { id: certificationTemplateId }, select: { id: true, isActive: true } });
    if (!t || !t.isActive) throw new Error("Choose an active certification template.");
  }
  await db.$transaction(async (tx) => {
    await academyRepository.updateCourse(tx, c.id, { certificationTemplateId });
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "AcademyCourse", entityId: c.id, previousValue: { certificationTemplateId: c.certificationTemplateId }, newValue: { certificationTemplateId } });
  });
}

export async function archiveCourse(db: PrismaClient, actor: Actor, courseId: string) {
  authorize(actor, "course.manage");
  await db.$transaction(async (tx) => {
    await academyRepository.setCourseStatus(tx, courseId, "ARCHIVED");
    await audit(tx, { actor, action: "COURSE_ARCHIVED", entityType: "AcademyCourse", entityId: courseId });
  });
}

/** Admin brings an archived course back to published (for example the free Freelancers Foundation program). */
export async function restoreCourse(db: PrismaClient, actor: Actor, courseId: string) {
  authorize(actor, "course.manage");
  const c = await academyRepository.findCourse(db, courseId);
  if (!c) throw new NotFoundError();
  if (c.status !== "ARCHIVED") throw new Error("Only an archived course can be restored.");
  if (publishedLessonCount(c) === 0) throw new Error("The course needs at least one published lesson before it can go live again.");
  await db.$transaction(async (tx) => {
    await academyRepository.setCourseStatus(tx, c.id, "PUBLISHED", { publishedById: actor.userId, publishedAt: c.publishedAt ?? new Date() });
    await audit(tx, { actor, action: "COURSE_RESTORED", entityType: "AcademyCourse", entityId: c.id, previousValue: { status: "ARCHIVED" }, newValue: { status: "PUBLISHED" } });
  });
}

export async function addCoachToCourse(db: PrismaClient, actor: Actor, courseId: string, coachUserId: string) {
  authorize(actor, "course.manage");
  await academyRepository.addCoach(db, courseId, coachUserId);
}

export async function listCoursesForCoach(db: PrismaClient, actor: Actor) {
  let rows: Awaited<ReturnType<typeof academyRepository.listCourses>>;
  if (actor.permissions.has("course.manage")) rows = await academyRepository.listCourses(db, {});
  else {
    authorize(actor, "course.read_assigned");
    rows = await academyRepository.listCourses(db, { coachUserId: actor.userId });
  }
  const covers = await coverUrlsFor(rows);
  return rows.map((c) => ({ ...toCourseCoachView(c), coverUrl: covers.get(c.id) ?? null }));
}

export async function getCourseForCoach(db: PrismaClient, actor: Actor, courseId: string) {
  const c = await loadEditableCourse(db, actor, courseId);
  const enrollments = await academyRepository.listEnrollmentsForCourse(db, c.id);
  return { course: { ...toCourseCoachView(c), coverUrl: await coverUrlFor(c) }, enrollments: enrollments.map((e) => ({ id: e.id, agent: e.agentProfile, status: e.status, paymentStatus: e.paymentStatus, enrolledAt: e.enrolledAt, completedAt: e.completion?.completedAt ?? null, examScore: e.completion?.examScore ?? e.attempts[0]?.scorePercent ?? null })) };
}

// ---------------------------------------------------------------------------
// Coach: curriculum (modules and lessons). Editable at any status, including PUBLISHED.
// ---------------------------------------------------------------------------

export const LESSON_CONTENT_TYPES = ["VIDEO", "AUDIO", "LINK", "DOCUMENT", "TEXT", "QUIZ", "ASSIGNMENT", "ASSESSMENT"] as const;
export type LessonContentType = (typeof LESSON_CONTENT_TYPES)[number];

/** Upload categories for lesson files: MIME allowlist and size caps (Section 12, security baseline). */
export const LESSON_UPLOAD_RULES = {
  VIDEO: { maxBytes: 500 * 1024 * 1024, mimes: { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" } },
  AUDIO: { maxBytes: 100 * 1024 * 1024, mimes: { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/webm": "webm", "audio/ogg": "ogg" } },
  DOCUMENT: { maxBytes: 50 * 1024 * 1024, mimes: { "application/pdf": "pdf", "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "application/vnd.ms-powerpoint": "ppt", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx", "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx", "text/plain": "txt", "text/csv": "csv" } },
} as const;
export type LessonUploadKind = keyof typeof LESSON_UPLOAD_RULES;

export const lessonUploadRequestSchema = z.object({
  kind: z.enum(["VIDEO", "AUDIO", "DOCUMENT"]),
  contentType: z.string().min(1),
  sizeBytes: z.coerce.number().int().positive(),
  fileName: z.string().trim().max(200).optional(),
});

export const moduleSchema = z.object({
  id: z.string().trim().min(1).optional(),
  title: z.string().trim().min(2, "Give the module a title.").max(120),
  description: optionalText(1000),
  isRequired: z.boolean().default(true),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("PUBLISHED"),
});
export type ModuleInput = z.input<typeof moduleSchema>;

const optionalInt = z.coerce.number().int().nonnegative().optional().or(z.literal(""));

export const lessonSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    moduleId: z.string().trim().min(1, "Pick a module."),
    title: z.string().trim().min(2, "Give the lesson a title.").max(160),
    contentType: z.enum(LESSON_CONTENT_TYPES),
    /** Markdown for TEXT lessons; optional notes shown under other lesson types. */
    body: optionalText(50000),
    url: z.string().trim().url("Enter a full URL, including https://").optional().or(z.literal("")),
    storageKey: z.string().trim().max(300).optional().or(z.literal("")),
    fileName: optionalText(200),
    contentMime: optionalText(120),
    sizeBytes: optionalInt,
    durationSec: optionalInt,
    description: optionalText(2000),
    isRequired: z.boolean().default(true),
    status: z.enum(["DRAFT", "PUBLISHED"]).default("PUBLISHED"),
    /** Anyone can watch it without an account while it is published. New lessons are gated unless this is set. */
    isFreePreview: z.boolean().default(false),
    /** Audio / video: share of the media that must actually be played. */
    requiredPercent: z.coerce.number().int().min(1).max(100).optional().or(z.literal("")),
    // Quiz, assessment, and audiobook-quiz settings
    passingScore: z.coerce.number().int().min(1).max(100).optional().or(z.literal("")),
    maxAttempts: z.coerce.number().int().min(1).max(100).optional().or(z.literal("")),
    timeLimitMin: z.coerce.number().int().min(1).max(600).optional().or(z.literal("")),
    randomizeCount: z.coerce.number().int().min(1).max(500).optional().or(z.literal("")),
    shuffleAnswers: z.boolean().default(false),
    showCorrectAnswers: z.boolean().default(true),
    showExplanations: z.boolean().default(true),
    retakeWaitMinutes: z.coerce.number().int().min(0).max(100000).optional().or(z.literal("")),
    scorePolicy: z.enum(["HIGHEST", "LATEST"]).default("HIGHEST"),
    reviewMode: z.enum(["AUTO", "MANUAL", "BOTH"]).default("AUTO"),
    // Assignment settings
    dueAt: z.string().trim().optional().or(z.literal("")),
    points: z.coerce.number().int().min(0).max(10000).optional().or(z.literal("")),
    submissionType: z.enum(["", "TEXT", "URL", "DOCUMENT", "OTHER"]).default(""),
  })
  .superRefine((v, ctx) => {
    const has = (x: string | number | undefined) => x !== undefined && x !== "";
    if ((v.contentType === "QUIZ" || v.contentType === "ASSESSMENT") && !has(v.passingScore)) ctx.addIssue({ code: "custom", path: ["passingScore"], message: "Set a passing score." });
    if (v.contentType === "ASSIGNMENT" && !v.submissionType) ctx.addIssue({ code: "custom", path: ["submissionType"], message: "Choose how learners submit." });
    if (v.contentType === "ASSIGNMENT" && v.dueAt && Number.isNaN(new Date(v.dueAt).getTime())) ctx.addIssue({ code: "custom", path: ["dueAt"], message: "Enter the due date as YYYY-MM-DD." });
    if (v.contentType === "TEXT" && !has(v.body)) ctx.addIssue({ code: "custom", path: ["body"], message: "Write the lesson content." });
    if (v.contentType === "LINK" && !has(v.url)) ctx.addIssue({ code: "custom", path: ["url"], message: "Enter the link." });
    if (v.contentType === "VIDEO" && !has(v.url) && !has(v.storageKey)) ctx.addIssue({ code: "custom", path: ["url"], message: "Upload a video file or paste a video URL." });
    if ((v.contentType === "AUDIO" || v.contentType === "DOCUMENT") && !has(v.storageKey)) ctx.addIssue({ code: "custom", path: ["storageKey"], message: v.contentType === "AUDIO" ? "Upload an audio file." : "Upload a document." });
  });
export type LessonInput = z.input<typeof lessonSchema>;
type LessonParsed = z.infer<typeof lessonSchema>;

function lessonKeyPrefix(courseId: string) {
  return `courses/${courseId}/lessons/`;
}

/** Step 1 of a lesson file upload: a presigned PUT scoped to the course. Nothing is recorded until saveLesson. */
export async function createLessonUploadUrl(db: PrismaClient, actor: Actor, courseId: string, raw: z.infer<typeof lessonUploadRequestSchema>) {
  const c = await loadEditableCourse(db, actor, courseId);
  const input = lessonUploadRequestSchema.parse(raw);
  if ((input.kind === "AUDIO" || input.kind === "VIDEO") && !actor.permissions.has("course.manage")) authorize(actor, "course.audio.upload");
  rateLimit(`lesson-upload:${actor.userId}`, 60, 60 * 60_000);
  const rule = LESSON_UPLOAD_RULES[input.kind];
  const ext = (rule.mimes as Record<string, string>)[input.contentType];
  if (!ext) throw new Error(`Unsupported file type for a ${input.kind.toLowerCase()} lesson: ${input.contentType}`);
  if (input.sizeBytes > rule.maxBytes) throw new Error(`File is too large. Maximum for ${input.kind.toLowerCase()} is ${Math.round(rule.maxBytes / 1024 / 1024)} MB.`);
  const key = newStorageKey(`${lessonKeyPrefix(c.id)}${input.kind.toLowerCase()}`, ext);
  const upload = await getStorage().createUploadUrl(key, input.contentType);
  return { key, ...upload };
}

export const coverUploadRequestSchema = z.object({
  contentType: z.string().min(1),
  sizeBytes: z.coerce.number().int().positive(),
});

/** Step 1 of a cover upload: a presigned PUT scoped to the course. Nothing is recorded until setCourseCover. */
export async function createCourseCoverUploadUrl(db: PrismaClient, actor: Actor, courseId: string, raw: z.input<typeof coverUploadRequestSchema>) {
  const c = await loadEditableCourse(db, actor, courseId);
  const input = coverUploadRequestSchema.parse(raw);
  rateLimit(`course-cover:${actor.userId}`, 30, 60 * 60_000);
  const ext = (COVER_MIMES as Record<string, string>)[input.contentType];
  if (!ext) throw new Error("Use a PNG, JPG, or WebP image.");
  if (input.sizeBytes > COVER_MAX_BYTES) throw new Error(`The image is too large. Maximum is ${Math.round(COVER_MAX_BYTES / 1024 / 1024)} MB.`);
  const key = newStorageKey(coverKeyPrefix(c.id).replace(/\/$/, ""), ext);
  const upload = await getStorage().createUploadUrl(key, input.contentType);
  return { key, ...upload };
}

/** Step 2: record the uploaded key as the course cover, or clear it with null. The previous object is removed. */
export async function setCourseCover(db: PrismaClient, actor: Actor, courseId: string, key: string | null) {
  const c = await loadEditableCourse(db, actor, courseId);
  if (key !== null) {
    if (!key.startsWith(coverKeyPrefix(c.id))) throw new Error("That file does not belong to this course.");
    if (!(await getStorage().exists(key))) throw new Error("Upload the image before saving it.");
  }
  const previous = c.thumbnailKey;
  await db.$transaction(async (tx) => {
    await academyRepository.updateCourse(tx, c.id, { thumbnailKey: key });
    await audit(tx, { actor, action: "COURSE_COVER_SET", entityType: "AcademyCourse", entityId: c.id, newValue: { hasCover: key !== null } });
  });
  if (previous && previous !== key) await getStorage().delete(previous).catch(() => undefined);
  return { coverUrl: key ? await coverUrlFor({ id: c.id, thumbnailKey: key }) : null };
}

async function moduleOf(db: Db, courseId: string, moduleId: string) {
  const m = await academyRepository.findModule(db, moduleId);
  if (!m || m.courseId !== courseId) throw new NotFoundError();
  return m;
}

export async function saveModule(db: PrismaClient, actor: Actor, courseId: string, raw: ModuleInput) {
  const c = await loadEditableCourse(db, actor, courseId);
  const input = moduleSchema.parse(raw);
  const data = { title: input.title, description: input.description || null, isRequired: input.isRequired, status: input.status };
  return db.$transaction(async (tx) => {
    let id: string;
    if (input.id) {
      // Inside the transaction every query must use tx: production runs with connection_limit=1 behind the pooler,
      // so a query on the pooled client here would wait for the connection the transaction holds and time out.
      await moduleOf(tx, c.id, input.id);
      id = (await academyRepository.updateModule(tx, input.id, data)).id;
    } else {
      id = (await academyRepository.createModule(tx, c.id, data)).id;
    }
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "CourseModule", entityId: id, newValue: { courseId: c.id, title: input.title, op: input.id ? "update" : "create" } });
    await recalculateAllForCourse(tx, c.id);
    return id;
  });
}

export async function deleteModule(db: PrismaClient, actor: Actor, courseId: string, moduleId: string) {
  const c = await loadEditableCourse(db, actor, courseId);
  const m = await moduleOf(db, c.id, moduleId);
  await db.$transaction(async (tx) => {
    await academyRepository.deleteModule(tx, m.id);
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "CourseModule", entityId: m.id, previousValue: { title: m.title, lessons: m.lessons.length }, newValue: { courseId: c.id, op: "delete" } });
    await recalculateAllForCourse(tx, c.id);
  });
}

export async function moveModule(db: PrismaClient, actor: Actor, courseId: string, moduleId: string, direction: -1 | 1) {
  const c = await loadEditableCourse(db, actor, courseId);
  const modules = await academyRepository.listModules(db, c.id);
  const i = modules.findIndex((m) => m.id === moduleId);
  if (i < 0) throw new NotFoundError();
  const j = i + direction;
  if (j < 0 || j >= modules.length) return;
  await db.$transaction((tx) => academyRepository.swapModuleOrder(tx, modules[i], modules[j]));
}

/** Clears the fields that do not apply to the chosen content type so a lesson has exactly one source. */
const QUESTION_TYPES: ReadonlyArray<LessonContentType> = ["QUIZ", "ASSESSMENT", "AUDIO"];
const MEDIA_TYPES: ReadonlyArray<LessonContentType> = ["VIDEO", "AUDIO"];

/** Lesson type drives which fields are stored; everything irrelevant to the type is cleared. */
function normaliseLesson(input: LessonParsed): LessonWrite {
  const num = (x: number | "" | undefined) => (x === undefined || x === "" ? null : x);
  const t = input.contentType;
  const file = t === "AUDIO" || t === "DOCUMENT" || (t === "VIDEO" && !!input.storageKey);
  const quiz = QUESTION_TYPES.includes(t);
  return {
    title: input.title,
    contentType: t,
    description: input.description || null,
    body: input.body || null,
    url: t === "LINK" || (t === "VIDEO" && !file) ? input.url || null : null,
    storageKey: file ? input.storageKey || null : null,
    fileName: file ? input.fileName || null : null,
    contentMime: file ? input.contentMime || null : null,
    sizeBytes: file ? num(input.sizeBytes) : null,
    durationSec: MEDIA_TYPES.includes(t) ? num(input.durationSec) : null,
    isRequired: input.isRequired,
    status: input.status,
    isFreePreview: input.isFreePreview,
    requiredPercent: MEDIA_TYPES.includes(t) ? (num(input.requiredPercent) ?? 90) : null,
    passingScore: quiz ? num(input.passingScore) : null,
    maxAttempts: quiz ? num(input.maxAttempts) : null,
    timeLimitMin: quiz ? num(input.timeLimitMin) : null,
    randomizeCount: quiz ? num(input.randomizeCount) : null,
    shuffleAnswers: quiz ? input.shuffleAnswers : false,
    showCorrectAnswers: quiz ? input.showCorrectAnswers : true,
    showExplanations: quiz ? input.showExplanations : true,
    retakeWaitMinutes: quiz ? num(input.retakeWaitMinutes) : null,
    scorePolicy: input.scorePolicy,
    reviewMode: t === "ASSESSMENT" ? input.reviewMode : "AUTO",
    dueAt: t === "ASSIGNMENT" && input.dueAt ? new Date(`${input.dueAt}T23:59:59.999Z`) : null,
    points: t === "ASSIGNMENT" ? num(input.points) : null,
    submissionType: t === "ASSIGNMENT" && input.submissionType ? input.submissionType : null,
  };
}

/** Sentinel the editor posts to keep the currently stored file when a lesson is edited without a new upload. */
export const KEEP_FILE = "__keep__";

export async function saveLesson(db: PrismaClient, actor: Actor, courseId: string, raw: LessonInput) {
  const c = await loadEditableCourse(db, actor, courseId);
  let input = lessonSchema.parse(raw);
  await moduleOf(db, c.id, input.moduleId);
  if (input.storageKey === KEEP_FILE) {
    const prev = input.id ? await academyRepository.findLesson(db, input.id) : null;
    if (!prev || prev.module.courseId !== c.id) throw new NotFoundError();
    input = { ...input, storageKey: prev.storageKey ?? "", fileName: prev.fileName ?? "", contentMime: prev.contentMime ?? "", sizeBytes: prev.sizeBytes ?? "", durationSec: input.durationSec || (prev.durationSec ?? "") };
  }
  const data = normaliseLesson(input);
  if (data.isFreePreview && ["QUIZ", "ASSIGNMENT", "ASSESSMENT"].includes(data.contentType)) {
    throw Object.assign(new Error("Quizzes, assignments, and assessments need an account and cannot be free previews."), { name: "AuthError", field: "isFreePreview" });
  }
  // A gated video is only protected when it is an upload we sign; a YouTube, Vimeo, or Loom link is public by nature.
  if (data.contentType === "VIDEO" && data.url && !data.isFreePreview) {
    throw Object.assign(new Error("A video that is not a free preview must be uploaded as a file. Links to YouTube, Vimeo, or Loom cannot be protected."), { name: "AuthError", field: "url" });
  }
  if (data.storageKey) {
    if (!data.storageKey.startsWith(lessonKeyPrefix(c.id))) throw new ForbiddenError("Storage key does not belong to this course");
    const existing = input.id ? await academyRepository.findLesson(db, input.id) : null;
    if (existing?.storageKey !== data.storageKey && !(await getStorage().exists(data.storageKey))) throw new Error("The file was not uploaded. Try again.");
  }
  return db.$transaction(async (tx) => {
    let id: string;
    if (input.id) {
      const l = await academyRepository.findLesson(tx, input.id);
      if (!l || l.module.courseId !== c.id) throw new NotFoundError();
      // Significant edits freeze the previous state (phase 8); cosmetic ones (description, reveal flags) do not.
      const changed = changedFields(l, data);
      if (changed.length) await recordLessonVersion(tx, l.id, actor, `Changed ${changed.join(", ")}`);
      id = (await academyRepository.updateLesson(tx, l.id, input.moduleId, data)).id;
    } else {
      id = (await academyRepository.createLesson(tx, input.moduleId, data)).id;
    }
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "CourseLesson", entityId: id, newValue: { courseId: c.id, moduleId: input.moduleId, title: data.title, contentType: data.contentType, op: input.id ? "update" : "create" } });
    await recalculateAllForCourse(tx, c.id);
    return id;
  });
}

export async function deleteLesson(db: PrismaClient, actor: Actor, courseId: string, lessonId: string) {
  const c = await loadEditableCourse(db, actor, courseId);
  const l = await academyRepository.findLesson(db, lessonId);
  if (!l || l.module.courseId !== c.id) throw new NotFoundError();
  await db.$transaction(async (tx) => {
    await academyRepository.deleteLesson(tx, l.id);
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "CourseLesson", entityId: l.id, previousValue: { title: l.title, contentType: l.contentType }, newValue: { courseId: c.id, op: "delete" } });
    await recalculateAllForCourse(tx, c.id);
  });
}

/**
 * Puts a module's lessons in the given order (drag and drop). The ids must be exactly the module's lessons. Order only:
 * which lessons are free previews never changes with position, so reordering unlocks nothing.
 */
export async function reorderLessons(db: PrismaClient, actor: Actor, courseId: string, moduleId: string, orderedIds: string[]) {
  const c = await loadEditableCourse(db, actor, courseId);
  const m = await moduleOf(db, c.id, moduleId);
  const current = m.lessons.map((l) => l.id);
  if (orderedIds.length !== current.length || new Set(orderedIds).size !== orderedIds.length || !orderedIds.every((id) => current.includes(id))) throw new Error("The lesson list changed. Reload and try again.");
  if (orderedIds.every((id, i) => id === current[i])) return;
  await db.$transaction(async (tx) => {
    await academyRepository.setLessonOrder(tx, orderedIds);
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "CourseModule", entityId: m.id, newValue: { courseId: c.id, op: "reorder-lessons", order: orderedIds } });
  });
}

/** Non-blocking notes shown to the admin on the builder: a course people can buy should have something free to try. */
export function courseWarnings(c: { status: string; modules: Array<{ status: string; lessons: Array<{ status: string; isFreePreview: boolean }> }> }): string[] {
  const warnings: string[] = [];
  const hasPreview = c.modules.some((m) => m.status === "PUBLISHED" && m.lessons.some((l) => l.status === "PUBLISHED" && l.isFreePreview));
  if (c.status !== "ARCHIVED" && !hasPreview) {
    warnings.push(
      c.status === "PUBLISHED"
        ? "This published course has no free-preview lesson, so visitors have nothing to try before buying. Mark a published lesson as a free preview."
        : "No free-preview lesson yet. Mark a published lesson as a free preview before this course goes live, so visitors can try it before buying.",
    );
  }
  return warnings;
}

export async function moveLesson(db: PrismaClient, actor: Actor, courseId: string, lessonId: string, direction: -1 | 1) {
  const c = await loadEditableCourse(db, actor, courseId);
  const l = await academyRepository.findLesson(db, lessonId);
  if (!l || l.module.courseId !== c.id) throw new NotFoundError();
  const m = await moduleOf(db, c.id, l.moduleId);
  const i = m.lessons.findIndex((x) => x.id === lessonId);
  const j = i + direction;
  if (j < 0 || j >= m.lessons.length) return;
  await db.$transaction((tx) => academyRepository.swapLessonOrder(tx, m.lessons[i], m.lessons[j]));
}

/**
 * Signed URL for an uploaded lesson file, issued only after the shared access rule (`canWatchLesson`) passes: a published
 * free preview (anyone, signed in or not), an owner of the course, or staff who manage it. A gated lesson never has a
 * public or permanent URL; video links last `LESSON_VIDEO_URL_TTL_SECONDS` (two hours by default), other files the
 * shorter `SIGNED_URL_TTL_SECONDS`. Unpublished lessons are NotFound for everyone but staff; a published gated lesson
 * throws `LessonAccessError` (401 signed out, 403 signed in without the course).
 */
export async function lessonDownloadUrl(db: PrismaClient, actor: Actor | null, lessonId: string): Promise<string> {
  const access = await assertCanWatchLesson(db, actor, lessonId);
  const l = await academyRepository.findLesson(db, lessonId);
  if (!l?.storageKey) throw new NotFoundError();
  // An owner whose course is sequentially locked gets nothing yet; previews and staff skip the sequence.
  if (actor?.role === "AGENT" && actor.agentProfileId && !access.isFreePreview) await assertLessonUnlocked(db, l, actor.agentProfileId);
  const ttl = l.contentType === "VIDEO" ? getEnv().LESSON_VIDEO_URL_TTL_SECONDS : undefined;
  return getStorage().createDownloadUrl(l.storageKey, ttl);
}

// ---------------------------------------------------------------------------
// Agent: catalog, enrollment, payment, exam
// ---------------------------------------------------------------------------

function ownProfileId(actor: Actor) {
  if (actor.role !== "AGENT" || !actor.agentProfileId) throw new ForbiddenError("Only talent enrol in courses");
  return actor.agentProfileId;
}

/** Catalog with enrolment state. While the onboarding welcome video is outstanding, un-enrolled courses are marked locked. */
export async function catalogForAgent(db: PrismaClient, actor: Actor) {
  const profileId = ownProfileId(actor);
  const [courses, enrollments, lock] = await Promise.all([academyRepository.listCourses(db, { status: ["PUBLISHED"] }), academyRepository.listEnrollmentsForAgent(db, profileId), coursesLockedFor(db, actor)]);
  const byCourse = new Map(enrollments.map((e) => [e.courseId, e]));
  const covers = await coverUrlsFor(courses);
  return courses.map((c) => {
    const enrollment = byCourse.has(c.id) ? toEnrollmentAgentView(byCourse.get(c.id)!) : null;
    return { ...toCourseAgentView(c), coverUrl: covers.get(c.id) ?? null, enrollment, locked: lock.locked && !enrollment, lockReason: lock.locked && !enrollment ? lock.reason : null };
  });
}

/** The onboarding lock as a banner payload for Academy pages. */
export function academyLockFor(db: PrismaClient, actor: Actor) {
  return coursesLockedFor(db, actor);
}

export async function enrol(db: PrismaClient, actor: Actor, courseId: string) {
  const profileId = ownProfileId(actor);
  const c = await academyRepository.findCourse(db, courseId);
  if (!c || c.status !== "PUBLISHED") throw new NotFoundError();
  if (await academyRepository.findEnrollment(db, courseId, profileId)) return;
  const lock = await coursesLockedFor(db, actor);
  if (lock.locked) throw new ForbiddenError(lock.reason ?? "Finish your onboarding checklist before enrolling.");
  await db.$transaction(async (tx) => {
    const e = await academyRepository.enroll(tx, { currency: c.currency, courseId, agentProfileId: profileId, priceCents: c.priceCents, credentialSource: sourceForSelfEnrolment(c.priceCents) });
    await audit(tx, { actor, action: "COURSE_ENROLLED", entityType: "CourseEnrollment", entityId: e.id, newValue: { courseId, priceCents: c.priceCents, paymentStatus: e.paymentStatus, credentialSource: e.credentialSource } });
    await publishEvent(tx, "COURSE_ENROLLED", { courseId, title: c.title, agentProfileId: profileId, agentUserId: actor.userId, coachUserIds: [c.ownerCoachUserId, ...c.coaches.map((x) => x.coachUserId)], paymentRequired: c.priceCents > 0, priceCents: c.priceCents });
  });
}

/** Per-lesson learner state shown on the course page; the audio player resumes from lastPositionSec. */
export type LessonProgressMap = Record<string, { status: string; completedAt: Date | null; mediaPercent: number; lastPositionSec: number; mediaCompletedAt: Date | null }>;

export async function getEnrollmentForAgent(db: PrismaClient, actor: Actor, courseId: string) {
  const profileId = ownProfileId(actor);
  const e = await academyRepository.findEnrollment(db, courseId, profileId);
  if (!e) {
    const c = await academyRepository.findCourse(db, courseId);
    if (!c || c.status !== "PUBLISHED") throw new NotFoundError();
    const lock = await coursesLockedFor(db, actor);
    return { course: { ...toCourseAgentView(c), coverUrl: await coverUrlFor(c) }, enrollment: null, lessonProgress: {} as LessonProgressMap, submissions: {} as Record<string, SubmissionLearnerView>, lockedLessons: {} as Record<string, string>, courseProgress: null, locked: lock.locked ? { kind: "ONBOARDING" as const, reason: lock.reason ?? "Finish your onboarding checklist first.", href: "/onboarding/welcome-video" } : null };
  }
  // v2 phase 4: agency-sponsored access ends with the membership.
  const revoked = accessRevoked(e);
  const unlocked = entitledToCourse(e);
  const lessonIds = e.course.modules.flatMap((m) => m.lessons.map((l) => l.id));
  const progressRows = unlocked && lessonIds.length ? await db.lessonProgress.findMany({ where: { agentProfileId: profileId, lessonId: { in: lessonIds } } }) : [];
  const courseProgress = await db.courseProgress.findUnique({ where: { courseId_agentProfileId: { courseId: e.courseId, agentProfileId: profileId } } });
  const lockedLessons = unlocked ? await lockedLessonsFor(db, e.courseId, profileId) : {};
  const assignmentIds = unlocked ? e.course.modules.flatMap((m) => m.lessons.filter((l) => l.contentType === "ASSIGNMENT").map((l) => l.id)) : [];
  const submissions = Object.fromEntries((await assignmentRepository.latestByLesson(db, assignmentIds, profileId)).map((s) => [s.lessonId, toSubmissionView(s)])) as Record<string, SubmissionLearnerView>;
  return {
    submissions,
    lockedLessons,
    locked: revoked ? { kind: "REVOKED" as const, reason: e.revokeReason ?? "Access to this course ended with your agency membership.", href: "/courses" } : (null as null | { kind: "ONBOARDING" | "REVOKED"; reason: string; href: string }),
    course: { ...toCourseAgentView(e.course, unlocked), coverUrl: await coverUrlFor(e.course) },
    enrollment: toEnrollmentAgentView(e),
    lessonProgress: Object.fromEntries(progressRows.map((p) => [p.lessonId, { status: p.status, completedAt: p.completedAt, mediaPercent: p.mediaPercent, lastPositionSec: p.lastPositionSec, mediaCompletedAt: p.mediaCompletedAt }])) as LessonProgressMap,
    courseProgress: courseProgress ? { percent: courseProgress.percent, requiredDone: courseProgress.requiredDone, requiredTotal: courseProgress.requiredTotal } : null,
  };
}

/** Staff records an offline payment (bank transfer, GCash) or waives it. */
type EnrollmentForPayment = NonNullable<Awaited<ReturnType<typeof academyRepository.findEnrollmentById>>>;

/**
 * The one place an enrolment becomes paid or waived, whoever confirmed it: staff recording an offline payment, or a
 * verified online payment (Maya). Marks it once, then handles the credential source, the referral commission, the
 * audit entry, and the learner's notification, all inside the caller's transaction.
 */
export async function settleEnrollmentPaymentTx(tx: Db, actor: Actor, e: EnrollmentForPayment, p: { paidCents: number | null; reference: string | null; waived: boolean; reason?: string; recordedById: string | null; channel: "STAFF" | "MAYA" }) {
  const changed = await academyRepository.recordPaymentIfPending(tx, e.id, { paidCents: p.paidCents, paymentReference: p.reference, waived: p.waived, recordedById: p.recordedById });
  if (changed !== 1) throw new Error("This enrolment does not have a pending payment.");
  // v2 phase 4: a waived payment is a Hirewise assignment, not an independent purchase.
  if (p.waived) await trainingRepository.setEnrollmentSource(tx, e.id, "ADMIN_ASSIGNMENT");
  // Referral program: the confirmed payment is the only moment a commission can be created (idempotent per enrolment).
  else await recordCommissionForPayment(tx, { sourceType: "ENROLLMENT", sourceId: e.id, buyerUserId: e.agentProfile.userId, courseId: e.courseId, courseTitle: e.course.title, paidMinor: p.paidCents ?? 0, listMinor: e.priceCents, currency: e.currency, paidAt: new Date() });
  await audit(tx, { actor, action: "COURSE_PAYMENT_RECORDED", entityType: "CourseEnrollment", entityId: e.id, newValue: { paidCents: p.paidCents, waived: p.waived, reference: p.reference, currency: e.currency, channel: p.channel }, reason: p.reason });
  await publishEvent(tx, "COURSE_PAYMENT_RECORDED", { enrollmentId: e.id, courseTitle: e.course.title, agentUserId: e.agentProfile.userId, agentEmail: e.agentProfile.user.email, waived: p.waived });
}

export async function recordCoursePayment(db: PrismaClient, actor: Actor, enrollmentId: string, p: { paid?: string; /** Legacy name for paid. */ paidUsd?: string; reference?: string; waived: boolean; reason?: string }) {
  authorize(actor, "course.payment.record");
  const e = await academyRepository.findEnrollmentById(db, enrollmentId);
  if (!e) throw new NotFoundError();
  if (e.paymentStatus !== "PENDING") throw new Error("This enrolment does not have a pending payment.");
  if (p.waived && !p.reason?.trim()) throw new Error("A reason is required to waive a payment.");
  const paidCents = p.waived ? null : usdToCents(p.paid ?? p.paidUsd);
  if (!p.waived && (paidCents ?? 0) < e.priceCents) throw new Error(`Payment must cover the course price (${(e.priceCents / 100).toFixed(2)} ${e.currency}).`);
  await db.$transaction(async (tx) => {
    await settleEnrollmentPaymentTx(tx, actor, e, { paidCents, reference: p.reference?.trim() || null, waived: p.waived, reason: p.reason, recordedById: actor.userId, channel: "STAFF" });
  });
}

export const refundSchema = z.object({
  kind: z.enum(["REFUND", "CHARGEBACK"]),
  reason: z.string().trim().min(3, "Say why the money went back.").max(500),
});

/** Staff records that a paid enrolment was refunded or charged back: access ends and any commission is reversed. */
export async function recordCourseRefund(db: PrismaClient, actor: Actor, enrollmentId: string, raw: z.input<typeof refundSchema>) {
  authorize(actor, "course.payment.record");
  const input = refundSchema.parse(raw);
  const e = await academyRepository.findEnrollmentById(db, enrollmentId);
  if (!e) throw new NotFoundError();
  if (e.paymentStatus !== "PAID") throw new Error("Only a paid enrolment can be refunded.");
  await db.$transaction(async (tx) => {
    const changed = await academyRepository.refundEnrollment(tx, e.id, { kind: input.kind, reason: input.reason, completed: e.status === "COMPLETED" });
    if (changed !== 1) throw new Error("This enrolment was already refunded.");
    const reversal = await reverseCommissionForSource(tx, actor, { sourceType: "ENROLLMENT", sourceId: e.id, reason: `${input.kind.toLowerCase()}: ${input.reason}` });
    await audit(tx, { actor, action: "COURSE_PAYMENT_REFUNDED", entityType: "CourseEnrollment", entityId: e.id, previousValue: { paymentStatus: "PAID" }, newValue: { paymentStatus: "REFUNDED", kind: input.kind, commissionReversed: reversal.reversed }, reason: input.reason });
  });
}

export async function listRecentPaidEnrollments(db: PrismaClient, actor: Actor) {
  authorize(actor, "course.payment.record");
  return academyRepository.listRecentPaid(db);
}

export async function listPendingCoursePayments(db: PrismaClient, actor: Actor) {
  authorize(actor, "course.payment.record");
  return academyRepository.listPendingPayments(db);
}

/** Signed inbound completion from an external LMS (Section 8.7). Auth is checked by the route (HMAC). */
export async function syncExternalCompletion(db: PrismaClient, p: { externalCourseId: string; agentEmail: string; examScore: number | null; externalRef: string }) {
  const course = await db.academyCourse.findUnique({ where: { externalId: p.externalCourseId }, include: { coaches: true } });
  if (!course) throw new NotFoundError("Unknown external course");
  const user = await db.user.findUnique({ where: { email: p.agentEmail }, include: { agentProfiles: { where: { archivedAt: null }, take: 1, select: { id: true, displayName: true } } } });
  const activeProfile = user?.agentProfiles[0];
  if (!user || !activeProfile) throw new NotFoundError("Unknown agent");
  const profileId = activeProfile.id;
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
    await publishEvent(tx, "COURSE_COMPLETED", { courseId: course.id, title: course.title, agentProfileId: profileId, agentUserId: user.id, agentEmail: user.email, displayName: activeProfile.displayName, examScore: p.examScore, coachUserIds: [course.ownerCoachUserId, ...course.coaches.map((c) => c.coachUserId)], coachReviewRequired: course.requiresCoachReview });
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
