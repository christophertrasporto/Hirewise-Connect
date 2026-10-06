import { z } from "zod";
import type { PrismaClient, Prisma } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { quizRepository, type ChoiceWrite, type QuestionWrite } from "@/server/repositories/quiz.repository";
import { academyRepository } from "@/server/repositories/academy.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { loadEditableCourse } from "./academy.service";
import { recalculateCourseProgress, assertLessonUnlocked } from "./progress.service";
import { recordLessonVersion } from "./lesson-version.service";

/**
 * One question system for quizzes, assessments, and audiobook quizzes (Course Builder phase 3).
 * Correctness is tracked by choice id. Attempts freeze a snapshot of the questions as shown, so later
 * edits never rewrite a result. Learner projections never contain correct answers before submission.
 */
export const QUESTION_TYPES = ["MULTIPLE_CHOICE", "MULTIPLE_SELECT", "TRUE_FALSE", "SHORT_ANSWER"] as const;
export const QUESTION_LESSON_TYPES = ["QUIZ", "ASSESSMENT", "AUDIO"] as const;
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const questionSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    type: z.enum(QUESTION_TYPES).default("MULTIPLE_CHOICE"),
    prompt: z.string().trim().min(3, "Write the question.").max(2000),
    explanation: optionalText(2000),
    points: z.coerce.number().int().min(1).max(100).default(1),
    isRequired: z.boolean().default(true),
    state: z.enum(["DRAFT", "PUBLISHED"]).default("PUBLISHED"),
    /** Short answer: accepted keywords (case-insensitive contains). Empty = coach reviews manually. */
    keywords: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    choices: z.array(z.object({ id: z.string().trim().min(1).optional(), text: z.string().trim().min(1, "Write the choice.").max(500), isCorrect: z.boolean().default(false) })).max(20).default([]),
  })
  .superRefine((q, ctx) => {
    const correct = q.choices.filter((c) => c.isCorrect).length;
    if (q.type === "MULTIPLE_CHOICE") {
      if (q.choices.length < 2) ctx.addIssue({ code: "custom", path: ["choices"], message: "Add at least two choices." });
      if (correct !== 1) ctx.addIssue({ code: "custom", path: ["choices"], message: "Mark exactly one choice as correct." });
    }
    if (q.type === "MULTIPLE_SELECT") {
      if (q.choices.length < 2) ctx.addIssue({ code: "custom", path: ["choices"], message: "Add at least two choices." });
      if (correct < 1) ctx.addIssue({ code: "custom", path: ["choices"], message: "Mark at least one choice as correct." });
    }
    if (q.type === "TRUE_FALSE") {
      if (q.choices.length !== 2) ctx.addIssue({ code: "custom", path: ["choices"], message: "True/False needs exactly two choices." });
      if (correct !== 1) ctx.addIssue({ code: "custom", path: ["choices"], message: "Mark True or False as correct." });
    }
  });
export type QuestionInput = z.input<typeof questionSchema>;
type QuestionParsed = z.infer<typeof questionSchema>;

/** Course-level gate for building questions: Admin, or an assigned coach who may build quizzes. */
async function builder(db: PrismaClient, actor: Actor, courseId: string) {
  const course = await loadEditableCourse(db, actor, courseId);
  if (!actor.permissions.has("course.manage")) authorize(actor, "course.quiz.build");
  return course;
}

async function questionLesson(db: PrismaClient, courseId: string, lessonId: string) {
  const l = await quizRepository.findQuizLesson(db, lessonId);
  if (!l || l.module.courseId !== courseId) throw new NotFoundError();
  if (!(QUESTION_LESSON_TYPES as readonly string[]).includes(l.contentType)) throw new Error(`${l.contentType.toLowerCase()} lessons do not have questions.`);
  return l;
}

function toWrite(q: QuestionParsed): { q: QuestionWrite; choices: ChoiceWrite[] } {
  const choices = q.type === "SHORT_ANSWER" ? [] : q.choices.map((c) => ({ id: c.id, text: c.text, isCorrect: c.isCorrect }));
  return { q: { type: q.type, prompt: q.prompt, explanation: q.explanation || null, points: q.points, isRequired: q.isRequired, state: q.state, keywords: q.type === "SHORT_ANSWER" ? q.keywords : [] }, choices };
}

