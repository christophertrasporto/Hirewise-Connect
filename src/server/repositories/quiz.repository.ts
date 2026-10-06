import type { Prisma, QuestionState, QuestionType, QuizAttemptStatus, LessonProgressStatus, CourseDifficulty } from "@prisma/client";
import type { Db } from "@/server/db/types";

export type QuestionWrite = { type: QuestionType; prompt: string; explanation: string | null; points: number; isRequired: boolean; state: QuestionState; keywords: string[]; topic?: string | null; difficulty?: CourseDifficulty | null };
export type ChoiceWrite = { id?: string; text: string; isCorrect: boolean };

export const questionInclude = { choices: { orderBy: { order: "asc" } } } satisfies Prisma.QuestionInclude;

export const quizRepository = {
  // Questions
  listForLesson(db: Db, lessonId: string, state?: QuestionState) {
    return db.question.findMany({ where: { lessonId, ...(state ? { state } : {}) }, include: questionInclude, orderBy: { order: "asc" } });
  },

  findQuestion(db: Db, id: string) {
    return db.question.findUnique({ where: { id }, include: { ...questionInclude, lesson: { select: { id: true, moduleId: true, module: { select: { courseId: true } } } } } });
  },

  async createQuestion(db: Db, lessonId: string, courseId: string, createdById: string, q: QuestionWrite, choices: ChoiceWrite[]) {
    const order = (await db.question.count({ where: { lessonId } })) + 1;
    return db.question.create({ data: { lessonId, courseId, createdById, order, ...q, choices: { create: choices.map((c, i) => ({ text: c.text, isCorrect: c.isCorrect, order: i + 1 })) } }, include: questionInclude });
  },

  /** Update in place, keeping the ids of choices that still exist (answers reference choice ids). */
  async updateQuestion(db: Db, id: string, q: QuestionWrite, choices: ChoiceWrite[], bumpVersion: boolean) {
    const existing = await db.questionChoice.findMany({ where: { questionId: id }, select: { id: true } });
    const keep = new Set(choices.map((c) => c.id).filter((x): x is string => !!x && existing.some((e) => e.id === x)));
    await db.questionChoice.deleteMany({ where: { questionId: id, id: { notIn: [...keep] } } });
    for (const [i, c] of choices.entries()) {
      if (c.id && keep.has(c.id)) await db.questionChoice.update({ where: { id: c.id }, data: { text: c.text, isCorrect: c.isCorrect, order: i + 1 } });
      else await db.questionChoice.create({ data: { questionId: id, text: c.text, isCorrect: c.isCorrect, order: i + 1 } });
    }
    return db.question.update({ where: { id }, data: { ...q, ...(bumpVersion ? { version: { increment: 1 } } : {}) }, include: questionInclude });
  },

  async deleteQuestion(db: Db, id: string) {
    const q = await db.question.delete({ where: { id } });
    if (q.lessonId) await this.renumber(db, q.lessonId);
    return q;
  },

  async renumber(db: Db, lessonId: string) {
    const rows = await db.question.findMany({ where: { lessonId }, orderBy: { order: "asc" }, select: { id: true } });
    for (const [i, r] of rows.entries()) await db.question.update({ where: { id: r.id }, data: { order: i + 1 } });
  },

  async swapOrder(db: Db, a: { id: string; order: number }, b: { id: string; order: number }) {
    await db.question.update({ where: { id: a.id }, data: { order: -1 } });
    await db.question.update({ where: { id: b.id }, data: { order: a.order } });
    await db.question.update({ where: { id: a.id }, data: { order: b.order } });
  },

  async duplicateQuestion(db: Db, id: string) {
    const q = await db.question.findUniqueOrThrow({ where: { id }, include: questionInclude });
    const order = (await db.question.count({ where: { lessonId: q.lessonId } })) + 1;
    return db.question.create({ data: { lessonId: q.lessonId, courseId: q.courseId, topic: q.topic, difficulty: q.difficulty, type: q.type, prompt: `${q.prompt} (copy)`, explanation: q.explanation, points: q.points, isRequired: q.isRequired, order, state: "DRAFT", keywords: q.keywords, source: q.source, createdById: q.createdById, choices: { create: q.choices.map((c) => ({ text: c.text, isCorrect: c.isCorrect, order: c.order })) } }, include: questionInclude });
  },

  // Lessons as the quiz engine sees them
  findQuizLesson(db: Db, lessonId: string) {
    return db.courseLesson.findUnique({ where: { id: lessonId }, include: { module: { select: { id: true, courseId: true, status: true, order: true, title: true, course: { select: { id: true, title: true, status: true, passingScore: true, completionRequiresQuizPass: true, certificationTemplateId: true } } } } } });
  },

  // Attempts
  openAttempt(db: Db, lessonId: string, agentProfileId: string) {
    return db.quizAttempt.findFirst({ where: { lessonId, agentProfileId, status: "IN_PROGRESS" }, orderBy: { startedAt: "desc" } });
  },

  attemptsFor(db: Db, lessonId: string, agentProfileId: string) {
    return db.quizAttempt.findMany({ where: { lessonId, agentProfileId }, orderBy: { startedAt: "desc" } });
  },

  findAttempt(db: Db, id: string) {
    return db.quizAttempt.findUnique({ where: { id }, include: { lesson: { include: { module: { select: { courseId: true, course: { select: { id: true, title: true, passingScore: true, completionRequiresQuizPass: true } } } } } } } });
  },

  createAttempt(db: Db, d: { lessonId: string; agentProfileId: string; lessonVersion: number; questionSnapshot: Prisma.InputJsonValue; expiresAt: Date | null }) {
    return db.quizAttempt.create({ data: { ...d, status: "IN_PROGRESS" } });
  },

  finishAttempt(db: Db, id: string, d: { status: QuizAttemptStatus; answers: Prisma.InputJsonValue; scorePercent: number | null; passed: boolean | null; submittedAt: Date; reviewedById?: string | null; reviewedAt?: Date | null; feedback?: string | null }) {
    return db.quizAttempt.update({ where: { id }, data: d });
  },

  pendingReviewForCourse(db: Db, courseId: string) {
    return db.quizAttempt.findMany({ where: { status: "PENDING_REVIEW", lesson: { module: { courseId } } }, include: { lesson: { select: { id: true, title: true, contentType: true, passingScore: true } }, agentProfile: { select: { id: true, displayName: true } } }, orderBy: { submittedAt: "asc" } });
  },

  // Lesson progress
  progress(db: Db, lessonId: string, agentProfileId: string) {
    return db.lessonProgress.findUnique({ where: { lessonId_agentProfileId: { lessonId, agentProfileId } } });
  },

  upsertProgress(db: Db, lessonId: string, agentProfileId: string, d: { status?: LessonProgressStatus; startedAt?: Date; completedAt?: Date | null; lessonVersion?: number; mediaSeconds?: number; lastPositionSec?: number; mediaPercent?: number; mediaCompletedAt?: Date | null }) {
    const media = { ...(d.mediaSeconds !== undefined ? { mediaSeconds: d.mediaSeconds } : {}), ...(d.lastPositionSec !== undefined ? { lastPositionSec: d.lastPositionSec } : {}), ...(d.mediaPercent !== undefined ? { mediaPercent: d.mediaPercent } : {}), ...(d.mediaCompletedAt !== undefined ? { mediaCompletedAt: d.mediaCompletedAt } : {}) };
    return db.lessonProgress.upsert({
      where: { lessonId_agentProfileId: { lessonId, agentProfileId } },
      create: { lessonId, agentProfileId, status: d.status ?? "IN_PROGRESS", startedAt: d.startedAt ?? new Date(), completedAt: d.completedAt ?? undefined, lessonVersion: d.lessonVersion, ...media },
      update: { ...(d.status ? { status: d.status } : {}), ...(d.completedAt !== undefined ? { completedAt: d.completedAt } : {}), ...(d.lessonVersion !== undefined ? { lessonVersion: d.lessonVersion } : {}), ...media },
    });
  },
};
