import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDb, resetDb } from "../setup/db";
import { createCourse, submitCourseForApproval, publishCourse, updateCourse, getCourseForCoach, saveModule, deleteModule, moveModule, saveLesson, deleteLesson, moveLesson, createLessonUploadUrl, lessonDownloadUrl, enrol, getEnrollmentForAgent, catalogForAgent, KEEP_FILE } from "@/server/services/academy.service";
import { saveQuestion, deleteQuestion, startAttempt, attemptForLearner, submitAttempt } from "@/server/services/quiz.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";
import { getStorage, resetStorageForTests } from "@/server/adapters/storage";
import { collectKeys } from "@/server/views/forbidden-keys";

const db = testDb();
let dir = "";
const ids = { coach: "coach_c1", coach2: "coach_c2", admin: "admin_c1", agentUser: "", agentProfile: "", agent2User: "", agent2Profile: "", course: "", paid: "", m1: "", m2: "", text: "", link: "", video: "", doc: "" };

let salesCategoryId = "";
const courseInput = (title: string, priceUsd: string) => ({ title, categoryId: salesCategoryId, difficulty: "BEGINNER" as const, description: "A course description long enough to satisfy validation rules.", syllabus: "", contentUrl: "", priceUsd, passingScore: 60, requiresCoachReview: false });
/** A quiz lesson with two published questions in the given module. */
async function buildQuiz(courseId: string, moduleId: string) {
  const actor = await coach();
  const lessonId = await saveLesson(db, actor, courseId, { moduleId, title: "Module quiz", contentType: "QUIZ", passingScore: 60, maxAttempts: 2 });
  await saveQuestion(db, actor, courseId, lessonId, { prompt: "Question one prompt", points: 1, choices: [{ text: "A" }, { text: "B", isCorrect: true }, { text: "C" }] });
  await saveQuestion(db, actor, courseId, lessonId, { prompt: "Question two prompt", points: 1, choices: [{ text: "A", isCorrect: true }, { text: "B" }] });
  return lessonId;
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hw-cur-"));
  process.env.APP_URL = "http://localhost:3000";
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  resetEnvCache();
  resetStorageForTests();
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  salesCategoryId = (await db.courseCategory.create({ data: { name: "Sales", slug: "sales", order: 10 } })).id;
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.user.create({ data: { id: ids.coach, email: "coach@hirewise.example", roleId: await role("COACH") } });
  await db.user.create({ data: { id: ids.coach2, email: "coach2@hirewise.example", roleId: await role("COACH") } });
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN") } });
  const agentRole = await role("AGENT");
  const mk = async (email: string, name: string) => {
    const u = await db.user.create({ data: { email, roleId: agentRole } });
    const p = await db.agentProfile.create({ data: { userId: u.id, displayName: name, headline: "H", primaryRole: "Appointment Setter", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila" } });
    return { u, p };
  };
  const a1 = await mk("agent1@t.example", "Agent One");
  const a2 = await mk("agent2@t.example", "Agent Two");
  ids.agentUser = a1.u.id; ids.agentProfile = a1.p.id; ids.agent2User = a2.u.id; ids.agent2Profile = a2.p.id;
});

afterAll(async () => {
  resetStorageForTests();
  rmSync(dir, { recursive: true, force: true });
  await db.$disconnect();
});

const coach = () => resolveActor(db, ids.coach);
const coach2 = () => resolveActor(db, ids.coach2);
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const agent = () => makeActor("AGENT", { userId: ids.agentUser, agentProfileId: ids.agentProfile });
const agent2 = () => makeActor("AGENT", { userId: ids.agent2User, agentProfileId: ids.agent2Profile });

describe("curriculum: modules and lessons of every content type", () => {
  it("the owner coach builds modules and lessons; validation is per content type", async () => {
    ids.course = await createCourse(db, await coach(), courseInput("Curriculum course", ""));
    ids.paid = await createCourse(db, await coach(), courseInput("Paid curriculum course", "25"));
    ids.m1 = await saveModule(db, await coach(), ids.course, { title: "Module 1: Openers", description: "The first ten seconds." });
    ids.m2 = await saveModule(db, await coach(), ids.course, { title: "Module 2: Objections", description: "" });

    await expect(saveLesson(db, await coach(), ids.course, { moduleId: ids.m1, title: "Empty text", contentType: "TEXT", body: "" } as never)).rejects.toThrow();
    await expect(saveLesson(db, await coach(), ids.course, { moduleId: ids.m1, title: "No link", contentType: "LINK", url: "" } as never)).rejects.toThrow();
    await expect(saveLesson(db, await coach(), ids.course, { moduleId: ids.m1, title: "No file", contentType: "DOCUMENT" } as never)).rejects.toThrow();

    ids.text = await saveLesson(db, await coach(), ids.course, { moduleId: ids.m1, title: "Why openers matter", contentType: "TEXT", body: "## Earn permission\n\nThe first ten seconds decide the call." });
    ids.link = await saveLesson(db, await coach(), ids.course, { moduleId: ids.m1, title: "Reading: objection handling", contentType: "LINK", url: "https://example.com/objections" });
    ids.video = await saveLesson(db, await coach(), ids.course, { moduleId: ids.m2, title: "Role-play walkthrough", contentType: "VIDEO", url: "https://youtu.be/abc123", durationSec: 540 });

    const { course } = await getCourseForCoach(db, await coach(), ids.course);
    expect(course.modules.map((m) => m.title)).toEqual(["Module 1: Openers", "Module 2: Objections"]);
    expect(course.modules[0].lessons.map((l) => [l.order, l.contentType])).toEqual([[1, "TEXT"], [2, "LINK"]]);
    expect(course.lessonCount).toBe(3);
    // a LINK lesson never carries file fields, a TEXT lesson never carries a url
    expect(course.modules[0].lessons[1].storageKey).toBeNull();
    expect(course.modules[0].lessons[0].url).toBeNull();
  });

  it("another coach gets NotFound, agents are refused, admin may edit", async () => {
    await expect(saveModule(db, await coach2(), ids.course, { title: "Intruder", description: "" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveLesson(db, await coach2(), ids.course, { moduleId: ids.m1, title: "Intruder", contentType: "TEXT", body: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteLesson(db, await coach2(), ids.course, ids.text)).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveModule(db, agent(), ids.course, { title: "Agent", description: "" })).rejects.toBeInstanceOf(ForbiddenError);
    // a module id from another course is NotFound even for the owner
    const otherModule = await saveModule(db, await coach(), ids.paid, { title: "Paid module", description: "" });
    await expect(saveLesson(db, await coach(), ids.course, { moduleId: otherModule, title: "Cross-course", contentType: "TEXT", body: "x" })).rejects.toBeInstanceOf(NotFoundError);
    const id = await saveModule(db, admin(), ids.course, { id: ids.m2, title: "Module 2: Handling objections", description: "Price, timing, trust." });
    expect(id).toBe(ids.m2);
    expect(await db.auditLog.count({ where: { entityType: "CourseModule", entityId: ids.m2 } })).toBeGreaterThan(0);
  });

  it("uploaded files: MIME and size are enforced, keys are scoped to the course, and the file must exist", async () => {
    await expect(createLessonUploadUrl(db, await coach(), ids.course, { kind: "DOCUMENT", contentType: "application/x-msdownload", sizeBytes: 100 })).rejects.toThrow(/Unsupported/);
    await expect(createLessonUploadUrl(db, await coach(), ids.course, { kind: "AUDIO", contentType: "audio/mpeg", sizeBytes: 101 * 1024 * 1024 })).rejects.toThrow(/too large/);
    await expect(createLessonUploadUrl(db, await coach2(), ids.course, { kind: "DOCUMENT", contentType: "application/pdf", sizeBytes: 100 })).rejects.toBeInstanceOf(NotFoundError);

    const up = await createLessonUploadUrl(db, await coach(), ids.course, { kind: "DOCUMENT", contentType: "application/pdf", sizeBytes: 5, fileName: "handout.pdf" });
    expect(up.key.startsWith(`courses/${ids.course}/lessons/document/`)).toBe(true);
    expect(up.method).toBe("PUT");

    // not uploaded yet
    await expect(saveLesson(db, await coach(), ids.course, { moduleId: ids.m2, title: "Handout", contentType: "DOCUMENT", storageKey: up.key, fileName: "handout.pdf", contentMime: "application/pdf", sizeBytes: 5 })).rejects.toThrow(/not uploaded/);
    await getStorage().put(up.key, Buffer.from("%PDF-"), "application/pdf");
    ids.doc = await saveLesson(db, await coach(), ids.course, { moduleId: ids.m2, title: "Handout", contentType: "DOCUMENT", storageKey: up.key, fileName: "handout.pdf", contentMime: "application/pdf", sizeBytes: 5 });

    // a key from another course's prefix is refused even if it exists
    const foreign = `courses/${ids.paid}/lessons/document/x.pdf`;
    await getStorage().put(foreign, Buffer.from("%PDF-"), "application/pdf");
    await expect(saveLesson(db, await coach(), ids.course, { moduleId: ids.m2, title: "Foreign", contentType: "DOCUMENT", storageKey: foreign })).rejects.toBeInstanceOf(ForbiddenError);

    // editing the title with the KEEP_FILE sentinel keeps the stored file
    await saveLesson(db, await coach(), ids.course, { id: ids.doc, moduleId: ids.m2, title: "Handout (v2)", contentType: "DOCUMENT", storageKey: KEEP_FILE });
    const l = await db.courseLesson.findUniqueOrThrow({ where: { id: ids.doc } });
    expect(l.title).toBe("Handout (v2)");
    expect(l.storageKey).toBe(up.key);
    expect(l.fileName).toBe("handout.pdf");
  });

  it("reordering and deleting keep a dense order; deleting a module removes its lessons", async () => {
    await moveLesson(db, await coach(), ids.course, ids.link, -1);
    let m1 = await db.courseModule.findUniqueOrThrow({ where: { id: ids.m1 }, include: { lessons: { orderBy: { order: "asc" } } } });
    expect(m1.lessons.map((l) => l.id)).toEqual([ids.link, ids.text]);
    await moveLesson(db, await coach(), ids.course, ids.link, -1); // already first: no-op
    m1 = await db.courseModule.findUniqueOrThrow({ where: { id: ids.m1 }, include: { lessons: { orderBy: { order: "asc" } } } });
    expect(m1.lessons.map((l) => l.order)).toEqual([1, 2]);

    await moveModule(db, await coach(), ids.course, ids.m2, -1);
    let mods = await db.courseModule.findMany({ where: { courseId: ids.course }, orderBy: { order: "asc" } });
    expect(mods.map((m) => m.id)).toEqual([ids.m2, ids.m1]);
    expect(mods.map((m) => m.order)).toEqual([1, 2]);
    await moveModule(db, await coach(), ids.course, ids.m2, 1);

    // move a lesson to another module through saveLesson
    await saveLesson(db, await coach(), ids.course, { id: ids.link, moduleId: ids.m2, title: "Reading: objection handling", contentType: "LINK", url: "https://example.com/objections" });
    m1 = await db.courseModule.findUniqueOrThrow({ where: { id: ids.m1 }, include: { lessons: { orderBy: { order: "asc" } } } });
    expect(m1.lessons.map((l) => [l.id, l.order])).toEqual([[ids.text, 1]]);
    const m2 = await db.courseModule.findUniqueOrThrow({ where: { id: ids.m2 }, include: { lessons: { orderBy: { order: "asc" } } } });
    expect(m2.lessons.map((l) => l.id)).toEqual([ids.video, ids.doc, ids.link]);

    const scratch = await saveModule(db, await coach(), ids.course, { title: "Scratch", description: "" });
    const scratchLesson = await saveLesson(db, await coach(), ids.course, { moduleId: scratch, title: "Temp", contentType: "TEXT", body: "temp" });
    await deleteModule(db, await coach(), ids.course, scratch);
    expect(await db.courseLesson.findUnique({ where: { id: scratchLesson } })).toBeNull();
    mods = await db.courseModule.findMany({ where: { courseId: ids.course }, orderBy: { order: "asc" } });
    expect(mods.map((m) => m.order)).toEqual([1, 2]);
  });
});

describe("editing after publishing", () => {
  it("details, curriculum, and questions stay editable while PUBLISHED; open attempts keep their frozen snapshot", async () => {
    const quiz = await buildQuiz(ids.course, ids.m1);
    const paidModule = await saveModule(db, await coach(), ids.paid, { title: "Module 1", description: "" });
    await buildQuiz(ids.paid, paidModule);
    await submitCourseForApproval(db, await coach(), ids.course);
    await submitCourseForApproval(db, await coach(), ids.paid);
    await publishCourse(db, admin(), ids.course, {});
    await publishCourse(db, admin(), ids.paid, {});

    const before = await db.question.findMany({ where: { lessonId: quiz }, orderBy: { order: "asc" }, include: { choices: { orderBy: { order: "asc" } } } });
    expect(before).toHaveLength(2);

    // an agent is mid-attempt when the coach edits the quiz
    await enrol(db, agent(), ids.course);
    const attemptId = await startAttempt(db, agent(), quiz);

    await updateCourse(db, await coach(), ids.course, { ...courseInput("Curriculum course, 2nd edition", ""), syllabus: "Updated overview" });
    const newModule = await saveModule(db, await coach(), ids.course, { title: "Module 3: Booking", description: "" });
    await saveLesson(db, await coach(), ids.course, { moduleId: newModule, title: "Closing for the appointment", contentType: "TEXT", body: "Ask for a specific time." });
    await saveQuestion(db, await coach(), ids.course, quiz, { id: before[0].id, prompt: "Question one prompt, reworded", points: 2, choices: before[0].choices.map((c) => ({ id: c.id, text: c.text, isCorrect: c.isCorrect })) });
    await deleteQuestion(db, await coach(), ids.course, before[1].id);
    const q3 = await saveQuestion(db, await coach(), ids.course, quiz, { prompt: "Brand new question three", points: 1, choices: [{ text: "Yes", isCorrect: true }, { text: "No" }] });

    const c = await db.academyCourse.findUniqueOrThrow({ where: { id: ids.course }, include: { modules: true } });
    expect(c.status).toBe("PUBLISHED");
    expect(c.title).toBe("Curriculum course, 2nd edition");
    expect(c.modules).toHaveLength(3);
    const now = await db.question.findMany({ where: { lessonId: quiz }, orderBy: { order: "asc" }, include: { choices: true } });
    expect(now.map((q) => q.id)).toEqual([before[0].id, q3]);
    expect(now.map((q) => q.order)).toEqual([1, 2]);
    expect(now[0].prompt).toBe("Question one prompt, reworded");
    expect(now[0].points).toBe(2);
    expect(now[0].version).toBe(2);
    expect(now[0].choices.map((x) => x.id).sort()).toEqual(before[0].choices.map((x) => x.id).sort()); // choice ids survive the edit
    expect(await db.question.findUnique({ where: { id: before[1].id } })).toBeNull();

    // the open attempt still shows the two questions it started with and grades against that snapshot
    const view = await attemptForLearner(db, agent(), attemptId);
    expect(view.questions.map((q) => q.questionId)).toEqual(before.map((q) => q.id));
    expect(view.questions[0].prompt).toBe("Question one prompt");
    const pick = (i: number, text: string) => view.questions[i].choices.filter((x) => x.text === text).map((x) => x.id);
    const r = await submitAttempt(db, agent(), attemptId, { [before[0].id]: pick(0, "B"), [before[1].id]: pick(1, "A") });
    expect(r.scorePercent).toBe(100);
    expect(r.passed).toBe(true);
  });
});

describe("what agents see", () => {
  it("catalog and locked enrolments show the outline only; unlocked enrolments get the content but never a storage key", async () => {
    const catalog = await catalogForAgent(db, agent2());
    const card = catalog.find((c) => c.id === ids.course)!;
    expect(card.lessonCount).toBe(6);
    expect(card.modules).toBeNull();
    expect(card.outline.map((m) => m.title)).toEqual(["Module 1: Openers", "Module 2: Handling objections", "Module 3: Booking"]);
    expect(card.outline[1].lessons.map((l) => l.contentType)).toEqual(["VIDEO", "DOCUMENT", "LINK"]);
    expect(JSON.stringify(card)).not.toContain("storageKey");
    expect(JSON.stringify(card)).not.toContain("Earn permission");

    // not enrolled: no content, no files
    const notEnrolled = await getEnrollmentForAgent(db, agent2(), ids.course);
    expect(notEnrolled.course.modules).toBeNull();
    await expect(lessonDownloadUrl(db, agent2(), ids.doc)).rejects.toBeInstanceOf(NotFoundError);

    // paid and pending: outline only, no files
    await enrol(db, agent2(), ids.paid);
    const pending = await getEnrollmentForAgent(db, agent2(), ids.paid);
    expect(pending.enrollment?.paymentStatus).toBe("PENDING");
    expect(pending.course.modules).toBeNull();

    // enrolled on the free course: full content
    const unlocked = await getEnrollmentForAgent(db, agent(), ids.course);
    expect(unlocked.course.modules).not.toBeNull();
    const m2 = unlocked.course.modules!.find((m) => m.id === ids.m2)!;
    const doc = m2.lessons.find((l) => l.id === ids.doc)!;
    expect(doc.hasFile).toBe(true);
    expect(doc.fileName).toBe("handout.pdf");
    const text = unlocked.course.modules!.find((m) => m.id === ids.m1)!.lessons[0];
    expect(text.body).toContain("Earn permission");
    const keys = collectKeys(unlocked);
    expect(keys.has("storageKey")).toBe(false);
    expect(keys.has("isCorrect")).toBe(false);
    expect(keys.has("correctChoiceIds")).toBe(false);

    const url = await lessonDownloadUrl(db, agent(), ids.doc);
    expect(url).toContain("/api/storage/");
    expect(await lessonDownloadUrl(db, await coach(), ids.doc)).toContain("/api/storage/");
    expect(await lessonDownloadUrl(db, admin(), ids.doc)).toContain("/api/storage/");
    await expect(lessonDownloadUrl(db, await coach2(), ids.doc)).rejects.toBeInstanceOf(NotFoundError);
    await expect(lessonDownloadUrl(db, agent(), ids.text)).rejects.toBeInstanceOf(NotFoundError); // no file on a text lesson
  });
});