export async function saveQuestion(db: PrismaClient, actor: Actor, courseId: string, lessonId: string, raw: QuestionInput) {
  const course = await builder(db, actor, courseId);
  const lesson = await questionLesson(db, course.id, lessonId);
  const input = questionSchema.parse(raw);
  const { q, choices } = toWrite(input);
  return db.$transaction(async (tx) => {
    let id: string;
    if (input.id) {
      const existing = await quizRepository.findQuestion(tx, input.id);
      if (!existing || existing.lessonId !== lesson.id) throw new NotFoundError();
      // A change to what is asked or what is correct starts a new question version; attempts keep the old one.
      const before = JSON.stringify({ t: existing.type, p: existing.prompt, c: existing.choices.map((c) => [c.id, c.text, c.isCorrect]), k: existing.keywords });
      const after = JSON.stringify({ t: q.type, p: q.prompt, c: choices.map((c) => [c.id ?? null, c.text, c.isCorrect]), k: q.keywords });
      const significant = before !== after || existing.state !== q.state || existing.points !== q.points;
      if (significant) await recordLessonVersion(tx, lesson.id, actor, `Changed question "${existing.prompt.slice(0, 60)}"`);
      id = (await quizRepository.updateQuestion(tx, existing.id, q, choices, before !== after)).id;
    } else {
      await recordLessonVersion(tx, lesson.id, actor, `Added question "${q.prompt.slice(0, 60)}"`);
      id = (await quizRepository.createQuestion(tx, lesson.id, course.id, actor.userId, q, choices)).id;
    }
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "Question", entityId: id, newValue: { courseId: course.id, lessonId: lesson.id, type: q.type, state: q.state, op: input.id ? "update" : "create" } });
    return id;
  });
}

export async function deleteQuestion(db: PrismaClient, actor: Actor, courseId: string, questionId: string) {
  const course = await builder(db, actor, courseId);
  const q = await quizRepository.findQuestion(db, questionId);
  if (!q || q.lesson?.module.courseId !== course.id) throw new NotFoundError();
  await db.$transaction(async (tx) => {
    if (q.lessonId) await recordLessonVersion(tx, q.lessonId, actor, `Removed question "${q.prompt.slice(0, 60)}"`);
    await quizRepository.deleteQuestion(tx, q.id);
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "Question", entityId: q.id, previousValue: { prompt: q.prompt.slice(0, 120) }, newValue: { courseId: course.id, op: "delete" } });
  });
}

export async function moveQuestion(db: PrismaClient, actor: Actor, courseId: string, questionId: string, direction: -1 | 1) {
  const course = await builder(db, actor, courseId);
  const q = await quizRepository.findQuestion(db, questionId);
  if (!q || !q.lessonId || q.lesson?.module.courseId !== course.id) throw new NotFoundError();
  const all = await quizRepository.listForLesson(db, q.lessonId);
  const i = all.findIndex((x) => x.id === q.id);
  const j = i + direction;
  if (j < 0 || j >= all.length) return;
  await db.$transaction((tx) => quizRepository.swapOrder(tx, all[i], all[j]));
}

export async function duplicateQuestion(db: PrismaClient, actor: Actor, courseId: string, questionId: string) {
  const course = await builder(db, actor, courseId);
  const q = await quizRepository.findQuestion(db, questionId);
  if (!q || q.lesson?.module.courseId !== course.id) throw new NotFoundError();
  return db.$transaction(async (tx) => {
    const copy = await quizRepository.duplicateQuestion(tx, q.id);
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "Question", entityId: copy.id, newValue: { courseId: course.id, op: "duplicate", from: q.id } });
    return copy.id;
  });
}

// ---------------------------------------------------------------------------
// Attempts (learner)
// ---------------------------------------------------------------------------

export type SnapshotQuestion = {
  questionId: string;
  version: number;
  type: (typeof QUESTION_TYPES)[number];
  prompt: string;
  points: number;
  explanation: string | null;
  choices: Array<{ id: string; text: string }>;
  /** Never sent to the learner before submission. */
  correctChoiceIds: string[];
  keywords: string[];
};
export type AnswerMap = Record<string, string[] | string>;

function ownProfileId(actor: Actor) {
  if (actor.role !== "AGENT" || !actor.agentProfileId) throw new ForbiddenError("Only talent take quizzes");
  return actor.agentProfileId;
}

