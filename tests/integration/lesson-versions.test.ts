import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { createCourse, saveModule, saveLesson, submitCourseForApproval, publishCourse, enrol } from "@/server/services/academy.service";
import { saveQuestion, deleteQuestion, startAttempt, attemptForLearner, submitAttempt } from "@/server/services/quiz.service";
import { markLessonComplete } from "@/server/services/lesson-media.service";
import { changedFields, lessonHistory, restoreLessonVersion } from "@/server/services/lesson-version.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";

const db = testDb();
const ids = { coach: "coach_lv", coach2: "coach_lv2", admin: "admin_lv", agentUser: "", agentProfile: "", cat: "", course: "", module: "", text: "", quiz: "", q1: "" };

beforeAll(async () => {
  process.env.APP_URL = "http://localhost:3000";
  setEmailChannelForTests(new ConsoleEmailChannel());
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.user.create({ data: { id: ids.coach, email: "coach@hirewise.example", roleId: await role("COACH") } });
  await db.user.create({ data: { id: ids.coach2, email: "coach2@hirewise.example", roleId: await role("COACH") } });
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN") } });
  const u = await db.user.create({ data: { email: "ana@t.example", roleId: await role("AGENT"), emailVerifiedAt: new Date() } });
  const p = await db.agentProfile.create({ data: { userId: u.id, displayName: "Ana", headline: "H", primaryRole: "VA", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila" } });
  ids.agentUser = u.id; ids.agentProfile = p.id;
  ids.cat = (await db.courseCategory.create({ data: { name: "Sales", slug: "sales", order: 1 } })).id;
});

afterAll(async () => {
  setEmailChannelForTests(null);
  await db.$disconnect();
});

const coach = () => resolveActor(db, ids.coach);
const coach2 = () => resolveActor(db, ids.coach2);
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const agent = () => makeActor("AGENT", { userId: ids.agentUser, agentProfileId: ids.agentProfile });
const lesson = (id: string) => db.courseLesson.findUniqueOrThrow({ where: { id } });
const textInput = (over: Record<string, unknown>) => ({ id: ids.text, moduleId: ids.module, title: "Openers", contentType: "TEXT" as const, body: "# v1", description: "", ...over });

describe("lesson version history", () => {
  it("cosmetic edits do not create a version; significant ones freeze the previous state and bump the version", async () => {
    const c = await coach();
    ids.course = await createCourse(db, c, { title: "Versioned course", categoryId: ids.cat, description: "A course description long enough to satisfy validation rules.", difficulty: "BEGINNER", passingScore: 60, requiresCoachReview: false, priceUsd: "", syllabus: "", contentUrl: "" });
    ids.module = await saveModule(db, c, ids.course, { title: "Module 1", description: "" });
    ids.text = await saveLesson(db, c, ids.course, textInput({ id: undefined }));
    expect((await lesson(ids.text)).version).toBe(1);
    expect(changedFields({ title: "a", body: "b" }, { title: "a", body: "b", description: "new" })).toEqual([]);
    expect(changedFields({ title: "a", dueAt: new Date("2026-01-01") }, { title: "b", dueAt: "2026-01-01T00:00:00.000Z" })).toEqual(["title"]);

    await saveLesson(db, c, ids.course, textInput({ description: "Just a description" }));
    expect((await lesson(ids.text)).version).toBe(1);
    expect(await db.lessonVersion.count({ where: { lessonId: ids.text } })).toBe(0);

    await saveLesson(db, c, ids.course, textInput({ description: "Just a description", body: "# v2 content", title: "Openers that work" }));
    const l = await lesson(ids.text);
    expect(l.version).toBe(2);
    const v1 = await db.lessonVersion.findUniqueOrThrow({ where: { lessonId_version: { lessonId: ids.text, version: 1 } } });
    expect(v1.changedById).toBe(ids.coach);
    expect(v1.reason).toBe("Changed title, content");
    expect((v1.snapshot as { fields: { title: string; body: string } }).fields).toMatchObject({ title: "Openers", body: "# v1" });

    await saveLesson(db, c, ids.course, textInput({ description: "Just a description", body: "# v2 content", title: "Openers that work", isRequired: false }));
    expect((await lesson(ids.text)).version).toBe(3);
  });

  it("question edits version the quiz lesson; attempts and completions record the version they happened on", async () => {
    const c = await coach();
    ids.quiz = await saveLesson(db, c, ids.course, { moduleId: ids.module, title: "Quiz", contentType: "QUIZ", passingScore: 60 });
    ids.q1 = await saveQuestion(db, c, ids.course, ids.quiz, { prompt: "Pick A", choices: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] });
    expect((await lesson(ids.quiz)).version).toBe(2); // adding a question is significant
    const q1Choices = (await db.questionChoice.findMany({ where: { questionId: ids.q1 }, orderBy: { order: "asc" } })).map((x) => ({ id: x.id, text: x.text, isCorrect: x.isCorrect }));
    await saveQuestion(db, c, ids.course, ids.quiz, { id: ids.q1, prompt: "Pick A", explanation: "Because.", choices: q1Choices });
    expect((await lesson(ids.quiz)).version).toBe(2); // explanation only: not significant
    await submitCourseForApproval(db, c, ids.course);
    await publishCourse(db, admin(), ids.course, {});
    await enrol(db, agent(), ids.course);
    await markLessonComplete(db, agent(), ids.text);
    const a1 = await startAttempt(db, agent(), ids.quiz);
    const v = await attemptForLearner(db, agent(), a1);
    await submitAttempt(db, agent(), a1, { [ids.q1]: [v.questions[0].choices.find((x) => x.text === "A")!.id] });
    expect((await db.quizAttempt.findUniqueOrThrow({ where: { id: a1 } })).lessonVersion).toBe(2);

    // reword the question (significant) and add another: v3, v4
    await saveQuestion(db, c, ids.course, ids.quiz, { id: ids.q1, prompt: "Pick the letter A", choices: q1Choices });
    const q2 = await saveQuestion(db, c, ids.course, ids.quiz, { prompt: "Pick B", choices: [{ text: "A", isCorrect: false }, { text: "B", isCorrect: true }] });
    expect((await lesson(ids.quiz)).version).toBe(4);
    await deleteQuestion(db, c, ids.course, q2);
    expect((await lesson(ids.quiz)).version).toBe(5);

    const h = await lessonHistory(db, c, ids.course, ids.quiz);
    expect(h.current).toMatchObject({ version: 5, questionCount: 1, attempts: 0, completions: 0 });
    expect(h.versions.map((x) => x.version)).toEqual([4, 3, 2, 1]);
    const onV2 = h.versions.find((x) => x.version === 2)!;
    expect(onV2).toMatchObject({ attempts: 1, completions: 1, changedBy: "coach", questionCount: 1 });
    expect(onV2.changes).toEqual([{ field: "question changed", from: "Pick A", to: "Pick the letter A" }]);
    expect(h.versions.find((x) => x.version === 3)!.changes).toEqual([{ field: "question added", from: "—", to: "Pick B" }]);
    expect(h.versions.find((x) => x.version === 4)!.changes).toEqual([{ field: "question removed", from: "Pick B", to: "—" }]);
    expect(h.versions.find((x) => x.version === 1)!.changes).toEqual([{ field: "question added", from: "—", to: "Pick A" }]);
    // the attempt still renders its own frozen snapshot
    expect((await attemptForLearner(db, agent(), a1)).questions[0].prompt).toBe("Pick A");

    await expect(lessonHistory(db, await coach2(), ids.course, ids.quiz)).rejects.toBeInstanceOf(NotFoundError);
    await expect(lessonHistory(db, agent(), ids.course, ids.quiz)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("restoring a version puts content and settings back and is itself recorded; questions are untouched", async () => {
    const h = await lessonHistory(db, await coach(), ids.course, ids.text);
    expect(h.versions.map((x) => x.version)).toEqual([2, 1]);
    expect(h.versions[1].changes).toEqual([{ field: "title", from: "Openers", to: "Openers that work" }, { field: "content", from: "# v1", to: "# v2 content" }]);
    expect(h.versions[0].changes).toEqual([{ field: "required flag", from: "on", to: "off" }]);
    expect(h.versions[1].completions).toBe(0);
    expect(h.current.completions).toBe(1);

    const newVersion = await restoreLessonVersion(db, await coach(), ids.course, ids.text, 1);
    expect(newVersion).toBe(4);
    const l = await lesson(ids.text);
    expect([l.title, l.body, l.isRequired, l.version]).toEqual(["Openers", "# v1", true, 4]);
    const after = await lessonHistory(db, await coach(), ids.course, ids.text);
    expect(after.versions[0]).toMatchObject({ version: 3, reason: "Restored version 1" });
    expect(after.versions[0].changes.map((c) => c.field).sort()).toEqual(["content", "required flag", "title"]);
    await expect(restoreLessonVersion(db, await coach(), ids.course, ids.text, 99)).rejects.toBeInstanceOf(NotFoundError);
    await expect(restoreLessonVersion(db, await coach2(), ids.course, ids.text, 1)).rejects.toBeInstanceOf(NotFoundError);
    // a learner's completion from before the restore is intact
    expect((await db.lessonProgress.findUniqueOrThrow({ where: { lessonId_agentProfileId: { lessonId: ids.text, agentProfileId: ids.agentProfile } } })).status).toBe("COMPLETED");
  });
});
