import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDb, resetDb } from "../setup/db";
import { createCourse, saveModule, saveLesson, createLessonUploadUrl, submitCourseForApproval, publishCourse, enrol, getEnrollmentForAgent } from "@/server/services/academy.service";
import { saveQuestion, startAttempt, attemptForLearner, submitAttempt, quizStateForLearner } from "@/server/services/quiz.service";
import { recordMediaProgress, mediaStateForLearner, audioStatusOf } from "@/server/services/lesson-media.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";
import { getStorage, resetStorageForTests } from "@/server/adapters/storage";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";

const db = testDb();
let dir = "";
const ids = { coach: "coach_au", admin: "admin_au", agentUser: "", agentProfile: "", agent2User: "", agent2Profile: "", cat: "", course: "", module: "", audiobook: "", plainAudio: "", q1: "" };

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hw-audio-"));
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
  const mk = async (email: string, name: string) => {
    const u = await db.user.create({ data: { email, roleId: await role("AGENT"), emailVerifiedAt: new Date() } });
    const p = await db.agentProfile.create({ data: { userId: u.id, displayName: name, headline: "H", primaryRole: "VA", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila" } });
    return { u, p };
  };
  const a1 = await mk("agent1@t.example", "Agent One");
  const a2 = await mk("agent2@t.example", "Agent Two");
  ids.agentUser = a1.u.id; ids.agentProfile = a1.p.id; ids.agent2User = a2.u.id; ids.agent2Profile = a2.p.id;
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
const agent2 = () => makeActor("AGENT", { userId: ids.agent2User, agentProfileId: ids.agent2Profile });

async function uploadAudio(courseId: string, moduleId: string, title: string, durationSec: number, requiredPercent: number) {
  const up = await createLessonUploadUrl(db, await coach(), courseId, { kind: "AUDIO", contentType: "audio/mpeg", sizeBytes: 3, fileName: `${title}.mp3` });
  await getStorage().put(up.key, Buffer.from("ID3"), "audio/mpeg");
  return saveLesson(db, await coach(), courseId, { moduleId, title, contentType: "AUDIO", storageKey: up.key, fileName: `${title}.mp3`, contentMime: "audio/mpeg", sizeBytes: 3, durationSec, requiredPercent });
}

describe("audiobook lesson: real-listening tracking and quiz gating", () => {
  it("coach builds an audiobook with questions and a plain audio lesson; the quiz is locked until the audio is heard", async () => {
    ids.course = await createCourse(db, await coach(), { title: "Gatekeeper Audiobook", categoryId: ids.cat, description: "A course description long enough to satisfy validation rules.", difficulty: "BEGINNER", passingScore: 70, requiresCoachReview: false, priceUsd: "", syllabus: "", contentUrl: "" });
    ids.module = await saveModule(db, await coach(), ids.course, { title: "Module 1", description: "" });
    ids.audiobook = await uploadAudio(ids.course, ids.module, "Getting past the gatekeeper", 1200, 90);
    ids.plainAudio = await uploadAudio(ids.course, ids.module, "Closing recap", 100, 50);
    ids.q1 = await saveQuestion(db, await coach(), ids.course, ids.audiobook, { prompt: "What do you ask the gatekeeper for?", choices: [{ text: "The decision maker's email", isCorrect: true }, { text: "A discount", isCorrect: false }] });
    await saveQuestion(db, await coach(), ids.course, ids.audiobook, { type: "TRUE_FALSE", prompt: "You should argue with the gatekeeper.", choices: [{ text: "True", isCorrect: false }, { text: "False", isCorrect: true }] });
    const stored = await db.courseLesson.findUniqueOrThrow({ where: { id: ids.audiobook } });
    expect([stored.contentType, stored.durationSec, stored.requiredPercent]).toEqual(["AUDIO", 1200, 90]);
    await submitCourseForApproval(db, await coach(), ids.course);
    await publishCourse(db, admin(), ids.course, {});

    await expect(mediaStateForLearner(db, agent(), ids.audiobook)).rejects.toBeInstanceOf(NotFoundError); // not enrolled
    await enrol(db, agent(), ids.course);
    await expect(recordMediaProgress(db, await coach(), ids.audiobook, { positionSec: 1, playedDeltaSec: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordMediaProgress(db, agent2(), ids.audiobook, { positionSec: 1, playedDeltaSec: 1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(recordMediaProgress(db, agent(), ids.q1, { positionSec: 1, playedDeltaSec: 1 })).rejects.toBeInstanceOf(NotFoundError); // not a media lesson

    const s = await mediaStateForLearner(db, agent(), ids.audiobook);
    expect(s).toMatchObject({ percent: 0, lastPositionSec: 0, requiredPercent: 90, questionCount: 2, quizUnlocked: false, audioStatus: "NOT_STARTED", status: "NOT_STARTED" });
    const q = await quizStateForLearner(db, agent(), ids.audiobook);
    expect(q.canStart).toBe(false);
    expect(q.blocked).toMatch(/listening to at least 90%/);
    await expect(startAttempt(db, agent(), ids.audiobook)).rejects.toThrow(/listening/);
  });

  it("seeking to the end and inflated reports do not count; honest listening reaches the threshold and unlocks the quiz", async () => {
    // dragging the playhead to the end: position is stored for resume, nothing is credited
    let s = await recordMediaProgress(db, agent(), ids.audiobook, { positionSec: 5000, playedDeltaSec: 0, elapsedMs: 1000 });
    expect(s).toMatchObject({ percent: 0, mediaSeconds: 0, lastPositionSec: 1200, audioStatus: "LISTENING", status: "IN_PROGRESS", quizUnlocked: false });
    expect(s.startedAt).not.toBeNull();
    // a report claiming 60 s played in 5 s of wall-clock is credited at most 7 s
    s = await recordMediaProgress(db, agent(), ids.audiobook, { positionSec: 60, playedDeltaSec: 60, elapsedMs: 5_000 });
    expect(s.mediaSeconds).toBe(7);
    expect(s.percent).toBe(0);
    // the schema refuses more than 60 s per report
    await expect(recordMediaProgress(db, agent(), ids.audiobook, { positionSec: 60, playedDeltaSec: 61, elapsedMs: 61_000 })).rejects.toThrow();
    // the client's duration never overrides the coach-side duration
    s = await recordMediaProgress(db, agent(), ids.audiobook, { positionSec: 70, playedDeltaSec: 10, elapsedMs: 10_000, durationSec: 20 });
    expect(s.percent).toBe(1);
    // honest listening at 2x: 60 s of audio per 30 s of wall-clock
    for (let i = 0; i < 17; i++) s = await recordMediaProgress(db, agent(), ids.audiobook, { positionSec: 70 + (i + 1) * 60, playedDeltaSec: 60, elapsedMs: 30_000, playbackRate: 2 });
    expect(s.percent).toBe(86);
    expect(s.quizUnlocked).toBe(false);
    s = await recordMediaProgress(db, agent(), ids.audiobook, { positionSec: 1150, playedDeltaSec: 43, elapsedMs: 43_000 });
    expect(s.percent).toBe(90);
    expect(s).toMatchObject({ quizUnlocked: true, audioStatus: "AUDIO_COMPLETE", status: "IN_PROGRESS", completedAt: null });
    expect(s.audioCompletedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: "LESSON_MEDIA_COMPLETED", entityId: ids.audiobook } })).toBe(1);
    expect(await db.courseCompletion.count()).toBe(0);

    const e = await getEnrollmentForAgent(db, agent(), ids.course);
    expect(e.lessonProgress[ids.audiobook]).toMatchObject({ status: "IN_PROGRESS", mediaPercent: 90, lastPositionSec: 1150 });
    expect(e.lessonProgress[ids.audiobook].mediaCompletedAt).not.toBeNull();
    expect(e.courseProgress?.percent ?? 0).toBe(0);

    // further listening keeps the resume position but never writes a second completion audit
    s = await recordMediaProgress(db, agent(), ids.audiobook, { positionSec: 1199, playedDeltaSec: 49, elapsedMs: 49_000 });
    expect(s.percent).toBe(94);
    expect(await db.auditLog.count({ where: { action: "LESSON_MEDIA_COMPLETED", entityId: ids.audiobook } })).toBe(1);
  });

  it("the quiz runs the audiobook through Quiz pending, Quiz failed, and Completed; course progress follows", async () => {
    const q = await quizStateForLearner(db, agent(), ids.audiobook);
    expect(q.canStart).toBe(true);
    const a1 = await startAttempt(db, agent(), ids.audiobook);
    expect((await mediaStateForLearner(db, agent(), ids.audiobook)).audioStatus).toBe("QUIZ_PENDING");
    const v1 = await attemptForLearner(db, agent(), a1);
    const wrong = Object.fromEntries(v1.questions.map((x) => [x.questionId, x.choices.filter((c) => c.text === "A discount" || c.text === "True").map((c) => c.id)]));
    const fail = await submitAttempt(db, agent(), a1, wrong);
    expect(fail.passed).toBe(false);
    expect((await mediaStateForLearner(db, agent(), ids.audiobook)).audioStatus).toBe("QUIZ_FAILED");

    const a2 = await startAttempt(db, agent(), ids.audiobook);
    const v2 = await attemptForLearner(db, agent(), a2);
    const right = Object.fromEntries(v2.questions.map((x) => [x.questionId, x.choices.filter((c) => c.text === "The decision maker's email" || c.text === "False").map((c) => c.id)]));
    const pass = await submitAttempt(db, agent(), a2, right);
    expect(pass).toMatchObject({ passed: true, courseCompleted: false, coursePercent: 50 });
    const s = await mediaStateForLearner(db, agent(), ids.audiobook);
    expect(s.audioStatus).toBe("COMPLETED");
    expect(s.completedAt).not.toBeNull();
  });

  it("an audio lesson without questions completes on listening alone and finishes the course; progress resumes across devices", async () => {
    let s = await recordMediaProgress(db, agent(), ids.plainAudio, { positionSec: 30, playedDeltaSec: 30, elapsedMs: 30_000 });
    expect(s).toMatchObject({ percent: 30, requiredPercent: 50, questionCount: 0, quizUnlocked: false, audioStatus: "LISTENING" });
    // "another device" reads the same position back
    expect((await mediaStateForLearner(db, agent(), ids.plainAudio)).lastPositionSec).toBe(30);
    s = await recordMediaProgress(db, agent(), ids.plainAudio, { positionSec: 52, playedDeltaSec: 22, elapsedMs: 22_000 });
    expect(s).toMatchObject({ percent: 52, audioStatus: "COMPLETED", status: "COMPLETED", quizUnlocked: false });
    expect(s.completedAt).not.toBeNull();
    const e = await getEnrollmentForAgent(db, agent(), ids.course);
    expect(e.courseProgress).toMatchObject({ percent: 100, requiredDone: 2, requiredTotal: 2 });
    expect(e.enrollment?.status).toBe("COMPLETED");
    expect(await db.courseCompletion.count()).toBe(1);
    // more listening after completion is harmless
    s = await recordMediaProgress(db, agent(), ids.plainAudio, { positionSec: 100, playedDeltaSec: 48, elapsedMs: 48_000 });
    expect(s.percent).toBe(100);
    expect(s.status).toBe("COMPLETED");
    expect(await db.courseCompletion.count()).toBe(1);
  });

  it("audio status derivation covers the six states", () => {
    const base = { status: "IN_PROGRESS", mediaSeconds: 10, mediaCompletedAt: null as Date | null };
    expect(audioStatusOf({ progress: null, questionCount: 2, latestAttempt: null })).toBe("NOT_STARTED");
    expect(audioStatusOf({ progress: { ...base, status: "NOT_STARTED", mediaSeconds: 0 }, questionCount: 2, latestAttempt: null })).toBe("NOT_STARTED");
    expect(audioStatusOf({ progress: base, questionCount: 2, latestAttempt: null })).toBe("LISTENING");
    expect(audioStatusOf({ progress: { ...base, mediaCompletedAt: new Date() }, questionCount: 2, latestAttempt: null })).toBe("AUDIO_COMPLETE");
    expect(audioStatusOf({ progress: { ...base, mediaCompletedAt: new Date() }, questionCount: 2, latestAttempt: { status: "IN_PROGRESS" } })).toBe("QUIZ_PENDING");
    expect(audioStatusOf({ progress: { ...base, status: "PENDING_REVIEW", mediaCompletedAt: new Date() }, questionCount: 2, latestAttempt: { status: "PENDING_REVIEW" } })).toBe("QUIZ_PENDING");
    expect(audioStatusOf({ progress: { ...base, status: "RETAKE_REQUIRED", mediaCompletedAt: new Date() }, questionCount: 2, latestAttempt: { status: "SUBMITTED" } })).toBe("QUIZ_FAILED");
    expect(audioStatusOf({ progress: { ...base, status: "FAILED", mediaCompletedAt: new Date() }, questionCount: 2, latestAttempt: { status: "SUBMITTED" } })).toBe("QUIZ_FAILED");
    expect(audioStatusOf({ progress: { ...base, status: "COMPLETED", mediaCompletedAt: new Date() }, questionCount: 2, latestAttempt: { status: "SUBMITTED" } })).toBe("COMPLETED");
  });
});