function shuffle<T>(items: T[], rnd: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Build the frozen question set for one attempt: random draw, then optional answer shuffle. */
export function buildSnapshot(questions: Array<{ id: string; version: number; type: SnapshotQuestion["type"]; prompt: string; points: number; explanation: string | null; keywords: string[]; choices: Array<{ id: string; text: string; isCorrect: boolean }> }>, opts: { randomizeCount: number | null; shuffleAnswers: boolean }, rnd: () => number = Math.random): SnapshotQuestion[] {
  const pool = opts.randomizeCount && opts.randomizeCount < questions.length ? shuffle(questions, rnd).slice(0, opts.randomizeCount) : questions;
  return pool.map((q) => {
    const choices = opts.shuffleAnswers ? shuffle(q.choices, rnd) : q.choices;
    return { questionId: q.id, version: q.version, type: q.type, prompt: q.prompt, points: q.points, explanation: q.explanation, choices: choices.map((c) => ({ id: c.id, text: c.text })), correctChoiceIds: q.choices.filter((c) => c.isCorrect).map((c) => c.id), keywords: q.keywords };
  });
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Grade an answer map against a snapshot. Choice-based questions are all-or-nothing by id set. */
export function gradeSnapshot(snapshot: SnapshotQuestion[], answers: AnswerMap): { scorePercent: number; earned: number; total: number; perQuestion: Array<{ questionId: string; correct: boolean | null; earned: number }>; needsReview: boolean } {
  const total = snapshot.reduce((s, q) => s + q.points, 0) || 1;
  let earned = 0;
  let needsReview = false;
  const perQuestion = snapshot.map((q) => {
    const raw = answers[q.questionId];
    if (q.type === "SHORT_ANSWER") {
      const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join(" ") : "";
      if (!q.keywords.length) {
        if (text.trim()) needsReview = true;
        return { questionId: q.questionId, correct: null, earned: 0 };
      }
      const hit = q.keywords.some((k) => norm(text).includes(norm(k)));
      if (hit) earned += q.points;
      return { questionId: q.questionId, correct: hit, earned: hit ? q.points : 0 };
    }
    const chosen = new Set(Array.isArray(raw) ? raw : typeof raw === "string" && raw ? [raw] : []);
    const correctSet = new Set(q.correctChoiceIds);
    const ok = chosen.size === correctSet.size && [...chosen].every((c) => correctSet.has(c));
    if (ok) earned += q.points;
    return { questionId: q.questionId, correct: ok, earned: ok ? q.points : 0 };
  });
  return { scorePercent: Math.round((earned / total) * 100), earned, total: snapshot.reduce((s, q) => s + q.points, 0), perQuestion, needsReview };
}

type LessonForQuiz = NonNullable<Awaited<ReturnType<typeof quizRepository.findQuizLesson>>>;

async function learnerLesson(db: PrismaClient, actor: Actor, lessonId: string) {
  const profileId = ownProfileId(actor);
  const lesson = await quizRepository.findQuizLesson(db, lessonId);
  if (!lesson || lesson.status !== "PUBLISHED" || lesson.module.status !== "PUBLISHED") throw new NotFoundError();
  if (!(QUESTION_LESSON_TYPES as readonly string[]).includes(lesson.contentType)) throw new NotFoundError();
  const enrollment = await academyRepository.findEnrollment(db, lesson.module.courseId, profileId);
  if (!enrollment) throw new NotFoundError();
  if (enrollment.paymentStatus === "PENDING") throw new ForbiddenError("This course unlocks once Hirewise records your payment.");
  await assertLessonUnlocked(db, lesson, profileId);
  return { profileId, lesson, enrollment };
}

const passMark = (lesson: LessonForQuiz) => lesson.passingScore ?? lesson.module.course.passingScore;

/** What the learner sees on the quiz page: rules, attempts so far, and whether a new attempt may start. */
export async function quizStateForLearner(db: PrismaClient, actor: Actor, lessonId: string) {
  const { profileId, lesson } = await learnerLesson(db, actor, lessonId);
  const attempts = await quizRepository.attemptsFor(db, lesson.id, profileId);
  const progress = await quizRepository.progress(db, lesson.id, profileId);
  const published = await quizRepository.listForLesson(db, lesson.id, "PUBLISHED");
  const finished = attempts.filter((a) => a.status !== "IN_PROGRESS");
  const open = attempts.find((a) => a.status === "IN_PROGRESS") ?? null;
  const scored = finished.filter((a) => a.scorePercent !== null);
  const counting = lesson.scorePolicy === "LATEST" ? scored[0] ?? null : scored.reduce<(typeof scored)[number] | null>((best, a) => (!best || (a.scorePercent ?? 0) > (best.scorePercent ?? 0) ? a : best), null);
  const attemptsLeft = lesson.maxAttempts === null ? null : Math.max(0, lesson.maxAttempts - finished.length);
  const lastSubmitted = finished[0]?.submittedAt ?? null;
  const waitUntil = lesson.retakeWaitMinutes && lastSubmitted ? new Date(lastSubmitted.getTime() + lesson.retakeWaitMinutes * 60_000) : null;
  const audioGate = lesson.contentType === "AUDIO" && !progress?.mediaCompletedAt;
  let blocked: string | null = null;
  if (published.length === 0) blocked = "The coach has not published any questions yet.";
  else if (audioGate) blocked = `Finish listening to at least ${lesson.requiredPercent ?? 90}% of the audio to unlock the quiz.`;
  else if (!open && attemptsLeft === 0) blocked = `You have used all ${lesson.maxAttempts} attempts. Ask your coach about a retake.`;
  else if (!open && waitUntil && waitUntil.getTime() > Date.now()) blocked = `You can retake this quiz after ${waitUntil.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.`;
  return {
    lesson: { id: lesson.id, title: lesson.title, contentType: lesson.contentType, description: lesson.description, body: lesson.body, questionCount: lesson.randomizeCount && lesson.randomizeCount < published.length ? lesson.randomizeCount : published.length, passingScore: passMark(lesson), maxAttempts: lesson.maxAttempts, timeLimitMin: lesson.timeLimitMin, retakeWaitMinutes: lesson.retakeWaitMinutes, scorePolicy: lesson.scorePolicy, showCorrectAnswers: lesson.showCorrectAnswers, courseId: lesson.module.courseId, courseTitle: lesson.module.course.title },
    progress: progress ? { status: progress.status, completedAt: progress.completedAt } : null,
    attempts: finished.map((a) => ({ id: a.id, status: a.status, scorePercent: a.scorePercent, passed: a.passed, submittedAt: a.submittedAt, startedAt: a.startedAt })),
    attemptsUsed: finished.length,
    attemptsLeft,
    openAttemptId: open?.id ?? null,
    countingScore: counting?.scorePercent ?? null,
    passed: !!progress?.completedAt || finished.some((a) => a.passed),
    waitUntil,
    canStart: !blocked,
    blocked,
  };
}

export async function startAttempt(db: PrismaClient, actor: Actor, lessonId: string): Promise<string> {
  const { profileId, lesson, enrollment } = await learnerLesson(db, actor, lessonId);
  const open = await quizRepository.openAttempt(db, lesson.id, profileId);
  if (open) return open.id;
  const state = await quizStateForLearner(db, actor, lessonId);
  if (!state.canStart) throw new Error(state.blocked ?? "You cannot start this quiz right now.");
  const published = await quizRepository.listForLesson(db, lesson.id, "PUBLISHED");
  const snapshot = buildSnapshot(published.map((q) => ({ id: q.id, version: q.version, type: q.type, prompt: q.prompt, points: q.points, explanation: q.explanation, keywords: q.keywords, choices: q.choices })), { randomizeCount: lesson.randomizeCount, shuffleAnswers: lesson.shuffleAnswers });
  return db.$transaction(async (tx) => {
    const attempt = await quizRepository.createAttempt(tx, { lessonId: lesson.id, agentProfileId: profileId, lessonVersion: lesson.version, questionSnapshot: snapshot as unknown as Prisma.InputJsonValue, expiresAt: lesson.timeLimitMin ? new Date(Date.now() + lesson.timeLimitMin * 60_000) : null });
    const progress = await quizRepository.progress(tx, lesson.id, profileId);
    if (!progress?.completedAt) await quizRepository.upsertProgress(tx, lesson.id, profileId, { status: "IN_PROGRESS", lessonVersion: lesson.version });
    if (enrollment.status === "ENROLLED") await academyRepository.setEnrollmentStatus(tx, enrollment.id, "IN_PROGRESS");
    return attempt.id;
  });
}

function stripForLearner(q: SnapshotQuestion) {
  return { questionId: q.questionId, type: q.type, prompt: q.prompt, points: q.points, choices: q.choices };
}

/** The attempt as the learner may see it. Before submission: questions only. After: result and, per lesson settings, the answer key. */
export async function attemptForLearner(db: PrismaClient, actor: Actor, attemptId: string) {
  const profileId = ownProfileId(actor);
  const a = await quizRepository.findAttempt(db, attemptId);
  if (!a || a.agentProfileId !== profileId) throw new NotFoundError();
  const snapshot = a.questionSnapshot as unknown as SnapshotQuestion[];
  const answers = (a.answers ?? {}) as AnswerMap;
  const lesson = a.lesson;
  const open = a.status === "IN_PROGRESS";
  const reveal = !open && lesson.showCorrectAnswers;
  return {
    id: a.id,
    status: a.status,
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    courseId: lesson.module.courseId,
    courseTitle: lesson.module.course.title,
    passingScore: lesson.passingScore ?? lesson.module.course.passingScore,
    timeLimitMin: lesson.timeLimitMin,
    expiresAt: a.expiresAt,
    startedAt: a.startedAt,
    submittedAt: a.submittedAt,
    questions: snapshot.map((q) => ({
      ...stripForLearner(q),
      answer: open ? undefined : answers[q.questionId] ?? null,
      correctChoiceIds: reveal ? q.correctChoiceIds : undefined,
      explanation: !open && lesson.showExplanations ? q.explanation : undefined,
      correct: !open ? gradeSnapshot([q], answers).perQuestion[0].correct : undefined,
    })),
    result: open ? null : { scorePercent: a.scorePercent, passed: a.passed, pendingReview: a.status === "PENDING_REVIEW", feedback: a.feedback },
  };
}

export async function submitAttempt(db: PrismaClient, actor: Actor, attemptId: string, answers: AnswerMap) {
  const profileId = ownProfileId(actor);
  const a = await quizRepository.findAttempt(db, attemptId);
  if (!a || a.agentProfileId !== profileId) throw new NotFoundError();
  if (a.status !== "IN_PROGRESS") throw new Error("This attempt was already submitted.");
  const lesson = a.lesson;
  const snapshot = a.questionSnapshot as unknown as SnapshotQuestion[];
  const expired = !!a.expiresAt && a.expiresAt.getTime() < Date.now() - 30_000;
  const grade = gradeSnapshot(snapshot, answers);
  const manual = lesson.reviewMode === "MANUAL" || (lesson.reviewMode === "BOTH" && grade.needsReview) || (lesson.reviewMode === "AUTO" && grade.needsReview);
  const pending = !expired && manual;
  const pass = passMark(lesson as never);
  const passed = expired ? false : pending ? null : grade.scorePercent >= pass;
  const result = await db.$transaction(async (tx) => {
    await quizRepository.finishAttempt(tx, a.id, { status: expired ? "EXPIRED" : pending ? "PENDING_REVIEW" : "SUBMITTED", answers: answers as Prisma.InputJsonValue, scorePercent: grade.scorePercent, passed, submittedAt: new Date() });
    const finished = (await quizRepository.attemptsFor(tx, lesson.id, profileId)).filter((x) => x.status !== "IN_PROGRESS").length;
    const attemptsLeft = lesson.maxAttempts === null ? Infinity : lesson.maxAttempts - finished;
    const progress = await quizRepository.progress(tx, lesson.id, profileId);
    const completesAnyway = !lesson.module.course.completionRequiresQuizPass && !pending && !expired;
    if (passed || completesAnyway) {
      if (!progress?.completedAt) await quizRepository.upsertProgress(tx, lesson.id, profileId, { status: "COMPLETED", completedAt: new Date(), lessonVersion: lesson.version });
    } else if (!progress?.completedAt) {
      await quizRepository.upsertProgress(tx, lesson.id, profileId, { status: pending ? "PENDING_REVIEW" : attemptsLeft > 0 ? "RETAKE_REQUIRED" : "FAILED", lessonVersion: lesson.version });
    }
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "QuizAttempt", entityId: a.id, newValue: { lessonId: lesson.id, scorePercent: grade.scorePercent, passed, expired, pendingReview: pending } });
    if (pending) {
      const enr = await academyRepository.findEnrollment(tx, lesson.module.courseId, profileId);
      if (enr) await publishEvent(tx, "ATTEMPT_PENDING_REVIEW", { attemptId: a.id, lessonId: lesson.id, lessonTitle: lesson.title, courseId: lesson.module.courseId, courseTitle: enr.course.title, agentProfileId: profileId, displayName: enr.agentProfile.displayName, coachUserIds: [enr.course.ownerCoachUserId, ...enr.course.coaches.map((x) => x.coachUserId)] });
    }
    const course = await recalculateCourseProgress(tx, lesson.module.courseId, profileId);
    return { scorePercent: grade.scorePercent, passed, expired, pendingReview: pending, attemptsLeft: attemptsLeft === Infinity ? null : Math.max(0, attemptsLeft), courseCompleted: course.completedNow, coursePercent: course.percent };
  });
  return result;
}

