import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDb, resetDb } from "../setup/db";
import { createCourse, saveModule, saveLesson, createLessonUploadUrl, submitCourseForApproval, publishCourse, enrol, getEnrollmentForAgent } from "@/server/services/academy.service";
import { saveQuestion, startAttempt, attemptForLearner, submitAttempt, quizStateForLearner } from "@/server/services/quiz.service";
import { recordMediaProgress, mediaStateForLearner, markLessonComplete } from "@/server/services/lesson-media.service";
import { myCourses } from "@/server/services/learner.service";
import { learnerTracking } from "@/server/services/tracking.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";
import { getStorage, resetStorageForTests } from "@/server/adapters/storage";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";
import { isQuizLesson, canHoldQuestions } from "@/lib/lesson-questions";

const db = testDb();
let dir = "";
const ids = { coach: "coach_vq", admin: "admin_vq", agentUser: "", agentProfile: "", cat: "", course: "", module: "", upload: "", youtube: "", vimeo: "", plain: "", text: "" };

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hw-vq-"));
  process.env.APP_URL = "http://localhost:3000";
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  resetEnvCache();
  resetStorageForTests();
  setEmailChannelForTests(new ConsoleEmailChannel());
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.user.create({ data: { id: ids.coach, email: "coach@hirewise.example", roleId: await role("COACH") } });
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN") } });
  const u = await db.user.create({ data: { email: "agent1@t.example", roleId: await role("AGENT"), emailVerifiedAt: new Date() } });
  const p = await db.agentProfile.create({ data: { userId: u.id, displayName: "Agent One", headline: "H", primaryRole: "VA", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila" } });
  ids.agentUser = u.id;
  ids.agentProfile = p.id;
  ids.cat = (await db.courseCategory.create({ data: { name: "Sales", slug: "sales", order: 1 } })).id;
});

afterAll(async () => {
  setEmailChannelForTests(null);
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const coach = () => resolveActor(db, ids.coach);
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const agent = () => makeActor("AGENT", { userId: ids.agentUser, agentProfileId: ids.agentProfile });

async function uploadedVideo(title: string, durationSec: number, requiredPercent: number) {
  const up = await createLessonUploadUrl(db, await coach(), ids.course, { kind: "VIDEO", contentType: "video/mp4", sizeBytes: 3, fileName: `${title}.mp4` });
  await getStorage().put(up.key, Buffer.from("mp4"), "video/mp4");
  return saveLesson(db, await coach(), ids.course, { moduleId: ids.module, title, contentType: "VIDEO", storageKey: up.key, fileName: `${title}.mp4`, contentMime: "video/mp4", sizeBytes: 3, durationSec, requiredPercent });
}
const linkVideo = async (title: string, url: string) => saveLesson(db, await coach(), ids.course, { moduleId: ids.module, title, contentType: "VIDEO", url, isRequired: true, requiredPercent: 90 });

const twoQuestions = async (lessonId: string) => {
  await saveQuestion(db, await coach(), ids.course, lessonId, { prompt: "What opens a cold call?", choices: [{ text: "A reason to talk", isCorrect: true }, { text: "A long apology", isCorrect: false }] });
  await saveQuestion(db, await coach(), ids.course, lessonId, { type: "TRUE_FALSE", prompt: "Silence is always bad.", choices: [{ text: "True", isCorrect: false }, { text: "False", isCorrect: true }] });
};
const answers = (attempt: { questions: Array<{ questionId: string; choices: Array<{ id: string; text: string }> }> }, correct: boolean) =>
  Object.fromEntries(attempt.questions.map((x) => [x.questionId, x.choices.filter((c) => (correct ? c.text === "A reason to talk" || c.text === "False" : c.text === "A long apology" || c.text === "True")).map((c) => c.id)]));

describe("the rule", () => {
  it("a video counts as a quiz lesson only when it has questions", () => {
    expect(isQuizLesson("VIDEO", 0)).toBe(false);
    expect(isQuizLesson("VIDEO", 3)).toBe(true);
    for (const t of ["QUIZ", "ASSESSMENT", "AUDIO"]) expect(isQuizLesson(t, 0), t).toBe(true);
    for (const t of ["TEXT", "LINK", "DOCUMENT", "ASSIGNMENT"]) expect(isQuizLesson(t, 5), t).toBe(false);
    expect(canHoldQuestions("VIDEO")).toBe(true);
    expect(canHoldQuestions("TEXT")).toBe(false);
  });
});

describe("questions on video lessons", () => {
  it("the coach adds questions to an uploaded video, a YouTube video and a Vimeo link; text lessons still refuse them", async () => {
    ids.course = await createCourse(db, await coach(), { title: "Video Quizzes", categoryId: ids.cat, description: "A course description long enough to satisfy validation rules.", difficulty: "BEGINNER", passingScore: 70, requiresCoachReview: false });
    ids.module = await saveModule(db, await coach(), ids.course, { title: "Module 1", description: "" });
    ids.upload = await uploadedVideo("Opening a call", 600, 90);
    ids.youtube = await linkVideo("Handling silence", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    ids.vimeo = await linkVideo("Tone of voice", "https://vimeo.com/123456789");
    ids.plain = await uploadedVideo("Welcome", 100, 50);
    ids.text = await saveLesson(db, await coach(), ids.course, { moduleId: ids.module, title: "Reading", contentType: "TEXT", body: "Some reading material." });
    await twoQuestions(ids.upload);
    await twoQuestions(ids.youtube);
    await twoQuestions(ids.vimeo);
    await expect(saveQuestion(db, await coach(), ids.course, ids.text, { prompt: "Not allowed here?", choices: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] })).rejects.toThrow(/do not have questions/);
    expect(await db.question.count({ where: { lessonId: ids.upload } })).toBe(2);
    await submitCourseForApproval(db, await coach(), ids.course);
    await publishCourse(db, admin(), ids.course, {});
    await enrol(db, agent(), ids.course);
  });

  it("an uploaded video's quiz stays locked until the required share is watched, then opens", async () => {
    const q = await quizStateForLearner(db, agent(), ids.upload);
    expect(q.canStart).toBe(false);
    expect(q.blocked).toMatch(/Watch at least 90% of the video/);
    await expect(startAttempt(db, agent(), ids.upload)).rejects.toThrow(/Watch at least/);
    let s = await recordMediaProgress(db, agent(), ids.upload, { positionSec: 300, playedDeltaSec: 50, elapsedMs: 50_000 });
    for (let i = 0; i < 10; i++) s = await recordMediaProgress(db, agent(), ids.upload, { positionSec: 300 + i * 50, playedDeltaSec: 50, elapsedMs: 50_000 });
    expect(s).toMatchObject({ questionCount: 2, quizUnlocked: true, status: "IN_PROGRESS", completedAt: null });
    expect((await quizStateForLearner(db, agent(), ids.upload)).canStart).toBe(true);
    // Watching alone does not complete a video that has a quiz.
    expect(await db.courseCompletion.count()).toBe(0);
  });

  it("failing then passing the quiz completes the video and moves course progress; the dashboard follows", async () => {
    const a1 = await startAttempt(db, agent(), ids.upload);
    const fail = await submitAttempt(db, agent(), a1, answers(await attemptForLearner(db, agent(), a1), false));
    expect(fail.passed).toBe(false);
    let card = (await myCourses(db, agent())).cards[0];
    expect(card.actions.map((a) => a.label).join(" | ")).toMatch(/Retake the video quiz/);
    const a2 = await startAttempt(db, agent(), ids.upload);
    const pass = await submitAttempt(db, agent(), a2, answers(await attemptForLearner(db, agent(), a2), true));
    expect(pass.passed).toBe(true);
    expect((await mediaStateForLearner(db, agent(), ids.upload)).completedAt).not.toBeNull();
    const e = await getEnrollmentForAgent(db, agent(), ids.course);
    expect(e.lessonProgress[ids.upload].status).toBe("COMPLETED");
    expect(e.course.quizCount).toBe(3); // the three videos with questions; the plain video is not a quiz
    card = (await myCourses(db, agent())).cards[0];
    expect(card.actions.some((a) => /Retake the video quiz/.test(a.label))).toBe(false);
  });

  it("a YouTube video behaves the same way: the quiz opens only after it is watched", async () => {
    expect((await quizStateForLearner(db, agent(), ids.youtube)).blocked).toMatch(/Watch at least 90% of the video/);
    await expect(markLessonComplete(db, agent(), ids.youtube)).rejects.toThrow(/passing its quiz|finishing its content/);
  });

  it("a video link the player cannot measure opens its questions immediately and cannot be marked watched", async () => {
    const q = await quizStateForLearner(db, agent(), ids.vimeo);
    expect(q.blocked).toBeNull();
    expect(q.canStart).toBe(true);
    await expect(markLessonComplete(db, agent(), ids.vimeo)).rejects.toThrow(/passing its quiz/);
    const a = await startAttempt(db, agent(), ids.vimeo);
    const pass = await submitAttempt(db, agent(), a, answers(await attemptForLearner(db, agent(), a), true));
    expect(pass.passed).toBe(true);
    expect((await getEnrollmentForAgent(db, agent(), ids.course)).lessonProgress[ids.vimeo].status).toBe("COMPLETED");
  });

  it("a video without questions is unchanged: watching completes it, and it is not counted as a quiz", async () => {
    const before = await quizStateForLearner(db, agent(), ids.plain).catch((e) => e);
    expect(before).not.toBeInstanceOf(ForbiddenError);
    const s = await recordMediaProgress(db, agent(), ids.plain, { positionSec: 60, playedDeltaSec: 60, elapsedMs: 60_000 });
    expect(s).toMatchObject({ questionCount: 0, quizUnlocked: false, status: "COMPLETED" });
    expect(s.completedAt).not.toBeNull();
  });

  it("the course completes once every required lesson is done, and the best quiz score reaches the completion record", async () => {
    // The reading and the YouTube lesson are the last ones outstanding: mark the reading, credit the watching, pass the quiz.
    await markLessonComplete(db, agent(), ids.text);
    let s = await recordMediaProgress(db, agent(), ids.youtube, { positionSec: 60, playedDeltaSec: 60, elapsedMs: 60_000, durationSec: 100 });
    expect(s.questionCount).toBe(2);
    const e0 = await getEnrollmentForAgent(db, agent(), ids.course);
    expect(e0.enrollment?.status).not.toBe("COMPLETED");
    await db.lessonProgress.update({ where: { lessonId_agentProfileId: { lessonId: ids.youtube, agentProfileId: ids.agentProfile } }, data: { mediaCompletedAt: new Date() } });
    const a = await startAttempt(db, agent(), ids.youtube);
    const pass = await submitAttempt(db, agent(), a, answers(await attemptForLearner(db, agent(), a), true));
    expect(pass).toMatchObject({ passed: true, courseCompleted: true });
    const done = await db.courseCompletion.findFirstOrThrow({});
    expect(done.examScore).toBe(100);
    s = await mediaStateForLearner(db, agent(), ids.youtube);
    expect(s.completedAt).not.toBeNull();
  });

  it("staff tracking lists the video quizzes with their scores", async () => {
    const t = await learnerTracking(db, admin());
    const row = t.rows[0];
    expect(row.quizzes.map((x) => x.title).sort()).toEqual(["Handling silence", "Opening a call", "Tone of voice"]);
    expect(row.quizzes.every((x) => x.passed)).toBe(true);
    expect(row.quizzes.find((x) => x.title === "Opening a call")?.attempts).toBe(2);
  });
});
