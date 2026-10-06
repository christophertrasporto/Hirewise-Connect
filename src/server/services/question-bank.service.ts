import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { NotFoundError } from "@/server/policies/authorize";
import { quizRepository } from "@/server/repositories/quiz.repository";
import { audit } from "@/server/audit/audit";
import { questionBuilderGate, questionSchema, ownsQuestion, QUESTION_LESSON_TYPES, type QuestionInput } from "./quiz.service";
import { recordLessonVersion } from "./lesson-version.service";

/**
 * Question bank (Course Builder phase 10). Every question on a course is visible in one place, organised by
 * module, lesson, topic, and difficulty, searchable, and reusable: copy into a lesson, copy to the bank, duplicate,
 * edit, delete. Bank-only questions (no lesson) are kept on the course. Coaches still create questions directly
 * inside a lesson; the bank is an extra entry point, not a replacement. Random draws stay per lesson
 * (`randomizeCount` over that lesson's published questions).
 */
export type BankFilters = { q?: string; topic?: string; difficulty?: string; type?: string; location?: "ALL" | "BANK" | "LESSONS" | string };

export async function listQuestionBank(db: PrismaClient, actor: Actor, courseId: string, f: BankFilters = {}) {
  const course = await questionBuilderGate(db, actor, courseId);
  const rows = await quizRepository.listForCourse(db, course.id);
  const q = f.q?.trim().toLowerCase();
  const topics = [...new Set(rows.map((r) => r.topic).filter((t): t is string => !!t))].sort();
  const lessons = [...new Map(rows.filter((r) => r.lesson).map((r) => [r.lesson!.id, { id: r.lesson!.id, title: r.lesson!.title, module: r.lesson!.module.title }])).values()];
  const items = rows
    .filter((r) => !q || r.prompt.toLowerCase().includes(q) || r.choices.some((c) => c.text.toLowerCase().includes(q)) || (r.topic ?? "").toLowerCase().includes(q))
    .filter((r) => !f.topic || r.topic === f.topic)
    .filter((r) => !f.difficulty || r.difficulty === f.difficulty)
    .filter((r) => !f.type || r.type === f.type)
    .filter((r) => !f.location || f.location === "ALL" || (f.location === "BANK" ? !r.lessonId : f.location === "LESSONS" ? !!r.lessonId : r.lessonId === f.location))
    .map((r) => ({ id: r.id, type: r.type, prompt: r.prompt, explanation: r.explanation, points: r.points, isRequired: r.isRequired, state: r.state === "SUGGESTED" ? ("DRAFT" as const) : (r.state as "DRAFT" | "PUBLISHED"), keywords: r.keywords, topic: r.topic, difficulty: r.difficulty, version: r.version, updatedAt: r.updatedAt, lesson: r.lesson ? { id: r.lesson.id, title: r.lesson.title, module: r.lesson.module.title } : null, choices: r.choices.map((c) => ({ id: c.id, text: c.text, isCorrect: c.isCorrect })) }));
  return { items, topics, lessons, total: rows.length, bankOnly: rows.filter((r) => !r.lessonId).length };
}

/** Create or edit a bank-only question (no lesson). Lesson questions are edited on their lesson page. */
export async function saveBankQuestion(db: PrismaClient, actor: Actor, courseId: string, raw: QuestionInput) {
  const course = await questionBuilderGate(db, actor, courseId);
  const input = questionSchema.parse(raw);
  const choices = input.type === "SHORT_ANSWER" ? [] : input.choices.map((c) => ({ id: c.id, text: c.text, isCorrect: c.isCorrect }));
  const write = { type: input.type, prompt: input.prompt, explanation: input.explanation || null, points: input.points, isRequired: input.isRequired, state: input.state, keywords: input.type === "SHORT_ANSWER" ? input.keywords : [], topic: input.topic || null, difficulty: input.difficulty || null };
  return db.$transaction(async (tx) => {
    let id: string;
    if (input.id) {
      const existing = await quizRepository.findQuestion(tx, input.id);
      if (!existing || existing.lessonId || existing.courseId !== course.id) throw new NotFoundError();
      id = (await quizRepository.updateQuestion(tx, existing.id, write, choices, true)).id;
    } else {
      id = (await quizRepository.createQuestion(tx, null, course.id, actor.userId, write, choices)).id;
    }
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "Question", entityId: id, newValue: { courseId: course.id, op: input.id ? "bank-update" : "bank-create", topic: write.topic } });
    return id;
  });
}

/** Reuse: copy a question (from the bank or another lesson) into a question-bearing lesson of the same course. */
export async function copyQuestionToLesson(db: PrismaClient, actor: Actor, courseId: string, questionId: string, lessonId: string) {
  const course = await questionBuilderGate(db, actor, courseId);
  const q = await quizRepository.findQuestion(db, questionId);
  if (!q || !ownsQuestion(course.id, q)) throw new NotFoundError();
  const lesson = await quizRepository.findQuizLesson(db, lessonId);
  if (!lesson || lesson.module.courseId !== course.id) throw new NotFoundError();
  if (!(QUESTION_LESSON_TYPES as readonly string[]).includes(lesson.contentType)) throw new Error(`${lesson.contentType.toLowerCase()} lessons do not have questions.`);
  if (q.lessonId === lesson.id) throw new Error("That question is already in this lesson.");
  return db.$transaction(async (tx) => {
    await recordLessonVersion(tx, lesson.id, actor, `Added question "${q.prompt.slice(0, 60)}" from the bank`);
    const copy = await quizRepository.copyQuestion(tx, q.id, { lessonId: lesson.id, courseId: course.id, createdById: actor.userId });
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "Question", entityId: copy.id, newValue: { courseId: course.id, lessonId: lesson.id, op: "copy-to-lesson", from: q.id } });
    return copy.id;
  });
}

/** Keep a lesson question in the bank for reuse elsewhere (a copy; the lesson keeps its own). */
export async function copyQuestionToBank(db: PrismaClient, actor: Actor, courseId: string, questionId: string) {
  const course = await questionBuilderGate(db, actor, courseId);
  const q = await quizRepository.findQuestion(db, questionId);
  if (!q || !ownsQuestion(course.id, q)) throw new NotFoundError();
  if (!q.lessonId) throw new Error("That question is already in the bank.");
  return db.$transaction(async (tx) => {
    const copy = await quizRepository.copyQuestion(tx, q.id, { lessonId: null, courseId: course.id, createdById: actor.userId });
    await audit(tx, { actor, action: "COURSE_UPDATED", entityType: "Question", entityId: copy.id, newValue: { courseId: course.id, op: "copy-to-bank", from: q.id } });
    return copy.id;
  });
}