// ---------------------------------------------------------------------------
// Manual review (coach)
// ---------------------------------------------------------------------------

export async function attemptsAwaitingReview(db: PrismaClient, actor: Actor, courseId: string) {
  const course = await builder(db, actor, courseId);
  const rows = await quizRepository.pendingReviewForCourse(db, course.id);
  return rows.map((a) => {
    const snapshot = a.questionSnapshot as unknown as SnapshotQuestion[];
    const answers = (a.answers ?? {}) as AnswerMap;
    return {
      id: a.id,
      lesson: a.lesson,
      learner: a.agentProfile,
      submittedAt: a.submittedAt,
      autoScore: a.scorePercent,
      passingScore: a.lesson.passingScore ?? course.passingScore,
      shortAnswers: snapshot.filter((q) => q.type === "SHORT_ANSWER").map((q) => ({ questionId: q.questionId, prompt: q.prompt, points: q.points, answer: typeof answers[q.questionId] === "string" ? (answers[q.questionId] as string) : "", keywords: q.keywords })),
      /** Every question with the learner's answer and the auto result (null = needs a human), for manual-review assessments. */
      answers: snapshot.map((q) => {
        const raw = answers[q.questionId];
        const chosen = Array.isArray(raw) ? raw : typeof raw === "string" && q.type !== "SHORT_ANSWER" && raw ? [raw] : [];
        return { questionId: q.questionId, type: q.type, prompt: q.prompt, points: q.points, answer: q.type === "SHORT_ANSWER" ? (typeof raw === "string" ? raw : "") : q.choices.filter((c) => chosen.includes(c.id)).map((c) => c.text).join(", "), correctAnswer: q.type === "SHORT_ANSWER" ? q.keywords.join(", ") : q.choices.filter((c) => q.correctChoiceIds.includes(c.id)).map((c) => c.text).join(", "), correct: gradeSnapshot([q], answers).perQuestion[0].correct };
      }),
      reviewMode: a.lesson.reviewMode,
    };
  });
}

