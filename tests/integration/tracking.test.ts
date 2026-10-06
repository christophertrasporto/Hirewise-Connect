import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDb, resetDb } from "../setup/db";
import { createCourse, saveModule, saveLesson, createLessonUploadUrl, submitCourseForApproval, publishCourse, enrol } from "@/server/services/academy.service";
import { saveQuestion, startAttempt, attemptForLearner, submitAttempt, reviewAttempt } from "@/server/services/quiz.service";
import { recordMediaProgress, markLessonComplete } from "@/server/services/lesson-media.service";
import { submitAssignment, reviewSubmission } from "@/server/services/assignment.service";
import { learnerTracking } from "@/server/services/tracking.service";
import { myCourses } from "@/server/services/learner.service";
import { runWorkerOnce } from "@/server/jobs/worker";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";
import { getStorage, resetStorageForTests } from "@/server/adapters/storage";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";

const db = testDb();
let dir = "";
const ids = { coach: "coach_tr", coach2: "coach_tr2", admin: "admin_tr", agentUser: "", agentProfile: "", agent2User: "", agent2Profile: "", cat: "", template: "", course: "", otherCourse: "", module: "", text: "", audio: "", quiz: "", assignment: "" };

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hw-track-"));
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
    const p = await db.agentProfile.create({ data: { userId: u.id, displayName: name, headline: "H", primaryRole: "Cold Caller", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila" } });
    return { u, p };
  };
  const a1 = await mk("ana@t.example", "Ana Lim");
  const a2 = await mk("ben@t.example", "Ben Cruz");
  ids.agentUser = a1.u.id; ids.agentProfile = a1.p.id; ids.agent2User = a2.u.id; ids.agent2Profile = a2.p.id;
  ids.cat = (await db.courseCategory.create({ data: { name: "Sales", slug: "sales", order: 1 } })).id;
  ids.template = (await db.certificationTemplate.create({ data: { name: "Certified Caller", requiresCompletion: true, minExamScore: 50, requiresCoachReview: false } })).id;
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
const courseInput = (title: string) => ({ title, categoryId: ids.cat, description: "A course description long enough to satisfy validation rules.", difficulty: "BEGINNER" as const, passingScore: 50, requiresCoachReview: false, priceUsd: "", syllabus: "", contentUrl: "" });

describe("tracking table and learner dashboard", () => {
  it("builds a course with every tracked lesson type; two learners enrol; a second coach owns another course", async () => {
    const c = await coach();
    ids.course = await createCourse(db, c, courseInput("Cold Calling Mastery"));
    ids.module = await saveModule(db, c, ids.course, { title: "Module 1", description: "" });
    ids.text = await saveLesson(db, c, ids.course, { moduleId: ids.module, title: "Openers", contentType: "TEXT", body: "Read" });
    const up = await createLessonUploadUrl(db, c, ids.course, { kind: "AUDIO", contentType: "audio/mpeg", sizeBytes: 3, fileName: "g.mp3" });
    await getStorage().put(up.key, Buffer.from("ID3"), "audio/mpeg");
    ids.audio = await saveLesson(db, c, ids.course, { moduleId: ids.module, title: "Gatekeeper Audiobook", contentType: "AUDIO", storageKey: up.key, fileName: "g.mp3", contentMime: "audio/mpeg", sizeBytes: 3, durationSec: 100, requiredPercent: 90 });
    await saveQuestion(db, c, ids.course, ids.audio, { prompt: "Ask for?", choices: [{ text: "Email", isCorrect: true }, { text: "Discount", isCorrect: false }] });
    ids.quiz = await saveLesson(db, c, ids.course, { moduleId: ids.module, title: "Module quiz", contentType: "QUIZ", passingScore: 50, reviewMode: "AUTO" });
    await saveQuestion(db, c, ids.course, ids.quiz, { prompt: "Pick A", choices: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] });
    await saveQuestion(db, c, ids.course, ids.quiz, { type: "SHORT_ANSWER", prompt: "Describe your opener", points: 1 });
    ids.assignment = await saveLesson(db, c, ids.course, { moduleId: ids.module, title: "Homework", contentType: "ASSIGNMENT", submissionType: "TEXT", points: 10 });
    await submitCourseForApproval(db, c, ids.course);
    await publishCourse(db, admin(), ids.course, { certificationTemplateId: ids.template });
    const c2 = await coach2();
    ids.otherCourse = await createCourse(db, c2, courseInput("Other coach course"));
    const m2 = await saveModule(db, c2, ids.otherCourse, { title: "Module A", description: "" });
    await saveLesson(db, c2, ids.otherCourse, { moduleId: m2, title: "Only lesson", contentType: "TEXT", body: "x" });
    await submitCourseForApproval(db, c2, ids.otherCourse);
    await publishCourse(db, admin(), ids.otherCourse, {});
    await enrol(db, agent(), ids.course);
    await enrol(db, agent2(), ids.course);
    await enrol(db, agent2(), ids.otherCourse);
    await runWorkerOnce(db);
  });

  it("scopes rows by role: agents are refused, a coach sees only their courses, admin sees all and can filter by coach", async () => {
    await expect(learnerTracking(db, agent(), {})).rejects.toBeInstanceOf(ForbiddenError);
    const mine = await learnerTracking(db, await coach(), {});
    expect(mine.rows.map((r) => r.course.title)).toEqual(["Cold Calling Mastery", "Cold Calling Mastery"]);
    expect(mine.courses.map((c) => c.title)).toEqual(["Cold Calling Mastery"]);
    const other = await learnerTracking(db, await coach2(), {});
    expect(other.rows.map((r) => [r.learner.displayName, r.course.title])).toEqual([["Ben Cruz", "Other coach course"]]);
    const all = await learnerTracking(db, admin(), {});
    expect(all.rows).toHaveLength(3);
    expect(all.coaches.map((c) => c.label).sort()).toEqual(["coach", "coach2"]);
    expect((await learnerTracking(db, admin(), { coachUserId: ids.coach2 })).rows).toHaveLength(1);
    expect((await learnerTracking(db, admin(), { courseId: ids.otherCourse })).rows).toHaveLength(1);
    expect((await learnerTracking(db, admin(), { q: "ben" })).rows.every((r) => r.learner.displayName === "Ben Cruz")).toBe(true);
    expect((await learnerTracking(db, admin(), { q: "ana@t" })).rows).toHaveLength(1);
    expect(all.rows.every((r) => r.status === "NOT_STARTED" && r.percent === 0)).toBe(true);
    expect(all.rows.find((r) => r.course.id === ids.course)?.currentLesson?.title).toBe("Openers");
  });

  it("rows carry progress, current lesson, listening share, quiz results, assignment status, and completion", async () => {
    // Ana: reads, listens 50%, fails the quiz once (short answer waits for review), submits homework
    await markLessonComplete(db, agent(), ids.text);
    await recordMediaProgress(db, agent(), ids.audio, { positionSec: 50, playedDeltaSec: 50, elapsedMs: 50_000 });
    const a1 = await startAttempt(db, agent(), ids.quiz);
    const v1 = await attemptForLearner(db, agent(), a1);
    const mc = v1.questions.find((q) => q.type === "MULTIPLE_CHOICE")!;
    const sa = v1.questions.find((q) => q.type === "SHORT_ANSWER")!;
    await submitAttempt(db, agent(), a1, { [mc.questionId]: [mc.choices.find((x) => x.text === "A")!.id], [sa.questionId]: "I open with a reason." });
    await submitAssignment(db, agent(), ids.assignment, { text: "My homework" });
    await runWorkerOnce(db);
    // coach notifications for the pending attempt and the submission
    expect(await db.notification.count({ where: { userId: ids.coach, type: "ATTEMPT_PENDING_REVIEW" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: ids.coach, type: "ASSIGNMENT_SUBMITTED" } })).toBe(1);

    let rows = (await learnerTracking(db, await coach(), { status: "IN_PROGRESS" })).rows;
    expect(rows).toHaveLength(1);
    let ana = rows[0];
    expect(ana.learner.displayName).toBe("Ana Lim");
    expect(ana).toMatchObject({ status: "IN_PROGRESS", percent: 25, requiredDone: 1, requiredTotal: 4, listeningPercent: 50, attempts: 1, currentModule: "Module 1" });
    expect(ana.currentLesson).toMatchObject({ title: "Gatekeeper Audiobook", status: "IN_PROGRESS" });
    expect(ana.quizzes.find((q) => q.lessonId === ids.quiz)).toMatchObject({ pendingReview: true, passed: false, attempts: 1 });
    expect(ana.assignments).toEqual({ total: 1, graded: 0, awaitingReview: 1, returned: 0 });
    expect(ana.certification).toBeNull();
    expect(ana.lastActivityAt).not.toBeNull();

    // coach reviews both; Ana finishes the audiobook and its quiz; the course completes and certifies
    await reviewAttempt(db, await coach(), ids.course, a1, { scorePercent: 100 });
    const sub = await db.assignmentSubmission.findFirstOrThrow({ where: { agentProfileId: ids.agentProfile } });
    await reviewSubmission(db, await coach(), ids.course, sub.id, { decision: "GRADED", grade: 8, feedback: "Good" });
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.agentUser, type: "ASSIGNMENT_REVIEWED" } })).toBe(1);
    await recordMediaProgress(db, agent(), ids.audio, { positionSec: 100, playedDeltaSec: 45, elapsedMs: 45_000 });
    const a2 = await startAttempt(db, agent(), ids.audio);
    const v2 = await attemptForLearner(db, agent(), a2);
    const r = await submitAttempt(db, agent(), a2, { [v2.questions[0].questionId]: [v2.questions[0].choices.find((x) => x.text === "Email")!.id] });
    expect(r.courseCompleted).toBe(true);

    rows = (await learnerTracking(db, admin(), { courseId: ids.course })).rows;
    ana = rows.find((x) => x.learner.displayName === "Ana Lim")!;
    expect(ana).toMatchObject({ status: "COMPLETED", percent: 100, listeningPercent: 95, attempts: 2, currentLesson: null, currentModule: null });
    expect(ana.completedAt).not.toBeNull();
    expect(ana.quizzes.map((q) => [q.title, q.best, q.passed])).toEqual([["Gatekeeper Audiobook", 100, true], ["Module quiz", 100, true]]);
    expect(ana.assignments).toEqual({ total: 1, graded: 1, awaitingReview: 0, returned: 0 });
    expect(ana.certification).toMatchObject({ name: "Certified Caller", status: "APPROVED" });
    expect(ana.certification?.certificateNumber).toMatch(/^HC-/);
    expect((await learnerTracking(db, admin(), { status: "COMPLETED" })).rows).toHaveLength(1);
    expect((await learnerTracking(db, admin(), { status: "NOT_STARTED" })).rows).toHaveLength(2);
  });

  it("the learner dashboard shows percent, next lesson with its state, actions, and certification", async () => {
    // Ben: listening halfway, quiz retake required
    await recordMediaProgress(db, agent2(), ids.audio, { positionSec: 45, playedDeltaSec: 45, elapsedMs: 45_000 });
    await markLessonComplete(db, agent2(), ids.text);
    await db.courseLesson.update({ where: { id: ids.quiz }, data: { reviewMode: "AUTO" } });
    const a = await startAttempt(db, agent2(), ids.quiz);
    const v = await attemptForLearner(db, agent2(), a);
    const mc = v.questions.find((q) => q.type === "MULTIPLE_CHOICE")!;
    await submitAttempt(db, agent2(), a, { [mc.questionId]: [mc.choices.find((x) => x.text === "B")!.id] }); // short answer left blank → auto-marked, failed
    const ben = await myCourses(db, agent2());
    expect(ben).toMatchObject({ inProgress: 1, completed: 0, certifications: 0 });
    expect(ben.cards.map((c) => [c.title, c.status])).toEqual([["Cold Calling Mastery", "IN_PROGRESS"], ["Other coach course", "NOT_STARTED"]]);
    const card = ben.cards[0];
    expect(card).toMatchObject({ percent: 25, requiredDone: 1, requiredTotal: 4 });
    expect(card.nextLesson).toEqual({ id: ids.audio, title: "Gatekeeper Audiobook", contentType: "Audiobook", detail: "Listening, 45%" });
    expect(card.actions).toEqual([{ label: "Retake the quiz: Module quiz", lessonId: ids.quiz }]);
    expect(card.certification).toEqual({ name: "Certified Caller", status: "NOT_YET", certificateNumber: null });

    const ana = await myCourses(db, agent());
    expect(ana).toMatchObject({ inProgress: 0, completed: 1, certifications: 1 });
    expect(ana.cards[0]).toMatchObject({ status: "COMPLETED", percent: 100, nextLesson: null, actions: [] });
    expect(ana.cards[0].certification?.status).toBe("APPROVED");
    await expect(myCourses(db, await coach())).rejects.toBeInstanceOf(ForbiddenError);
  });
});
