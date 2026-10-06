import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { createCourse, saveModule, saveLesson, submitCourseForApproval, publishCourse, enrol } from "@/server/services/academy.service";
import { saveQuestion, deleteQuestion, duplicateQuestion, startAttempt, attemptForLearner, quizStateForLearner } from "@/server/services/quiz.service";
import { listQuestionBank, saveBankQuestion, copyQuestionToLesson, copyQuestionToBank } from "@/server/services/question-bank.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, ROLE_PERMISSIONS, type RoleKey } from "@/server/policies/permissions";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";

const db = testDb();
const ids = { coach: "coach_qb", coach2: "coach_qb2", admin: "admin_qb", agentUser: "", agentProfile: "", cat: "", course: "", otherCourse: "", module: "", quizA: "", quizB: "", text: "", qA1: "", qA2: "", bank1: "", bank2: "" };

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
const mc = (prompt: string, over: Record<string, unknown> = {}) => ({ prompt, choices: [{ text: "Right", isCorrect: true }, { text: "Wrong", isCorrect: false }], ...over });

describe("question bank", () => {
  it("lists every question on the course with topic, difficulty, and location; filters and search work", async () => {
    const c = await coach();
    ids.course = await createCourse(db, c, { title: "Bank course", categoryId: ids.cat, description: "A course description long enough to satisfy validation rules.", difficulty: "BEGINNER", passingScore: 60, requiresCoachReview: false, priceUsd: "", syllabus: "", contentUrl: "" });
    ids.module = await saveModule(db, c, ids.course, { title: "Module 1", description: "" });
    ids.quizA = await saveLesson(db, c, ids.course, { moduleId: ids.module, title: "Quiz A", contentType: "QUIZ", passingScore: 60 });
    ids.quizB = await saveLesson(db, c, ids.course, { moduleId: ids.module, title: "Quiz B", contentType: "QUIZ", passingScore: 60, randomizeCount: 2 });
    ids.text = await saveLesson(db, c, ids.course, { moduleId: ids.module, title: "Reading", contentType: "TEXT", body: "x" });
    ids.qA1 = await saveQuestion(db, c, ids.course, ids.quizA, mc("What earns permission to continue?", { topic: "Openers", difficulty: "BEGINNER" }));
    ids.qA2 = await saveQuestion(db, c, ids.course, ids.quizA, mc("Handle the price objection", { topic: "Objections", difficulty: "ADVANCED" }));
    ids.bank1 = await saveBankQuestion(db, c, ids.course, mc("Bank: name the CRM field", { topic: "CRM", difficulty: "INTERMEDIATE" }));
    ids.bank2 = await saveBankQuestion(db, c, ids.course, { type: "SHORT_ANSWER", prompt: "Bank: describe your opener", keywords: ["permission"], topic: "Openers" });
    expect((await db.question.findUniqueOrThrow({ where: { id: ids.bank1 } }))).toMatchObject({ lessonId: null, courseId: ids.course, topic: "CRM", difficulty: "INTERMEDIATE", order: 0 });
    expect((await db.question.findUniqueOrThrow({ where: { id: ids.qA1 } }))).toMatchObject({ topic: "Openers", difficulty: "BEGINNER" });

    const all = await listQuestionBank(db, c, ids.course);
    expect(all).toMatchObject({ total: 4, bankOnly: 2 });
    expect(all.topics).toEqual(["CRM", "Objections", "Openers"]);
    expect(all.lessons.map((l) => l.title)).toEqual(["Quiz A"]);
    expect(all.items.find((i) => i.id === ids.qA1)?.lesson).toEqual({ id: ids.quizA, title: "Quiz A", module: "Module 1" });
    expect(all.items.find((i) => i.id === ids.bank1)?.lesson).toBeNull();
    expect((await listQuestionBank(db, c, ids.course, { location: "BANK" })).items.map((i) => i.id).sort()).toEqual([ids.bank1, ids.bank2].sort());
    expect((await listQuestionBank(db, c, ids.course, { location: ids.quizA })).items).toHaveLength(2);
    expect((await listQuestionBank(db, c, ids.course, { topic: "Openers" })).items).toHaveLength(2);
    expect((await listQuestionBank(db, c, ids.course, { difficulty: "ADVANCED" })).items.map((i) => i.id)).toEqual([ids.qA2]);
    expect((await listQuestionBank(db, c, ids.course, { type: "SHORT_ANSWER" })).items.map((i) => i.id)).toEqual([ids.bank2]);
    expect((await listQuestionBank(db, c, ids.course, { q: "crm" })).items.map((i) => i.id)).toEqual([ids.bank1]);
    expect((await listQuestionBank(db, c, ids.course, { q: "wrong" })).items.length).toBe(3); // choice text is searched too
  });

  it("the bank is gated like the builder: other coaches NotFound, agents and coaches without quiz.build Forbidden", async () => {
    await expect(listQuestionBank(db, await coach2(), ids.course)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listQuestionBank(db, agent(), ids.course)).rejects.toBeInstanceOf(ForbiddenError);
    const limited = { ...makeActor("COACH", { userId: ids.coach }), permissions: new Set(ROLE_PERMISSIONS.COACH.filter((k) => k !== "course.quiz.build")) };
    await expect(saveBankQuestion(db, limited, ids.course, mc("No"))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listQuestionBank(db, admin(), ids.course)).total).toBe(4);
    // questions from another course never show up or get copied across
    ids.otherCourse = await createCourse(db, await coach2(), { title: "Other", categoryId: ids.cat, description: "A course description long enough to satisfy validation rules.", difficulty: "BEGINNER", passingScore: 60, requiresCoachReview: false, priceUsd: "", syllabus: "", contentUrl: "" });
    const foreign = await saveBankQuestion(db, await coach2(), ids.otherCourse, mc("Foreign question"));
    expect((await listQuestionBank(db, admin(), ids.course)).items.some((i) => i.id === foreign)).toBe(false);
    await expect(copyQuestionToLesson(db, admin(), ids.course, foreign, ids.quizA)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reuse copies with new ids: bank → lesson, lesson → lesson, lesson → bank; edits never cross over", async () => {
    const c = await coach();
    const copy1 = await copyQuestionToLesson(db, c, ids.course, ids.bank1, ids.quizB);
    const copy2 = await copyQuestionToLesson(db, c, ids.course, ids.qA1, ids.quizB);
    const copy3 = await copyQuestionToLesson(db, c, ids.course, ids.bank2, ids.quizB);
    const inB = await db.question.findMany({ where: { lessonId: ids.quizB }, orderBy: { order: "asc" }, include: { choices: true } });
    expect(inB.map((q) => [q.id, q.order, q.prompt])).toEqual([[copy1, 1, "Bank: name the CRM field"], [copy2, 2, "What earns permission to continue?"], [copy3, 3, "Bank: describe your opener"]]);
    expect(inB[0].choices.map((x) => x.id)).not.toContain((await db.questionChoice.findFirst({ where: { questionId: ids.bank1 } }))!.id);
    expect(inB[0]).toMatchObject({ topic: "CRM", difficulty: "INTERMEDIATE", state: "PUBLISHED", version: 1 });
    expect((await db.courseLesson.findUniqueOrThrow({ where: { id: ids.quizB } })).version).toBe(4); // three additions recorded
    await expect(copyQuestionToLesson(db, c, ids.course, copy1, ids.quizB)).rejects.toThrow(/already in this lesson/);
    await expect(copyQuestionToLesson(db, c, ids.course, ids.bank1, ids.text)).rejects.toThrow(/do not have questions/);

    // editing the copy in Quiz B does not touch the bank original or Quiz A
    await saveQuestion(db, c, ids.course, ids.quizB, { id: copy2, prompt: "Reworded in B", choices: inB[1].choices.map((x) => ({ id: x.id, text: x.text, isCorrect: x.isCorrect })) });
    expect((await db.question.findUniqueOrThrow({ where: { id: ids.qA1 } })).prompt).toBe("What earns permission to continue?");

    const toBank = await copyQuestionToBank(db, c, ids.course, ids.qA2);
    expect(await db.question.findUniqueOrThrow({ where: { id: toBank } })).toMatchObject({ lessonId: null, courseId: ids.course, prompt: "Handle the price objection", topic: "Objections" });
    await expect(copyQuestionToBank(db, c, ids.course, ids.bank1)).rejects.toThrow(/already in the bank/);
    expect((await listQuestionBank(db, c, ids.course)).bankOnly).toBe(3);
  });

  it("bank-only questions can be edited, duplicated, and deleted without touching lesson copies", async () => {
    const c = await coach();
    const choices = (await db.questionChoice.findMany({ where: { questionId: ids.bank1 }, orderBy: { order: "asc" } })).map((x) => ({ id: x.id, text: x.text, isCorrect: x.isCorrect }));
    await saveBankQuestion(db, c, ids.course, mc("Bank: name the CRM field (v2)", { id: ids.bank1, choices, topic: "CRM", difficulty: "ADVANCED" }));
    expect(await db.question.findUniqueOrThrow({ where: { id: ids.bank1 } })).toMatchObject({ prompt: "Bank: name the CRM field (v2)", difficulty: "ADVANCED", version: 2 });
    await expect(saveBankQuestion(db, c, ids.course, mc("Not a bank question", { id: ids.qA1 }))).rejects.toBeInstanceOf(NotFoundError);
    const dup = await duplicateQuestion(db, c, ids.course, ids.bank1);
    expect(await db.question.findUniqueOrThrow({ where: { id: dup } })).toMatchObject({ lessonId: null, state: "DRAFT" });
    await deleteQuestion(db, c, ids.course, dup);
    await deleteQuestion(db, c, ids.course, ids.bank1);
    expect(await db.question.findUnique({ where: { id: ids.bank1 } })).toBeNull();
    expect((await db.question.findMany({ where: { lessonId: ids.quizB } })).some((q) => q.prompt === "Bank: name the CRM field")).toBe(true); // the lesson copy survives
    await expect(deleteQuestion(db, await coach2(), ids.course, ids.bank2)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("random draws take N of the lesson's published questions per attempt", async () => {
    const c = await coach();
    await saveQuestion(db, c, ids.course, ids.quizB, mc("Fourth in B"));
    await submitCourseForApproval(db, c, ids.course);
    await publishCourse(db, admin(), ids.course, {});
    await enrol(db, agent(), ids.course);
    const st = await quizStateForLearner(db, agent(), ids.quizB);
    expect(st.lesson.questionCount).toBe(2); // randomizeCount 2 of 4 published
    const id = await startAttempt(db, agent(), ids.quizB);
    const v = await attemptForLearner(db, agent(), id);
    expect(v.questions).toHaveLength(2);
    const pool = new Set((await db.question.findMany({ where: { lessonId: ids.quizB } })).map((q) => q.id));
    expect(v.questions.every((q) => pool.has(q.questionId))).toBe(true);
  });
});