export const reviewSchema = z.object({ scorePercent: z.coerce.number().int().min(0).max(100), feedback: optionalText(2000) });

/** Coach sets the final score for an attempt that needed a human; learner history keeps the auto score in the audit row. */
export async function reviewAttempt(db: PrismaClient, actor: Actor, courseId: string, attemptId: string, raw: z.input<typeof reviewSchema>) {
  const course = await builder(db, actor, courseId);
  const input = reviewSchema.parse(raw);
  const a = await quizRepository.findAttempt(db, attemptId);
  if (!a || a.lesson.module.courseId !== course.id) throw new NotFoundError();
  if (a.status !== "PENDING_REVIEW") throw new Error("This attempt is not awaiting review.");
  const pass = a.lesson.passingScore ?? course.passingScore;
  const passed = input.scorePercent >= pass;
  await db.$transaction(async (tx) => {
    await quizRepository.finishAttempt(tx, a.id, { status: "SUBMITTED", answers: (a.answers ?? {}) as Prisma.InputJsonValue, scorePercent: input.scorePercent, passed, submittedAt: a.submittedAt ?? new Date(), reviewedById: actor.userId, reviewedAt: new Date(), feedback: input.feedback || null });
    const progress = await quizRepository.progress(tx, a.lessonId, a.agentProfileId);
    if (passed) {
      if (!progress?.completedAt) await quizRepository.upsertProgress(tx, a.lessonId, a.agentProfileId, { status: "COMPLETED", completedAt: new Date() });
    } else if (!progress?.completedAt) {
      const finished = (await quizRepository.attemptsFor(tx, a.lessonId, a.agentProfileId)).filter((x) => x.status !== "IN_PROGRESS").length;
      await quizRepository.upsertProgress(tx, a.lessonId, a.agentProfileId, { status: a.lesson.maxAttempts === null || finished < a.lesson.maxAttempts ? "RETAKE_REQUIRED" : "FAILED" });
    }
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "QuizAttempt", entityId: a.id, previousValue: { autoScore: a.scorePercent }, newValue: { scorePercent: input.scorePercent, passed, reviewed: true }, reason: input.feedback || undefined });
    await recalculateCourseProgress(tx, course.id, a.agentProfileId);
  });
}
