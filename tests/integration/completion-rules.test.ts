import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { createCourse, saveModule, saveLesson, deleteLesson, updateCourseSettings, submitCourseForApproval, publishCourse, enrol, getEnrollmentForAgent } from "@/server/services/academy.service";
import { saveQuestion, startAttempt, attemptForLearner, submitAttempt, quizStateForLearner } from "@/server/services/quiz.service";
import { markLessonComplete, startLesson } from "@/server/services/lesson-media.service";
import { submitAssignment } from "@/server/services/assignment.service";
import { lockedLessons, requiredLessons, recalculateCourseProgress } from "@/server/services/progress.service";
import { issueCertification, revokeCertification, certificateForActor, verifyCertificate } from "@/server/services/certification.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";

const db = testDb();
const ids = { coach: "coach_cr", admin: "admin_cr", agentUser: "", agentProfile: "", agent2User: "", agent2Profile: "", clientUser: "", cat: "", template: "", course: "", m1: "", m2: "", intro: "", optionalLink: "", quiz: "", m2Text: "", assignment: "", finalAssessment: "", certId: "" };

beforeAll(async () => {
  process.env.APP_URL = "http://localhost:3000";
  setEmailChannelForTests(new ConsoleEmailChannel());
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.user.create({ data: { id: ids.coach, email: "coach@hirewise.example", roleId: await role("COACH") } });
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN") } });
  ids.clientUser = (await db.user.create({ data: { email: "client@acme.example", roleId: await role("CLIENT") } })).id;
  const mk = async (email: string, name: string) => {
    const u = await db.user.create({ data: { email, roleId: await role("AGENT"), emailVerifiedAt: new Date() } });
    const p = await db.agentProfile.create({ data: { userId: u.id, displayName: name, headline: "H", primaryRole: "VA", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila" } });
    return { u, p };
  };
  const a1 = await mk("agent1@t.example", "Ana Lim");
  const a2 = await mk("agent2@t.example", "Agent Two");
  ids.agentUser = a1.u.id; ids.agentProfile = a1.p.id; ids.agent2User = a2.u.id; ids.agent2Profile = a2.p.id;
  ids.cat = (await db.courseCategory.create({ data: { name: "Sales", slug: "sales", order: 1 } })).id;
  ids.template = (await db.certificationTemplate.create({ data: { name: "Certified Setter", requiresCompletion: true, minExamScore: 60, requiresCoachReview: false, validityMonths: 12 } })).id;
});

afterAll(async () => {
  setEmailChannelForTests(null);
  await db.$disconnect();
});

const coach = () => resolveActor(db, ids.coach);
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const agent = () => makeActor("AGENT", { userId: ids.agentUser, agentProfileId: ids.agentProfile });
const agent2 = () => makeActor("AGENT", { userId: ids.agent2User, agentProfileId: ids.agent2Profile });
const client = () => makeActor("CLIENT", { userId: ids.clientUser });
const settings = (over: Record<string, unknown>) => ({ isRequired: false, sequentialUnlock: false, completionRequiresQuizPass: true, completionRequiresFinalAssessment: false, displayOrder: 0, prerequisiteIds: [] as string[], minVerificationLevel: "" as const, ...over });

describe("sequential unlock", () => {
  it("pure rule: everything after the first unfinished required lesson is locked; optional lessons never block", () => {
    const course = { sequentialUnlock: true, completionRequiresFinalAssessment: false, modules: [
      { status: "PUBLISHED", lessons: [{ id: "a", title: "A", isRequired: true, contentType: "TEXT", status: "PUBLISHED" }, { id: "opt", title: "Opt", isRequired: false, contentType: "LINK", status: "PUBLISHED" }, { id: "b", title: "B", isRequired: true, contentType: "QUIZ", status: "PUBLISHED" }] },
      { status: "DRAFT", lessons: [{ id: "draft", title: "Draft", isRequired: true, contentType: "TEXT", status: "PUBLISHED" }] },
      { status: "PUBLISHED", lessons: [{ id: "c", title: "C", isRequired: true, contentType: "TEXT", status: "PUBLISHED" }] },
    ] };
    expect(lockedLessons(course, new Set())).toEqual({ opt: 'Finish "A" first.', b: 'Finish "A" first.', c: 'Finish "A" first.' });
    expect(lockedLessons(course, new Set(["a"]))).toEqual({ c: 'Finish "B" first.' });
    expect(lockedLessons(course, new Set(["a", "b"]))).toEqual({});
    expect(lockedLessons({ ...course, sequentialUnlock: false }, new Set())).toEqual({});
    expect(requiredLessons({ ...course, completionRequiresFinalAssessment: true }).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("every learner action on a locked lesson is refused until the earlier required lessons are complete", async () => {
    ids.course = await createCourse(db, await coach(), { title: "Sequenced course", categoryId: ids.cat, description: "A course description long enough to satisfy validation rules.", difficulty: "BEGINNER", passingScore: 60, requiresCoachReview: false, priceUsd: "", syllabus: "", contentUrl: "" });
    const c = await coach();
    ids.m1 = await saveModule(db, c, ids.course, { title: "Module 1", description: "" });
    ids.m2 = await saveModule(db, c, ids.course, { title: "Module 2", description: "" });
    ids.intro = await saveLesson(db, c, ids.course, { moduleId: ids.m1, title: "Intro", contentType: "TEXT", body: "# Start here" });
    ids.optionalLink = await saveLesson(db, c, ids.course, { moduleId: ids.m1, title: "Optional reading", contentType: "LINK", url: "https://example.com", isRequired: false });
    ids.quiz = await saveLesson(db, c, ids.course, { moduleId: ids.m1, title: "Module 1 quiz", contentType: "QUIZ", passingScore: 60 });
    await saveQuestion(db, c, ids.course, ids.quiz, { prompt: "Pick A", choices: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] });
    ids.m2Text = await saveLesson(db, c, ids.course, { moduleId: ids.m2, title: "Module 2 reading", contentType: "TEXT", body: "Next" });
    ids.assignment = await saveLesson(db, c, ids.course, { moduleId: ids.m2, title: "Homework", contentType: "ASSIGNMENT", submissionType: "TEXT" });
    ids.finalAssessment = await saveLesson(db, c, ids.course, { moduleId: ids.m2, title: "Final assessment", contentType: "ASSESSMENT", passingScore: 60, isRequired: false });
    await saveQuestion(db, c, ids.course, ids.finalAssessment, { prompt: "Pick A again", choices: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] });
    await updateCourseSettings(db, c, ids.course, settings({ sequentialUnlock: true }));
    await submitCourseForApproval(db, c, ids.course);
    await publishCourse(db, admin(), ids.course, { certificationTemplateId: ids.template });
    await enrol(db, agent(), ids.course);

    let e = await getEnrollmentForAgent(db, agent(), ids.course);
    expect(Object.keys(e.lockedLessons).sort()).toEqual([ids.assignment, ids.finalAssessment, ids.m2Text, ids.optionalLink, ids.quiz].sort());
    expect(e.lockedLessons[ids.quiz]).toBe('Finish "Intro" first.');
    await expect(startAttempt(db, agent(), ids.quiz)).rejects.toThrow(/Finish "Intro" first/);
    await expect(startLesson(db, agent(), ids.optionalLink)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(markLessonComplete(db, agent(), ids.m2Text)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(submitAssignment(db, agent(), ids.assignment, { text: "early" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await quizStateForLearner(db, agent(), ids.quiz).catch((x) => x)) instanceof ForbiddenError).toBe(true);

    await markLessonComplete(db, agent(), ids.intro);
    e = await getEnrollmentForAgent(db, agent(), ids.course);
    expect(Object.keys(e.lockedLessons).sort()).toEqual([ids.assignment, ids.finalAssessment, ids.m2Text].sort());
    expect(e.lockedLessons[ids.m2Text]).toBe('Finish "Module 1 quiz" first.');
    expect((await startLesson(db, agent(), ids.optionalLink)).status).toBe("IN_PROGRESS"); // optional lessons open with their module

    // a failed quiz keeps module 2 locked; a pass opens it
    let a = await startAttempt(db, agent(), ids.quiz);
    let v = await attemptForLearner(db, agent(), a);
    await submitAttempt(db, agent(), a, { [v.questions[0].questionId]: [v.questions[0].choices.find((x) => x.text === "B")!.id] });
    await expect(markLessonComplete(db, agent(), ids.m2Text)).rejects.toBeInstanceOf(ForbiddenError);
    a = await startAttempt(db, agent(), ids.quiz);
    v = await attemptForLearner(db, agent(), a);
    const r = await submitAttempt(db, agent(), a, { [v.questions[0].questionId]: [v.questions[0].choices.find((x) => x.text === "A")!.id] });
    expect(r.passed).toBe(true);
    e = await getEnrollmentForAgent(db, agent(), ids.course);
    expect(e.lockedLessons).toEqual({ [ids.assignment]: 'Finish "Module 2 reading" first.', [ids.finalAssessment]: 'Finish "Module 2 reading" first.' });
    await markLessonComplete(db, agent(), ids.m2Text);
    expect((await getEnrollmentForAgent(db, agent(), ids.course)).lockedLessons).toEqual({ [ids.finalAssessment]: 'Finish "Homework" first.' });
  });
});

describe("completion rules", () => {
  it("the final-assessment rule makes the optional assessment count; the course completes and certifies once it is passed", async () => {
    await updateCourseSettings(db, await coach(), ids.course, settings({ sequentialUnlock: true, completionRequiresFinalAssessment: true }));
    let e = await getEnrollmentForAgent(db, agent(), ids.course);
    expect(e.courseProgress).toMatchObject({ requiredTotal: 5, requiredDone: 3, percent: 60 });
    // the assignment is still open (pending review does not complete); grade it directly through the data layer to keep this test focused
    await submitAssignment(db, agent(), ids.assignment, { text: "My homework" });
    const sub = await db.assignmentSubmission.findFirstOrThrow({ where: { lessonId: ids.assignment } });
    await db.assignmentSubmission.update({ where: { id: sub.id }, data: { status: "GRADED", grade: 1, reviewedById: ids.coach, reviewedAt: new Date() } });
    await db.lessonProgress.update({ where: { lessonId_agentProfileId: { lessonId: ids.assignment, agentProfileId: ids.agentProfile } }, data: { status: "COMPLETED", completedAt: new Date() } });
    const p = await recalculateCourseProgress(db, ids.course, ids.agentProfile);
    expect(p).toMatchObject({ requiredTotal: 5, requiredDone: 4, percent: 80, completedNow: false });
    expect(await db.courseCompletion.count()).toBe(0);

    const a = await startAttempt(db, agent(), ids.finalAssessment);
    const v = await attemptForLearner(db, agent(), a);
    const r = await submitAttempt(db, agent(), a, { [v.questions[0].questionId]: [v.questions[0].choices.find((x) => x.text === "A")!.id] });
    expect(r).toMatchObject({ passed: true, courseCompleted: true, coursePercent: 100 });
    e = await getEnrollmentForAgent(db, agent(), ids.course);
    expect(e.enrollment?.status).toBe("COMPLETED");
    const cert = await db.certification.findFirstOrThrow({ where: { agentProfileId: ids.agentProfile, courseId: ids.course } });
    ids.certId = cert.id;
    expect(cert.status).toBe("APPROVED");
    expect(cert.certificateNumber).toMatch(/^HC-\d{4}-000001$/);
    expect(cert.verificationCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("adding a required lesson after completion lowers the cached progress but never revokes the completion", async () => {
    const extra = await saveLesson(db, await coach(), ids.course, { moduleId: ids.m2, title: "New required reading", contentType: "TEXT", body: "Added later" });
    const e = await getEnrollmentForAgent(db, agent(), ids.course);
    expect(e.courseProgress).toMatchObject({ requiredTotal: 6, requiredDone: 5, percent: 83 });
    expect(e.enrollment?.status).toBe("COMPLETED");
    expect(await db.courseCompletion.count()).toBe(1);
    await deleteLesson(db, await coach(), ids.course, extra);
    expect((await getEnrollmentForAgent(db, agent(), ids.course)).courseProgress?.percent).toBe(100);
    expect(await db.courseCompletion.count()).toBe(1);
  });
});

describe("certificates", () => {
  it("numbers are sequential per year; admin-issued certificates are numbered too", async () => {
    await issueCertification(db, admin(), { agentProfileId: ids.agent2Profile, templateId: ids.template, reason: "Prior experience" });
    const c = await db.certification.findFirstOrThrow({ where: { agentProfileId: ids.agent2Profile, templateId: ids.template } });
    expect(c.certificateNumber).toMatch(/^HC-\d{4}-000002$/);
    expect(c.verificationCode).not.toBeNull();
    expect(c.verificationCode).not.toBe((await db.certification.findUniqueOrThrow({ where: { id: ids.certId } })).verificationCode);
  });

  it("the owner and certification staff can open the certificate; others get NotFound; it names learner, course, coach, and number", async () => {
    const view = await certificateForActor(db, agent(), ids.certId);
    expect(view).toMatchObject({ learnerName: "Ana Lim", courseTitle: "Sequenced course", coach: "coach", templateName: "Certified Setter", status: "APPROVED" });
    expect(view.certificateNumber).toMatch(/^HC-/);
    expect(view.expiresAt).not.toBeNull();
    await expect(certificateForActor(db, agent2(), ids.certId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(certificateForActor(db, client(), ids.certId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await certificateForActor(db, admin(), ids.certId)).id).toBe(ids.certId);
    await expect(certificateForActor(db, await coach(), ids.certId)).rejects.toBeInstanceOf(NotFoundError); // coaches have no certification permission by default
  });

  it("public verification returns a minimal projection; unknown, revoked, and expired codes read as not valid", async () => {
    const code = (await db.certification.findUniqueOrThrow({ where: { id: ids.certId } })).verificationCode!;
    let r = await verifyCertificate(db, code.toLowerCase());
    expect(r).toMatchObject({ found: true, valid: true, status: "APPROVED", learnerName: "Ana Lim", courseTitle: "Sequenced course", templateName: "Certified Setter" });
    expect(JSON.stringify(r)).not.toContain("agent1@t.example");
    expect(await verifyCertificate(db, "ZZZZ-ZZZZ-ZZZZ")).toMatchObject({ found: false, valid: false });
    expect(await verifyCertificate(db, "not a code")).toMatchObject({ found: false, valid: false });
    await db.certification.update({ where: { id: ids.certId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    r = await verifyCertificate(db, code);
    expect(r).toMatchObject({ found: true, valid: false, status: "EXPIRED" });
    await db.certification.update({ where: { id: ids.certId }, data: { expiresAt: new Date(Date.now() + 86_400_000) } });
    await revokeCertification(db, admin(), ids.certId, "Test revocation");
    r = await verifyCertificate(db, code);
    expect(r).toMatchObject({ found: true, valid: false, status: "REVOKED" });
  });
});
