import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { testDb, resetDb } from "../setup/db";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";

/**
 * Course Builder phase 1: the schema and the exam → quiz data migration.
 * The migration SQL is re-run against rows created through the legacy Exam tables to prove it converts
 * questions, choices, and attempts without touching the originals, and that it is idempotent.
 */
const db = testDb();
const ids = { coach: "coach_cb", course: "", profile: "", enrollment: "", exam: "", q1: "", q2: "", attempt: "" };

/** Prisma runs raw SQL as one prepared statement, so the migration file is executed statement by statement. */
const runDataMigration = async () => {
  const dir = path.join(process.cwd(), "prisma", "migrations");
  const name = readdirSync(dir).find((d) => d.endsWith("_course_builder_data"))!;
  const sql = readFileSync(path.join(dir, name, "migration.sql"), "utf8");
  const statements = sql
    .split(/;\s*\n/)
    .map((x) => x.replace(/^(\s*--[^\n]*\n)+/, "").trim())
    .filter((x) => x && !x.startsWith("--"));
  for (const stmt of statements) await db.$executeRawUnsafe(stmt);
};

beforeAll(async () => {
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const coachRole = await db.role.findUniqueOrThrow({ where: { key: "COACH" } });
  const agentRole = await db.role.findUniqueOrThrow({ where: { key: "AGENT" } });
  await db.user.create({ data: { id: ids.coach, email: "coach@hirewise.example", roleId: coachRole.id } });
  const au = await db.user.create({ data: { email: "agent@t.example", roleId: agentRole.id } });
  ids.profile = (await db.agentProfile.create({ data: { userId: au.id, displayName: "Agent", headline: "H", primaryRole: "VA", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila" } })).id;
  ids.course = (await db.academyCourse.create({ data: { code: "legacy-exam-course", title: "Legacy", category: "Cold Calling", description: "A course description long enough to satisfy validation rules.", ownerCoachUserId: ids.coach, status: "PUBLISHED", passingScore: 70 } })).id;
  ids.enrollment = (await db.courseEnrollment.create({ data: { courseId: ids.course, agentProfileId: ids.profile } })).id;
  const exam = await db.exam.create({ data: { courseId: ids.course, title: "Legacy final", instructions: "Pick one.", maxAttempts: 2, timeLimitMin: 20, status: "PUBLISHED" } });
  ids.exam = exam.id;
  ids.q1 = (await db.examQuestion.create({ data: { examId: exam.id, order: 1, prompt: "First question", options: ["A", "B", "C"], correctIndex: 1, points: 1 } })).id;
  ids.q2 = (await db.examQuestion.create({ data: { examId: exam.id, order: 2, prompt: "Second question", options: ["Yes", "No"], correctIndex: 0, points: 2, explanation: "Because." } })).id;
  ids.attempt = (await db.examAttempt.create({ data: { examId: exam.id, enrollmentId: ids.enrollment, status: "SUBMITTED", answers: { [ids.q1]: 1, [ids.q2]: 1 }, scorePercent: 33, passed: false, submittedAt: new Date() } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("exam → quiz data migration", () => {
  it("creates categories, a Final exam module, a QUIZ lesson, questions with choices by id, and attempts with snapshots; originals untouched; idempotent", async () => {
    await runDataMigration();
    await runDataMigration(); // second run must be a no-op

    const cats = await db.courseCategory.findMany({ orderBy: { order: "asc" } });
    expect(cats.map((c) => c.name)).toContain("Foundation");
    expect(cats.map((c) => c.name)).toContain("Cold Calling");
    const course = await db.academyCourse.findUniqueOrThrow({ where: { id: ids.course }, include: { categoryRef: true, modules: { include: { lessons: { include: { questions: { include: { choices: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } } } } } } } });
    expect(course.categoryRef?.name).toBe("Cold Calling");
    expect(course.modules).toHaveLength(1);
    expect(course.modules[0].title).toBe("Final exam");
    const lesson = course.modules[0].lessons[0];
    expect(lesson.id).toBe(ids.exam);
    expect(lesson.contentType).toBe("QUIZ");
    expect(lesson.status).toBe("PUBLISHED");
    expect(lesson.passingScore).toBe(70);
    expect(lesson.maxAttempts).toBe(2);
    expect(lesson.timeLimitMin).toBe(20);
    expect(lesson.questions.map((q) => q.id)).toEqual([ids.q1, ids.q2]);
    expect(lesson.questions[0].choices.map((c) => [c.text, c.isCorrect])).toEqual([["A", false], ["B", true], ["C", false]]);
    expect(lesson.questions[1].points).toBe(2);
    expect(lesson.questions[1].explanation).toBe("Because.");
    expect(await db.question.count()).toBe(2);
    expect(await db.questionChoice.count()).toBe(5);

    const attempt = await db.quizAttempt.findUniqueOrThrow({ where: { id: ids.attempt } });
    expect(attempt.lessonId).toBe(ids.exam);
    expect(attempt.agentProfileId).toBe(ids.profile);
    expect(attempt.scorePercent).toBe(33);
    expect(attempt.passed).toBe(false);
    expect(attempt.status).toBe("SUBMITTED");
    expect(attempt.answers).toEqual({ [ids.q1]: [`${ids.q1}-1`], [ids.q2]: [`${ids.q2}-1`] });
    const snap = attempt.questionSnapshot as Array<{ questionId: string; choiceIds: string[]; points: number }>;
    expect(snap.map((s) => s.questionId)).toEqual([ids.q1, ids.q2]);
    expect(snap[0].choiceIds).toEqual([`${ids.q1}-0`, `${ids.q1}-1`, `${ids.q1}-2`]);
    expect(await db.quizAttempt.count()).toBe(1);

    // legacy tables are left alone until the quiz engine replaces them
    expect(await db.exam.count()).toBe(1);
    expect(await db.examQuestion.count()).toBe(2);
    expect(await db.examAttempt.count()).toBe(1);
  });
});

describe("new tables", () => {
  it("lesson progress is unique per learner and lesson, attempts cascade with the lesson, and the certificate number is unique", async () => {
    const lessonId = ids.exam;
    await db.lessonProgress.create({ data: { lessonId, agentProfileId: ids.profile, status: "IN_PROGRESS", mediaSeconds: 12.5, lastPositionSec: 12.5, mediaPercent: 10 } });
    await expect(db.lessonProgress.create({ data: { lessonId, agentProfileId: ids.profile } })).rejects.toThrow();
    await db.courseProgress.upsert({ where: { courseId_agentProfileId: { courseId: ids.course, agentProfileId: ids.profile } }, create: { courseId: ids.course, agentProfileId: ids.profile, requiredTotal: 1, requiredDone: 0, percent: 0 }, update: {} });
    const lv = await db.lessonVersion.create({ data: { lessonId, version: 1, snapshot: { title: "Legacy final" }, changedById: ids.coach } });
    expect(lv.version).toBe(1);
    await expect(db.lessonVersion.create({ data: { lessonId, version: 1, snapshot: {} } })).rejects.toThrow();

    const template = await db.certificationTemplate.create({ data: { name: "T", requiresCompletion: true } });
    await db.certification.create({ data: { agentProfileId: ids.profile, templateId: template.id, origin: "ADMIN_ISSUED", status: "APPROVED", certificateNumber: "HC-2026-000001", verificationCode: "abc" } });
    await expect(db.certification.create({ data: { agentProfileId: ids.profile, templateId: template.id, origin: "ADMIN_ISSUED", status: "APPROVED", courseId: ids.course, certificateNumber: "HC-2026-000001", verificationCode: "def" } })).rejects.toThrow();

    await db.courseLesson.delete({ where: { id: lessonId } });
    expect(await db.quizAttempt.count({ where: { lessonId } })).toBe(0);
    expect(await db.lessonProgress.count({ where: { lessonId } })).toBe(0);
    expect(await db.question.count({ where: { lessonId } })).toBe(0);
  });
});
