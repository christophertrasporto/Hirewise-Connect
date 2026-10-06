import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDb, resetDb } from "../setup/db";
import { createCourse, updateCourse, updateCourseSettings, saveModule, saveLesson, duplicateModule, duplicateLesson, getCourseForCoach, getLessonForCoach, createLessonUploadUrl, setCourseCertificationTemplate, catalogForAgent, enrol, getEnrollmentForAgent } from "@/server/services/academy.service";
import { listCategories, saveCategory } from "@/server/services/category.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { resetEnvCache } from "@/server/env";
import { resetStorageForTests } from "@/server/adapters/storage";
import { ROLE_NAMES, ROLE_PERMISSIONS, type RoleKey } from "@/server/policies/permissions";

const db = testDb();
let dir = "";
const ids = { coach: "coach_b", coach2: "coach_b2", admin: "admin_b", sales: "sales_b", agentUser: "", agentProfile: "", cat: "", cat2: "", course: "", other: "", m1: "", m2: "", quiz: "", audio: "", assignment: "", text: "", template: "" };

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hw-cb-"));
  process.env.APP_URL = "http://localhost:3000";
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  resetEnvCache();
  resetStorageForTests();
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.user.create({ data: { id: ids.coach, email: "coach@hirewise.example", roleId: await role("COACH") } });
  await db.user.create({ data: { id: ids.coach2, email: "coach2@hirewise.example", roleId: await role("COACH") } });
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN") } });
  await db.user.create({ data: { id: ids.sales, email: "sales@hirewise.example", roleId: await role("SALES") } });
  const au = await db.user.create({ data: { email: "agent@t.example", roleId: await role("AGENT"), emailVerifiedAt: new Date() } });
  ids.agentUser = au.id;
  ids.agentProfile = (await db.agentProfile.create({ data: { userId: au.id, displayName: "Agent", headline: "H", primaryRole: "VA", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila" } })).id;
  ids.template = (await db.certificationTemplate.create({ data: { name: "Certified Caller", requiresCompletion: true, minExamScore: 70 } })).id;
});

afterAll(async () => {
  resetStorageForTests();
  rmSync(dir, { recursive: true, force: true });
  await db.$disconnect();
});

const coach = () => resolveActor(db, ids.coach);
const coach2 = () => resolveActor(db, ids.coach2);
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const agent = () => makeActor("AGENT", { userId: ids.agentUser, agentProfileId: ids.agentProfile });

const base = () => ({ title: "Cold Calling Mastery", categoryId: ids.cat, description: "A course description long enough to satisfy validation rules.", difficulty: "INTERMEDIATE" as const, estimatedMinutes: 240, introVideoUrl: "https://youtu.be/abc", welcomeMessage: "Welcome!", syllabus: "", contentUrl: "", priceUsd: "", passingScore: 70, requiresCoachReview: false });

describe("categories (admin-managed)", () => {
  it("admin creates, renames, and deactivates categories; coaches cannot; names are unique", async () => {
    await expect(saveCategory(db, await coach(), { name: "Sales", order: 1, isActive: true })).rejects.toBeInstanceOf(ForbiddenError);
    const c = await saveCategory(db, admin(), { name: "Cold Calling", order: 30, isActive: true });
    ids.cat = c.id;
    expect(c.slug).toBe("cold-calling");
    const c2 = await saveCategory(db, admin(), { name: "AI & Automation", order: 100, isActive: true });
    ids.cat2 = c2.id;
    expect(c2.slug).toBe("ai-and-automation");
    await expect(saveCategory(db, admin(), { name: "Cold Calling", order: 1, isActive: true })).rejects.toThrow(/already exists/);
    const renamed = await saveCategory(db, admin(), { id: c2.id, name: "AI and Automation", order: 100, isActive: false });
    expect(renamed.isActive).toBe(false);
    expect((await listCategories(db)).map((x) => x.name)).toEqual(["Cold Calling"]);
    expect((await listCategories(db, { includeInactive: true })).map((x) => x.name)).toEqual(["Cold Calling", "AI and Automation"]);
  });
});

describe("course overview and settings", () => {
  it("a coach creates a course with builder fields; the legacy category text follows the category; inactive categories are refused", async () => {
    await expect(createCourse(db, await coach(), { ...base(), categoryId: ids.cat2 })).rejects.toThrow(/active category/);
    await expect(createCourse(db, sales(), base())).rejects.toBeInstanceOf(ForbiddenError);
    ids.course = await createCourse(db, await coach(), base());
    ids.other = await createCourse(db, await coach(), { ...base(), title: "Foundation", estimatedMinutes: "" });
    const { course } = await getCourseForCoach(db, await coach(), ids.course);
    expect(course.category).toBe("Cold Calling");
    expect(course.categoryId).toBe(ids.cat);
    expect(course.difficulty).toBe("INTERMEDIATE");
    expect(course.estimatedMinutes).toBe(240);
    expect(course.introVideoUrl).toBe("https://youtu.be/abc");
    await updateCourse(db, await coach(), ids.course, { ...base(), title: "Cold Calling Mastery 2", difficulty: "ADVANCED", introVideoUrl: "" });
    const after = await db.academyCourse.findUniqueOrThrow({ where: { id: ids.course } });
    expect(after.title).toBe("Cold Calling Mastery 2");
    expect(after.difficulty).toBe("ADVANCED");
    expect(after.introVideoUrl).toBeNull();
    // renaming the category keeps courses in sync
    await saveCategory(db, admin(), { id: ids.cat, name: "Cold Calling & Prospecting", order: 30, isActive: true });
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id: ids.course } })).category).toBe("Cold Calling & Prospecting");
  });

  it("settings: completion rules, sequential unlock, prerequisites, access gate; the other coach gets NotFound", async () => {
    await expect(updateCourseSettings(db, await coach2(), ids.course, { prerequisiteIds: [] })).rejects.toBeInstanceOf(NotFoundError);
    await updateCourseSettings(db, await coach(), ids.course, { isRequired: true, sequentialUnlock: true, completionRequiresQuizPass: true, completionRequiresFinalAssessment: true, displayOrder: 5, prerequisiteIds: [ids.other, ids.course], minVerificationLevel: "VERIFIED" });
    const { course } = await getCourseForCoach(db, await coach(), ids.course);
    expect(course.isRequired).toBe(true);
    expect(course.sequentialUnlock).toBe(true);
    expect(course.completionRequiresFinalAssessment).toBe(true);
    expect(course.displayOrder).toBe(5);
    expect(course.prerequisites.map((p) => p.id)).toEqual([ids.other]); // self-reference dropped
    expect(course.accessRules).toEqual({ minVerificationLevel: "VERIFIED" });
    await expect(updateCourseSettings(db, await coach(), ids.course, { prerequisiteIds: ["nope"] })).rejects.toBeInstanceOf(NotFoundError);
    await updateCourseSettings(db, await coach(), ids.course, { prerequisiteIds: [], minVerificationLevel: "" });
    expect((await getCourseForCoach(db, await coach(), ids.course)).course.prerequisites).toEqual([]);
  });

  it("only Admin links a certification template; inactive templates are refused", async () => {
    await expect(setCourseCertificationTemplate(db, await coach(), ids.course, ids.template)).rejects.toBeInstanceOf(ForbiddenError);
    await setCourseCertificationTemplate(db, admin(), ids.course, ids.template);
    expect((await getCourseForCoach(db, admin(), ids.course)).course.certificationTemplate?.id).toBe(ids.template);
    await setCourseCertificationTemplate(db, admin(), ids.course, null);
    expect((await getCourseForCoach(db, admin(), ids.course)).course.certificationTemplate).toBeNull();
  });
});

