import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDb, resetDb } from "../setup/db";
import { createCourse, saveModule, saveLesson, createLessonUploadUrl, submitCourseForApproval, publishCourse, enrol, getEnrollmentForAgent } from "@/server/services/academy.service";
import { saveQuestion, startAttempt, attemptForLearner, submitAttempt, attemptsAwaitingReview, reviewAttempt } from "@/server/services/quiz.service";
import { recordMediaProgress, markLessonComplete, startLesson, isSelfMarked } from "@/server/services/lesson-media.service";
import { createSubmissionUploadUrl, submitAssignment, mySubmissions, submissionsAwaitingReview, reviewSubmission, submissionDownloadUrl } from "@/server/services/assignment.service";
import { youTubeId } from "@/lib/video-url";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, ROLE_PERMISSIONS, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";
import { getStorage, resetStorageForTests } from "@/server/adapters/storage";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";

const db = testDb();
let dir = "";
const ids = { coach: "coach_lt", coach2: "coach_lt2", admin: "admin_lt", agentUser: "", agentProfile: "", agent2User: "", agent2Profile: "", cat: "", course: "", module: "", text: "", link: "", doc: "", ytVideo: "", loomVideo: "", fileVideo: "", assignment: "", docAssignment: "", assessment: "" };

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hw-types-"));
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
  await db.user.create({ data: { id: ids.coach2, email: "coach2@hirewise.example", roleId: await role("COACH") } });
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
const coach2 = () => resolveActor(db, ids.coach2);
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const agent = () => makeActor("AGENT", { userId: ids.agentUser, agentProfileId: ids.agentProfile });
const agent2 = () => makeActor("AGENT", { userId: ids.agent2User, agentProfileId: ids.agent2Profile });
const progressOf = async (lessonId: string) => db.lessonProgress.findUnique({ where: { lessonId_agentProfileId: { lessonId, agentProfileId: ids.agentProfile } } });

describe("every lesson type has a completion path", () => {
  it("coach builds one lesson of each remaining type and publishes", async () => {
    ids.course = await createCourse(db, await coach(), { title: "All lesson types", categoryId: ids.cat, description: "A course description long enough to satisfy validation rules.", difficulty: "BEGINNER", passingScore: 70, requiresCoachReview: false, priceUsd: "", syllabus: "", contentUrl: "" });
    ids.module = await saveModule(db, await coach(), ids.course, { title: "Module 1", description: "" });
    const c = await coach();
    ids.text = await saveLesson(db, c, ids.course, { moduleId: ids.module, title: "Read me", contentType: "TEXT", body: "# Openers\n\nEarn permission." });
    ids.link = await saveLesson(db, c, ids.course, { moduleId: ids.module, title: "Reading", contentType: "LINK", url: "https://example.com/objections" });
    const up = await createLessonUploadUrl(db, c, ids.course, { kind: "DOCUMENT", contentType: "application/pdf", sizeBytes: 5, fileName: "handout.pdf" });
    await getStorage().put(up.key, Buffer.from("%PDF-"), "application/pdf");
    ids.doc = await saveLesson(db, c, ids.course, { moduleId: ids.module, title: "Handout", contentType: "DOCUMENT", storageKey: up.key, fileName: "handout.pdf", contentMime: "application/pdf", sizeBytes: 5 });
    ids.ytVideo = await saveLesson(db, c, ids.course, { moduleId: ids.module, title: "Role-play (YouTube)", contentType: "VIDEO", url: "https://youtu.be/abc123def45", durationSec: 300, requiredPercent: 80 });
    ids.loomVideo = await saveLesson(db, c, ids.course, { moduleId: ids.module, title: "Walkthrough (Loom)", contentType: "VIDEO", url: "https://www.loom.com/share/0123456789abcdef" });
    const vup = await createLessonUploadUrl(db, c, ids.course, { kind: "VIDEO", contentType: "video/mp4", sizeBytes: 4, fileName: "clip.mp4" });
    await getStorage().put(vup.key, Buffer.from("ftyp"), "video/mp4");
    ids.fileVideo = await saveLesson(db, c, ids.course, { moduleId: ids.module, title: "Uploaded clip", contentType: "VIDEO", storageKey: vup.key, fileName: "clip.mp4", contentMime: "video/mp4", sizeBytes: 4, durationSec: 100, requiredPercent: 50 });
    ids.assignment = await saveLesson(db, c, ids.course, { moduleId: ids.module, title: "Write your opener", contentType: "ASSIGNMENT", body: "Write a 30-second opener.", submissionType: "TEXT", points: 10, dueAt: "2020-01-01" });
    ids.docAssignment = await saveLesson(db, c, ids.course, { moduleId: ids.module, title: "Upload your call recording notes", contentType: "ASSIGNMENT", submissionType: "DOCUMENT", isRequired: false });
    ids.assessment = await saveLesson(db, c, ids.course, { moduleId: ids.module, title: "Final assessment", contentType: "ASSESSMENT", passingScore: 50, reviewMode: "MANUAL", isRequired: false });
    await saveQuestion(db, c, ids.course, ids.assessment, { prompt: "Best opener?", choices: [{ text: "Permission-based", isCorrect: true }, { text: "Pitch first", isCorrect: false }] });
    await submitCourseForApproval(db, c, ids.course);
    await publishCourse(db, admin(), ids.course, {});
    await enrol(db, agent(), ids.course);
    const e = await getEnrollmentForAgent(db, agent(), ids.course);
    const lessons = e.course.modules!.flatMap((m) => m.lessons);
    expect(lessons.find((l) => l.id === ids.assignment)).toMatchObject({ submissionType: "TEXT", points: 10 });
    expect(lessons.find((l) => l.id === ids.assignment)?.dueAt).toBeInstanceOf(Date);
    expect(e.courseProgress).toBeNull();
  });

  it("text, link, document, and non-YouTube hosted video are self-marked; media and question lessons refuse", async () => {
    expect(youTubeId("https://www.youtube.com/watch?v=abc123def45")).toBe("abc123def45");
    expect(youTubeId("https://youtu.be/abc123def45?t=10")).toBe("abc123def45");
    expect(youTubeId("https://www.youtube.com/shorts/xyz")).toBe("xyz");
    expect(youTubeId("https://vimeo.com/12345")).toBeNull();
    expect(isSelfMarked({ contentType: "VIDEO", storageKey: null, url: "https://youtu.be/abc" })).toBe(false);
    expect(isSelfMarked({ contentType: "VIDEO", storageKey: null, url: "https://www.loom.com/share/x" })).toBe(true);
    expect(isSelfMarked({ contentType: "VIDEO", storageKey: "k", url: null })).toBe(false);
    expect(isSelfMarked({ contentType: "AUDIO", storageKey: "k", url: null })).toBe(false);

    // opening a document records In progress without completing
    expect((await startLesson(db, agent(), ids.doc)).status).toBe("IN_PROGRESS");
    expect((await progressOf(ids.doc))?.completedAt).toBeNull();
    await expect(markLessonComplete(db, agent2(), ids.text)).rejects.toBeInstanceOf(NotFoundError); // not enrolled
    await expect(markLessonComplete(db, await coach(), ids.text)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(markLessonComplete(db, agent(), ids.ytVideo)).rejects.toThrow(/finishing its content/);
    await expect(markLessonComplete(db, agent(), ids.fileVideo)).rejects.toThrow(/finishing its content/);
    await expect(markLessonComplete(db, agent(), ids.assignment)).rejects.toThrow(/finishing its content/);

    let r = await markLessonComplete(db, agent(), ids.text);
    expect(r).toMatchObject({ completed: true, courseCompleted: false });
    expect(r.coursePercent).toBe(14); // 1 of 7 required (doc assignment and assessment are optional)
    await markLessonComplete(db, agent(), ids.link);
    await markLessonComplete(db, agent(), ids.doc);
    r = await markLessonComplete(db, agent(), ids.loomVideo);
    expect(r.coursePercent).toBe(57);
    expect(await db.auditLog.count({ where: { action: "LESSON_COMPLETED", actorUserId: ids.agentUser } })).toBe(4);
    // marking twice is a no-op
    r = await markLessonComplete(db, agent(), ids.text);
    expect(r.coursePercent).toBeNull();
    expect(await db.auditLog.count({ where: { action: "LESSON_COMPLETED", actorUserId: ids.agentUser } })).toBe(4);
  });

  it("video lessons complete through real-watching tracking (uploaded file and YouTube)", async () => {
    let s = await recordMediaProgress(db, agent(), ids.fileVideo, { positionSec: 100, playedDeltaSec: 0, elapsedMs: 500 });
    expect(s).toMatchObject({ percent: 0, status: "IN_PROGRESS", questionCount: 0 });
    s = await recordMediaProgress(db, agent(), ids.fileVideo, { positionSec: 55, playedDeltaSec: 55, elapsedMs: 55_000 });
    expect(s).toMatchObject({ percent: 55, status: "COMPLETED", audioStatus: "COMPLETED" });
    // YouTube: the lesson has a coach-side duration; 80% of 300 s = 240 s of real watching
    for (let i = 0; i < 4; i++) s = await recordMediaProgress(db, agent(), ids.ytVideo, { positionSec: (i + 1) * 60, playedDeltaSec: 60, elapsedMs: 60_000, durationSec: 299 });
    expect(s).toMatchObject({ percent: 80, status: "COMPLETED" });
    const e = await getEnrollmentForAgent(db, agent(), ids.course);
    expect(e.courseProgress).toMatchObject({ requiredDone: 6, requiredTotal: 7, percent: 85 });
  });

  it("assignments: validation per submission type, scoped uploads, coach review with grade, return and resubmit", async () => {
    await expect(submitAssignment(db, agent(), ids.assignment, { text: "" })).rejects.toThrow(/Write your answer/);
    await expect(submitAssignment(db, agent(), ids.docAssignment, { text: "no file" })).rejects.toThrow(/Upload your file/);
    await expect(submitAssignment(db, agent2(), ids.assignment, { text: "intruder" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(submitAssignment(db, await coach(), ids.assignment, { text: "coach" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(submitAssignment(db, agent(), ids.text, { text: "not an assignment" })).rejects.toBeInstanceOf(NotFoundError);

    const first = await submitAssignment(db, agent(), ids.assignment, { text: "Hi, this is Ana from Hirewise, do you have thirty seconds?" });
    expect(first.late).toBe(true); // due 2020
    expect((await progressOf(ids.assignment))?.status).toBe("PENDING_REVIEW");
    await expect(submitAssignment(db, agent(), ids.assignment, { text: "again" })).rejects.toThrow(/already with your coach/);
    const mine = await mySubmissions(db, agent(), ids.assignment);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: "SUBMITTED", hasFile: false });
    expect(JSON.stringify(mine)).not.toContain("storageKey");

    // review gate: other coach NotFound, agent Forbidden, coach without assignment.review Forbidden
    await expect(submissionsAwaitingReview(db, await coach2(), ids.course)).rejects.toBeInstanceOf(NotFoundError);
    await expect(reviewSubmission(db, agent(), ids.course, first.id, { decision: "GRADED" })).rejects.toBeInstanceOf(ForbiddenError);
    const limited = { ...makeActor("COACH", { userId: ids.coach }), permissions: new Set(ROLE_PERMISSIONS.COACH.filter((k) => k !== "assignment.review")) };
    await expect(submissionsAwaitingReview(db, limited, ids.course)).rejects.toBeInstanceOf(ForbiddenError);
    const queue = await submissionsAwaitingReview(db, await coach(), ids.course);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ id: first.id, late: true, submissionType: "TEXT" });
    expect(queue[0].text).toMatch(/thirty seconds/);

    // return for changes needs feedback; grade cannot exceed points
    await expect(reviewSubmission(db, await coach(), ids.course, first.id, { decision: "RETURNED" })).rejects.toThrow(/what to change/);
    await expect(reviewSubmission(db, await coach(), ids.course, first.id, { decision: "GRADED", grade: 11 })).rejects.toThrow(/cannot exceed 10/);
    await reviewSubmission(db, await coach(), ids.course, first.id, { decision: "RETURNED", grade: 4, feedback: "Add a reason for the call before asking for time." });
    expect((await progressOf(ids.assignment))?.status).toBe("RETAKE_REQUIRED");
    const afterReturn = await mySubmissions(db, agent(), ids.assignment);
    expect(afterReturn[0]).toMatchObject({ status: "RETURNED", grade: 4 });
    expect(afterReturn[0].feedback).toMatch(/reason for the call/);
    await expect(reviewSubmission(db, await coach(), ids.course, first.id, { decision: "GRADED" })).rejects.toThrow(/already been reviewed/);

    const second = await submitAssignment(db, agent(), ids.assignment, { text: "Hi Ana here from Hirewise, calling about your open setter role, got thirty seconds?" });
    expect((await mySubmissions(db, agent(), ids.assignment)).map((s) => s.id)).toEqual([second.id, first.id]);
    await reviewSubmission(db, admin(), ids.course, second.id, { decision: "GRADED", grade: 9, feedback: "Much better." });
    expect((await progressOf(ids.assignment))).toMatchObject({ status: "COMPLETED" });
    await expect(submitAssignment(db, agent(), ids.assignment, { text: "third" })).rejects.toThrow(/already been graded/);
    const e = await getEnrollmentForAgent(db, agent(), ids.course);
    expect(e.submissions[ids.assignment]).toMatchObject({ status: "GRADED", grade: 9 });
    expect(e.courseProgress).toMatchObject({ requiredDone: 7, requiredTotal: 7, percent: 100 });
    expect(e.enrollment?.status).toBe("COMPLETED");
    expect(await db.auditLog.count({ where: { action: "ASSIGNMENT_REVIEWED" } })).toBe(2);

    // document submission: upload must be scoped to the learner's folder and exist in storage
    await expect(createSubmissionUploadUrl(db, agent(), ids.docAssignment, { contentType: "application/x-msdownload", sizeBytes: 10 })).rejects.toThrow(/Unsupported/);
    const up = await createSubmissionUploadUrl(db, agent(), ids.docAssignment, { contentType: "application/pdf", sizeBytes: 5, fileName: "notes.pdf" });
    expect(up.key).toContain(`/submissions/${ids.agentProfile}/`);
    await expect(submitAssignment(db, agent(), ids.docAssignment, { storageKey: up.key, fileName: "notes.pdf" })).rejects.toThrow(/not uploaded/);
    await getStorage().put(up.key, Buffer.from("%PDF-"), "application/pdf");
    await expect(submitAssignment(db, agent(), ids.docAssignment, { storageKey: `courses/${ids.course}/lessons/document/x.pdf` })).rejects.toBeInstanceOf(ForbiddenError);
    const docSub = await submitAssignment(db, agent(), ids.docAssignment, { storageKey: up.key, fileName: "notes.pdf" });
    expect(await submissionDownloadUrl(db, agent(), docSub.id)).toContain("/api/storage/");
    expect(await submissionDownloadUrl(db, await coach(), docSub.id)).toContain("/api/storage/");
    await expect(submissionDownloadUrl(db, agent2(), docSub.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(submissionDownloadUrl(db, await coach2(), docSub.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an assessment in manual review mode holds every attempt for the coach, who sees all answers", async () => {
    const id = await startAttempt(db, agent(), ids.assessment);
    const v = await attemptForLearner(db, agent(), id);
    const r = await submitAttempt(db, agent(), id, { [v.questions[0].questionId]: [v.questions[0].choices.find((c) => c.text === "Permission-based")!.id] });
    expect(r).toMatchObject({ pendingReview: true, passed: null, scorePercent: 100 });
    const queue = await attemptsAwaitingReview(db, await coach(), ids.course);
    expect(queue).toHaveLength(1);
    expect(queue[0].reviewMode).toBe("MANUAL");
    expect(queue[0].answers).toEqual([expect.objectContaining({ prompt: "Best opener?", answer: "Permission-based", correctAnswer: "Permission-based", correct: true })]);
    await reviewAttempt(db, await coach(), ids.course, id, { scorePercent: 100, feedback: "Agreed." });
    expect((await progressOf(ids.assessment))?.status).toBe("COMPLETED");
  });
});