describe("modules and lessons: flags, type-driven settings, duplicates", () => {
  it("modules carry required and draft flags; lessons of every type store only the fields their type uses", async () => {
    ids.m1 = await saveModule(db, await coach(), ids.course, { title: "Module 1", description: "", isRequired: true, status: "PUBLISHED" });
    ids.m2 = await saveModule(db, await coach(), ids.course, { title: "Module 2 (draft)", description: "", isRequired: false, status: "DRAFT" });

    await expect(saveLesson(db, await coach(), ids.course, { moduleId: ids.m1, title: "Quiz without pass mark", contentType: "QUIZ" })).rejects.toThrow();
    await expect(saveLesson(db, await coach(), ids.course, { moduleId: ids.m1, title: "Assignment without type", contentType: "ASSIGNMENT", body: "Do it" })).rejects.toThrow();

    ids.text = await saveLesson(db, await coach(), ids.course, { moduleId: ids.m1, title: "Intro", contentType: "TEXT", body: "# Hi", passingScore: 55, maxAttempts: 3, submissionType: "URL", status: "PUBLISHED", isRequired: true });
    ids.quiz = await saveLesson(db, await coach(), ids.course, { moduleId: ids.m1, title: "Module quiz", contentType: "QUIZ", body: "Ten questions.", passingScore: 80, maxAttempts: 2, timeLimitMin: 15, randomizeCount: 10, shuffleAnswers: true, showCorrectAnswers: false, showExplanations: true, retakeWaitMinutes: 60, scorePolicy: "LATEST", isRequired: true });
    ids.assignment = await saveLesson(db, await coach(), ids.course, { moduleId: ids.m1, title: "Record a call", contentType: "ASSIGNMENT", body: "Upload a recording link", submissionType: "URL", dueAt: "2030-01-31", points: 20, isRequired: false, status: "DRAFT" });
    ids.audio = await saveLesson(db, await coach(), ids.course, { moduleId: ids.m2, title: "Gatekeeper audiobook", contentType: "AUDIO", storageKey: "", url: "", passingScore: 70, requiredPercent: 85 } as never).catch(() => "");
    expect(ids.audio).toBe(""); // audio needs an uploaded file

    const lessons = (await db.courseLesson.findMany({ where: { module: { courseId: ids.course } }, orderBy: { order: "asc" } }));
    const text = lessons.find((l) => l.id === ids.text)!;
    expect(text.passingScore).toBeNull();
    expect(text.maxAttempts).toBeNull();
    expect(text.submissionType).toBeNull();
    const quiz = lessons.find((l) => l.id === ids.quiz)!;
    expect(quiz).toMatchObject({ passingScore: 80, maxAttempts: 2, timeLimitMin: 15, randomizeCount: 10, shuffleAnswers: true, showCorrectAnswers: false, showExplanations: true, retakeWaitMinutes: 60, scorePolicy: "LATEST", reviewMode: "AUTO", isRequired: true, status: "PUBLISHED" });
    const assignment = lessons.find((l) => l.id === ids.assignment)!;
    expect(assignment.submissionType).toBe("URL");
    expect(assignment.points).toBe(20);
    expect(assignment.dueAt?.toISOString().slice(0, 10)).toBe("2030-01-31");
    expect(assignment.status).toBe("DRAFT");
    expect(assignment.isRequired).toBe(false);
    expect(assignment.passingScore).toBeNull();

    const { lesson } = await getLessonForCoach(db, await coach(), ids.course, ids.quiz);
    expect(lesson.module.id).toBe(ids.m1);
    expect(lesson.questions).toEqual([]);
    await expect(getLessonForCoach(db, await coach2(), ids.course, ids.quiz)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("learners see only published modules and lessons; drafts do not count toward the outline", async () => {
    await db.academyCourse.update({ where: { id: ids.course }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    const catalog = await catalogForAgent(db, agent());
    const card = catalog.find((c) => c.id === ids.course)!;
    expect(card.lessonCount).toBe(2); // text + quiz; the draft assignment and the draft module are hidden
    expect(card.outline.map((m) => m.title)).toEqual(["Module 1"]);
    expect(card.outline[0].lessons.map((l) => l.title)).toEqual(["Intro", "Module quiz"]);
    expect(card.difficulty).toBe("ADVANCED");
    await enrol(db, agent(), ids.course);
    const view = await getEnrollmentForAgent(db, agent(), ids.course);
    expect(view.course.modules?.[0].lessons.map((l) => l.contentType)).toEqual(["TEXT", "QUIZ"]);
    expect(view.course.modules?.[0].lessons[1].questionCount).toBe(0);
  });

  it("duplicating a module copies its lessons as drafts; duplicating a lesson appends a draft copy; learner data is never copied", async () => {
    await db.lessonProgress.create({ data: { lessonId: ids.text, agentProfileId: ids.agentProfile, status: "COMPLETED", completedAt: new Date() } });
    const copyId = await duplicateModule(db, await coach(), ids.course, ids.m1);
    const copy = await db.courseModule.findUniqueOrThrow({ where: { id: copyId }, include: { lessons: { orderBy: { order: "asc" } } } });
    expect(copy.title).toBe("Module 1 (copy)");
    expect(copy.status).toBe("DRAFT");
    expect(copy.order).toBe(3);
    expect(copy.lessons.map((l) => [l.title, l.status, l.contentType])).toEqual([["Intro", "DRAFT", "TEXT"], ["Module quiz", "DRAFT", "QUIZ"], ["Record a call", "DRAFT", "ASSIGNMENT"]]);
    expect(copy.lessons[1].passingScore).toBe(80);
    expect(await db.lessonProgress.count({ where: { lessonId: { in: copy.lessons.map((l) => l.id) } } })).toBe(0);

    const lessonCopy = await duplicateLesson(db, await coach(), ids.course, ids.quiz);
    const lc = await db.courseLesson.findUniqueOrThrow({ where: { id: lessonCopy } });
    expect(lc.title).toBe("Module quiz (copy)");
    expect(lc.moduleId).toBe(ids.m1);
    expect(lc.order).toBe(4);
    expect(lc.status).toBe("DRAFT");
    await expect(duplicateLesson(db, await coach2(), ids.course, ids.quiz)).rejects.toBeInstanceOf(NotFoundError);
    await expect(duplicateModule(db, await coach(), ids.other, ids.m1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("audio and video uploads need course.audio.upload; documents only need course.create_own; Admin always may", async () => {
    const limited = { ...makeActor("COACH", { userId: ids.coach }), permissions: new Set(ROLE_PERMISSIONS.COACH.filter((k) => k !== "course.audio.upload")) };
    await expect(createLessonUploadUrl(db, limited, ids.course, { kind: "AUDIO", contentType: "audio/mpeg", sizeBytes: 10 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createLessonUploadUrl(db, limited, ids.course, { kind: "VIDEO", contentType: "video/mp4", sizeBytes: 10 })).rejects.toBeInstanceOf(ForbiddenError);
    const doc = await createLessonUploadUrl(db, limited, ids.course, { kind: "DOCUMENT", contentType: "application/pdf", sizeBytes: 10 });
    expect(doc.key).toContain(`courses/${ids.course}/lessons/document/`);
    const full = await coach();
    expect((await createLessonUploadUrl(db, full, ids.course, { kind: "AUDIO", contentType: "audio/mpeg", sizeBytes: 10 })).key).toContain("/lessons/audio/");
    expect((await createLessonUploadUrl(db, admin(), ids.course, { kind: "AUDIO", contentType: "audio/mpeg", sizeBytes: 10 })).key).toContain("/lessons/audio/");
  });
});
