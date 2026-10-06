import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { createCourse, updateCourse, saveModule, saveLesson, submitCourseForApproval, publishCourse, listCoursesForCoach, getCourseForCoach, catalogForAgent, enrol, getEnrollmentForAgent, recordCoursePayment, listPendingCoursePayments } from "@/server/services/academy.service";
import { saveQuestion, startAttempt, attemptForLearner, submitAttempt } from "@/server/services/quiz.service";
import { recordAssessment, recordEvaluation } from "@/server/services/assessment.service";
import { issueCertification, revokeCertification, expireCertifications, listPendingCertifications } from "@/server/services/certification.service";
import { recomputeVerification, setVerificationManually, updateRequirement } from "@/server/services/verification.service";
import { getCandidateForClient, searchCandidates } from "@/server/services/search.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { runWorkerOnce } from "@/server/jobs/worker";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { collectKeys, FORBIDDEN_FOR_CLIENT } from "@/server/views/forbidden-keys";

const db = testDb();
const ids = { coach: "coach_1", coach2: "coach_2", admin: "admin_1", sales: "sales_1", agentUser: "", agentProfile: "", agent2User: "", agent2Profile: "", clientUser: "", clientId: "", templateSetter: "", templateCsr: "", labelGood: "", labelPoor: "", freeCourse: "", paidCourse: "" };

let salesCategoryId = "";
const courseInput = (title: string, priceUsd: string, requiresCoachReview = false) => ({ title, categoryId: salesCategoryId, difficulty: "BEGINNER" as const, description: "A course description long enough to satisfy validation rules.", syllabus: "Module 1", contentUrl: "", priceUsd, passingScore: 70, requiresCoachReview });
const quizIds = { free: "", paid: "" };
/** One module with one quiz lesson holding three published questions (points 1, 1, 2). Returns the lesson id. */
async function buildQuiz(courseId: string, maxAttempts: number) {
  const actor = await coach();
  const moduleId = await saveModule(db, actor, courseId, { title: "Module 1", description: "" });
  const lessonId = await saveLesson(db, actor, courseId, { moduleId, title: "Final quiz", contentType: "QUIZ", passingScore: 70, maxAttempts });
  await saveQuestion(db, actor, courseId, lessonId, { prompt: "Question one prompt", points: 1, choices: [{ text: "A" }, { text: "B", isCorrect: true }, { text: "C" }] });
  await saveQuestion(db, actor, courseId, lessonId, { prompt: "Question two prompt", points: 1, choices: [{ text: "A", isCorrect: true }, { text: "B" }] });
  await saveQuestion(db, actor, courseId, lessonId, { prompt: "Question three prompt", points: 2, choices: [{ text: "A" }, { text: "B" }, { text: "C" }, { text: "D", isCorrect: true }] });
  return lessonId;
}
/** Answer by choice text so the test does not depend on ids or display order. */
const answersByText = (questions: Array<{ questionId: string; choices: Array<{ id: string; text: string }> }>, picks: string[]) => Object.fromEntries(questions.map((q, i) => [q.questionId, q.choices.filter((c) => c.text === picks[i]).map((c) => c.id)]));

beforeAll(async () => {
  process.env.APP_URL = "http://localhost:3000";
  setEmailChannelForTests(new ConsoleEmailChannel());
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  salesCategoryId = (await db.courseCategory.create({ data: { name: "Sales", slug: "sales", order: 10 } })).id;
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.user.create({ data: { id: ids.coach, email: "coach@hirewise.example", roleId: await role("COACH") } });
  await db.user.create({ data: { id: ids.coach2, email: "coach2@hirewise.example", roleId: await role("COACH") } });
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN") } });
  await db.user.create({ data: { id: ids.sales, email: "sales@hirewise.example", roleId: await role("SALES") } });
  const agentRole = await role("AGENT");
  const mk = async (email: string, name: string) => {
    const u = await db.user.create({ data: { email, roleId: agentRole } });
    const p = await db.agentProfile.create({ data: { userId: u.id, displayName: name, headline: "H", primaryRole: "Appointment Setter", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila", approvedAt: new Date(), languages: ["English"], verificationLevel: "PROFILE_VERIFIED", privateContact: { create: { fullLegalName: `${name} Legal`, phone: "+63" } }, videos: { create: { storageKey: "agents/x/video/a.mp4", status: "APPROVED", isCurrent: true } }, recordings: { create: { kind: "COLD_CALL", title: "S", storageKey: "agents/x/recording/a.mp3", status: "APPROVED" } } } });
    return { u, p };
  };
  const a1 = await mk("agent1@t.example", "Agent One");
  const a2 = await mk("agent2@t.example", "Agent Two");
  ids.agentUser = a1.u.id; ids.agentProfile = a1.p.id; ids.agent2User = a2.u.id; ids.agent2Profile = a2.p.id;
  const cu = await db.user.create({ data: { email: "c@acme.example", roleId: await role("CLIENT"), emailVerifiedAt: new Date() } });
  ids.clientUser = cu.id;
  ids.clientId = (await db.client.create({ data: { companyName: "Acme", status: "ACTIVE", timezone: "America/Los_Angeles", contacts: { create: { userId: cu.id, name: "C", businessEmail: cu.email, isPrimary: true } } } })).id;
  ids.templateSetter = (await db.certificationTemplate.create({ data: { name: "Certified Setter", validityMonths: 24, requiresCompletion: true, minExamScore: 70, requiresCoachReview: true, minResultLabelRank: 2 } })).id;
  ids.templateCsr = (await db.certificationTemplate.create({ data: { name: "Certified CSR", validityMonths: null, requiresCompletion: true, minExamScore: 75, requiresCoachReview: false } })).id;
  ids.labelGood = (await db.assessmentResultLabel.create({ data: { key: "GOOD", label: "Good", rank: 2 } })).id;
  ids.labelPoor = (await db.assessmentResultLabel.create({ data: { key: "POOR", label: "Needs improvement", rank: 0 } })).id;
});

afterAll(async () => {
  setEmailChannelForTests(null);
  await db.$disconnect();
});

const coach = () => resolveActor(db, ids.coach);
const coach2 = () => resolveActor(db, ids.coach2);
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const agent = () => makeActor("AGENT", { userId: ids.agentUser, agentProfileId: ids.agentProfile });
const agent2 = () => makeActor("AGENT", { userId: ids.agent2User, agentProfileId: ids.agent2Profile });
const client = () => makeActor("CLIENT", { userId: ids.clientUser, clientId: ids.clientId });

describe("coach-authored courses with pricing and exams", () => {
  it("a coach creates a free course and a paid USD course; price is stored in integer cents", async () => {
    ids.freeCourse = await createCourse(db, await coach(), courseInput("Setter Fundamentals", "", true));
    ids.paidCourse = await createCourse(db, await coach(), courseInput("CSR Excellence", "49.50"));
    const rows = await db.academyCourse.findMany({ orderBy: { title: "asc" } });
    expect(rows.map((r) => [r.title, r.priceCents, r.currency, r.status])).toEqual([["CSR Excellence", 4950, "USD", "DRAFT"], ["Setter Fundamentals", 0, "USD", "DRAFT"]]);
    expect(rows.every((r) => r.ownerCoachUserId === ids.coach)).toBe(true);
    const audits = await db.auditLog.findMany({ where: { action: "COURSE_CREATED" } });
    expect(audits).toHaveLength(2);
  });

  it("agents, clients, and sales cannot create courses", async () => {
    await expect(createCourse(db, agent(), courseInput("X", ""))).rejects.toThrow(ForbiddenError);
    await expect(createCourse(db, client(), courseInput("X", ""))).rejects.toThrow(ForbiddenError);
    await expect(createCourse(db, sales(), courseInput("X", ""))).rejects.toThrow(ForbiddenError);
  });

  it("another coach cannot see or edit the course (NotFound, INV-P5); the owner and admin can", async () => {
    await expect(getCourseForCoach(db, await coach2(), ids.freeCourse)).rejects.toThrow(NotFoundError);
    await expect(updateCourse(db, await coach2(), ids.freeCourse, courseInput("Hijacked", "1"))).rejects.toThrow(NotFoundError);
    expect((await listCoursesForCoach(db, await coach2())).length).toBe(0);
    expect((await listCoursesForCoach(db, await coach())).length).toBe(2);
    expect((await getCourseForCoach(db, admin(), ids.freeCourse)).course.title).toBe("Setter Fundamentals");
  });

  it("changing the price is audited separately", async () => {
    await updateCourse(db, await coach(), ids.paidCourse, courseInput("CSR Excellence", "49"));
    const a = await db.auditLog.findFirst({ where: { action: "COURSE_PRICE_CHANGED", entityId: ids.paidCourse } });
    expect(a?.previousValue).toEqual({ priceCents: 4950 });
    expect(a?.newValue).toEqual({ priceCents: 4900, currency: "USD" });
  });

  it("submitting without a published lesson is refused; the coach builds the quiz and submits; admin publishes with a template", async () => {
    await expect(submitCourseForApproval(db, await coach(), ids.freeCourse)).rejects.toThrow(/published lesson/i);
    quizIds.free = await buildQuiz(ids.freeCourse, 2);
    quizIds.paid = await buildQuiz(ids.paidCourse, 1);
    await expect(saveQuestion(db, await coach(), ids.freeCourse, quizIds.free, { prompt: "No right answer", choices: [{ text: "A" }, { text: "B" }] })).rejects.toThrow(/exactly one choice/);
    await submitCourseForApproval(db, await coach(), ids.freeCourse);
    await submitCourseForApproval(db, await coach(), ids.paidCourse);
    await expect(publishCourse(db, await coach(), ids.freeCourse, {})).rejects.toThrow(ForbiddenError);
    await publishCourse(db, admin(), ids.freeCourse, { certificationTemplateId: ids.templateSetter });
    await publishCourse(db, admin(), ids.paidCourse, { certificationTemplateId: ids.templateCsr });
    const r = await runWorkerOnce(db);
    expect(r.failures).toBe(0);
    const c = await db.academyCourse.findUniqueOrThrow({ where: { id: ids.freeCourse } });
    expect(c.status).toBe("PUBLISHED");
    expect(await db.question.count({ where: { lessonId: quizIds.free, state: "PUBLISHED" } })).toBe(3);
    expect(await db.task.count({ where: { type: "PUBLISH_COURSE", status: "OPEN" } })).toBe(0);
    expect(await db.notification.count({ where: { userId: ids.coach, type: "COURSE_PUBLISHED" } })).toBe(2);
  });
});

describe("agent enrolment, payment gating, and quizzes", () => {
  it("the catalog shows prices; projections never contain the answer key", async () => {
    const cat = await catalogForAgent(db, agent());
    expect(cat.map((c) => [c.title, c.priceLabel])).toEqual(expect.arrayContaining([["Setter Fundamentals", "Free"], ["CSR Excellence", "USD 49.00"]]));
    const keys = collectKeys(cat);
    expect(keys.has("isCorrect")).toBe(false);
    expect(keys.has("correctChoiceIds")).toBe(false);
  });

  it("free course unlocks on enrolment; paid course stays locked until staff records payment", async () => {
    await enrol(db, agent(), ids.freeCourse);
    await enrol(db, agent(), ids.paidCourse);
    const free = await getEnrollmentForAgent(db, agent(), ids.freeCourse);
    const paid = await getEnrollmentForAgent(db, agent(), ids.paidCourse);
    expect(free.enrollment?.paymentStatus).toBe("NOT_REQUIRED");
    expect(free.course.syllabus).toBe("Module 1");
    expect(free.course.questionCount).toBe(3);
    expect(free.course.modules).not.toBeNull();
    expect(paid.enrollment?.paymentStatus).toBe("PENDING");
    expect(paid.course.syllabus).toBeNull();
    expect(paid.course.modules).toBeNull();
    await expect(startAttempt(db, agent(), quizIds.paid)).rejects.toThrow(ForbiddenError);
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { type: "COURSE_PAYMENT_PENDING" } })).toBeGreaterThan(0);
  });

  it("only staff with course.payment.record can record; underpayment is refused; waiving needs a reason", async () => {
    const pending = await listPendingCoursePayments(db, sales());
    expect(pending).toHaveLength(1);
    const enrollmentId = pending[0].id;
    await expect(recordCoursePayment(db, agent(), enrollmentId, { paidUsd: "49", waived: false })).rejects.toThrow(ForbiddenError);
    await expect(recordCoursePayment(db, await coach(), enrollmentId, { paidUsd: "49", waived: false })).rejects.toThrow(ForbiddenError);
    await expect(recordCoursePayment(db, sales(), enrollmentId, { paidUsd: "20", waived: false })).rejects.toThrow(/cover the course price/);
    await expect(recordCoursePayment(db, sales(), enrollmentId, { waived: true })).rejects.toThrow(/reason/);
    await recordCoursePayment(db, sales(), enrollmentId, { paidUsd: "49", reference: "GCASH-1", waived: false });
    const e = await db.courseEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect([e.paymentStatus, e.paidCents, e.paymentReference, e.paymentRecordedById]).toEqual(["PAID", 4900, "GCASH-1", ids.sales]);
    await expect(recordCoursePayment(db, sales(), enrollmentId, { paidUsd: "49", waived: false })).rejects.toThrow(/pending/);
    const paid = await getEnrollmentForAgent(db, agent(), ids.paidCourse);
    expect(paid.course.modules).not.toBeNull();
    expect(paid.course.questionCount).toBe(3);
  });

  it("an agent cannot open another agent's attempt", async () => {
    const attemptId = await startAttempt(db, agent(), quizIds.free);
    await expect(attemptForLearner(db, agent2(), attemptId)).rejects.toThrow(NotFoundError);
    await expect(submitAttempt(db, agent2(), attemptId, {})).rejects.toThrow(NotFoundError);
    const a = await attemptForLearner(db, agent(), attemptId);
    expect(JSON.stringify(a)).not.toContain("correctChoiceIds");
    expect(JSON.stringify(a)).not.toContain("isCorrect");
    expect(a.questions).toHaveLength(3);
    // resuming returns the same open attempt
    expect(await startAttempt(db, agent(), quizIds.free)).toBe(attemptId);
  });

  it("a failing attempt records no completion; a passing attempt completes the course but waits for coach review before certifying", async () => {
    const attemptId = await startAttempt(db, agent(), quizIds.free);
    const a = await attemptForLearner(db, agent(), attemptId);
    const fail = await submitAttempt(db, agent(), attemptId, answersByText(a.questions, ["A", "B", "A"]));
    expect(fail).toMatchObject({ scorePercent: 0, passed: false, attemptsLeft: 1, courseCompleted: false });
    expect(await db.courseCompletion.count()).toBe(0);
    await expect(submitAttempt(db, agent(), attemptId, {})).rejects.toThrow(/already submitted/);

    const second = await startAttempt(db, agent(), quizIds.free);
    const b = await attemptForLearner(db, agent(), second);
    const pass = await submitAttempt(db, agent(), second, answersByText(b.questions, ["B", "A", "D"]));
    expect(pass).toMatchObject({ scorePercent: 100, passed: true, courseCompleted: true, coursePercent: 100 });
    // the template requires a coach review, so no certification yet
    expect(await db.certification.count({ where: { agentProfileId: ids.agentProfile, templateId: ids.templateSetter } })).toBe(0);
    const e = await db.courseEnrollment.findUniqueOrThrow({ where: { courseId_agentProfileId: { courseId: ids.freeCourse, agentProfileId: ids.agentProfile } }, include: { completion: true } });
    expect(e.status).toBe("COMPLETED");
    expect(e.completion?.examScore).toBe(100);
    await expect(startAttempt(db, agent(), quizIds.free)).rejects.toThrow(/attempts/);
    const r = await runWorkerOnce(db);
    expect(r.failures).toBe(0);
    expect(await db.task.count({ where: { type: "ASSESS_STUDENT", status: "OPEN", assigneeUserId: ids.coach } })).toBe(1);
  });

  it("attempt limit is enforced on the paid course (maxAttempts 1)", async () => {
    const attemptId = await startAttempt(db, agent(), quizIds.paid);
    const a = await attemptForLearner(db, agent(), attemptId);
    await submitAttempt(db, agent(), attemptId, answersByText(a.questions, ["A", "B", "A"]));
    await expect(startAttempt(db, agent(), quizIds.paid)).rejects.toThrow(/attempts/);
  });
});

describe("assessment, certification pipeline, verification ladder", () => {
  const assessment = (over: Record<string, unknown> = {}) => ({ courseId: ids.freeCourse, agentProfileId: ids.agentProfile, type: "ROLEPLAY" as const, examScore: "" as const, practicalScore: "" as const, roleplayScore: 85, communicationScore: 90, comments: "internal", strengths: "tone", areasForImprovement: "pace", resultLabelId: ids.labelGood, certificationRecommended: true, ...over });

  it("only an assigned coach (or admin) can assess; the unassigned coach gets NotFound", async () => {
    await expect(recordAssessment(db, await coach2(), assessment())).rejects.toThrow(NotFoundError);
    await expect(recordAssessment(db, sales(), assessment())).rejects.toThrow(ForbiddenError);
    await expect(recordAssessment(db, agent(), assessment())).rejects.toThrow(ForbiddenError);
    await expect(recordAssessment(db, await coach(), assessment({ agentProfileId: ids.agent2Profile }))).rejects.toThrow(NotFoundError);
  });

  it("a FINAL assessment with a recommendation issues the certification and lifts verification", async () => {
    const before = await db.agentProfile.findUniqueOrThrow({ where: { id: ids.agentProfile } });
    expect(before.verificationLevel).toBe("PROFILE_VERIFIED");
    const r = await recordAssessment(db, await coach(), assessment());
    expect(r.certification).toEqual({ issued: true, status: "APPROVED" });
    const cert = await db.certification.findFirstOrThrow({ where: { agentProfileId: ids.agentProfile, templateId: ids.templateSetter } });
    expect(cert.origin).toBe("ACADEMY");
    expect(cert.expiresAt).not.toBeNull();
    const after = await db.agentProfile.findUniqueOrThrow({ where: { id: ids.agentProfile } });
    // approved profile + video + recording + certification + rank 2 assessment → INTERVIEW_READY (DEPLOYMENT_READY needs a billing rate, Phase 4)
    expect(after.verificationLevel).toBe("INTERVIEW_READY");
    expect(after.verificationIsManual).toBe(false);
    const r2 = await runWorkerOnce(db);
    expect(r2.failures).toBe(0);
    expect(await db.notification.count({ where: { userId: ids.agentUser, type: "CERTIFICATION_APPROVED" } })).toBe(1);
    expect(await db.task.count({ where: { type: "ASSESS_STUDENT", status: "OPEN" } })).toBe(0);
    // a second assessment does not issue a duplicate
    const again = await recordAssessment(db, await coach(), assessment());
    expect(again.certification).toEqual({ issued: false, reason: "already issued" });
  });

  it("exam-only template certifies automatically when the score clears minExamScore (agent 2 on the paid course, waived)", async () => {
    await enrol(db, agent2(), ids.paidCourse);
    const pending = await listPendingCoursePayments(db, admin());
    await recordCoursePayment(db, admin(), pending[0].id, { waived: true, reason: "Scholarship" });
    const attemptId = await startAttempt(db, agent2(), quizIds.paid);
    const a = await attemptForLearner(db, agent2(), attemptId);
    const r = await submitAttempt(db, agent2(), attemptId, answersByText(a.questions, ["B", "A", "D"]));
    expect(r).toMatchObject({ scorePercent: 100, passed: true, courseCompleted: true });
    const cert = await db.certification.findFirstOrThrow({ where: { agentProfileId: ids.agent2Profile, templateId: ids.templateCsr } });
    expect([cert.status, cert.origin, cert.courseId]).toEqual(["APPROVED", "ACADEMY", ids.paidCourse]);
    const p = await db.agentProfile.findUniqueOrThrow({ where: { id: ids.agent2Profile } });
    // certification but no assessment: ladder stops at PROFILE_VERIFIED because SKILLS_ASSESSED needs an assessment
    expect(p.verificationLevel).toBe("PROFILE_VERIFIED");
  });

  it("client-facing projections show approved certifications and the coach label but none of the forbidden keys", async () => {
    await recordEvaluation(db, await coach(), { agentProfileId: ids.agentProfile, summary: "Reliable and coachable across the board.", communication: 5, reliability: 4, coachability: 5, overallLabelId: ids.labelGood, visibleToClients: true });
    const { candidate } = await getCandidateForClient(db, client(), ids.agentProfile);
    expect(candidate.certifications.map((c) => c.name)).toEqual(["Certified Setter"]);
    expect(candidate.certifications[0].scores).toEqual({ examScore: 100, roleplayScore: 85, communicationScore: 90 });
    expect(candidate.assessment?.label).toBe("Good");
    expect(candidate.coachEvaluation?.summary).toContain("Reliable");
    const keys = collectKeys(candidate);
    for (const k of FORBIDDEN_FOR_CLIENT) expect(keys.has(k), k).toBe(false);
    expect(keys.has("strengths")).toBe(false);
    expect(keys.has("practicalScore")).toBe(false);
  });

  it("search filters by certification, completed course, and minimum assessment rank", async () => {
    const byCert = await searchCandidates(db, client(), { certifications: [ids.templateSetter] });
    expect(byCert.cards.map((c) => c.id)).toEqual([ids.agentProfile]);
    const byCourse = await searchCandidates(db, client(), { courses: [ids.paidCourse] });
    expect(byCourse.cards.map((c) => c.id).sort()).toEqual([ids.agent2Profile].sort());
    const byRank = await searchCandidates(db, client(), { minAssessment: 2 });
    expect(byRank.cards.map((c) => c.id)).toEqual([ids.agentProfile]);
    expect(byRank.cards[0].certifications[0].name).toBe("Certified Setter");
    expect(byRank.cards[0].assessmentLabel).toBe("Good");
  });

  it("admin can issue directly with a reason; revoking recomputes verification; agents cannot touch certifications", async () => {
    await expect(issueCertification(db, agent(), { agentProfileId: ids.agentProfile, templateId: ids.templateCsr, reason: "x" })).rejects.toThrow(ForbiddenError);
    await expect(issueCertification(db, await coach(), { agentProfileId: ids.agentProfile, templateId: ids.templateCsr, reason: "x" })).rejects.toThrow(ForbiddenError);
    await expect(issueCertification(db, admin(), { agentProfileId: ids.agentProfile, templateId: ids.templateCsr, reason: "  " })).rejects.toThrow(/reason/);
    await issueCertification(db, admin(), { agentProfileId: ids.agentProfile, templateId: ids.templateCsr, reason: "Prior CSR experience verified by references" });
    expect(await db.certification.count({ where: { agentProfileId: ids.agentProfile, status: "APPROVED" } })).toBe(2);

    const setter = await db.certification.findFirstOrThrow({ where: { agentProfileId: ids.agentProfile, templateId: ids.templateSetter } });
    await expect(revokeCertification(db, sales(), setter.id, "x")).rejects.toThrow(ForbiddenError);
    await revokeCertification(db, admin(), setter.id, "Recording showed scripted answers");
    const csr = await db.certification.findFirstOrThrow({ where: { agentProfileId: ids.agentProfile, templateId: ids.templateCsr } });
    await revokeCertification(db, admin(), csr.id, "Issued in error");
    const p = await db.agentProfile.findUniqueOrThrow({ where: { id: ids.agentProfile } });
    expect(p.verificationLevel).toBe("SKILLS_ASSESSED");
    expect(await listPendingCertifications(db, admin())).toHaveLength(0);
  });

  it("manual verification survives until a recompute changes the outcome, then clears the manual flag", async () => {
    await expect(setVerificationManually(db, sales(), ids.agentProfile, "DEPLOYMENT_READY", "because")).rejects.toThrow(ForbiddenError);
    await setVerificationManually(db, admin(), ids.agentProfile, "DEPLOYMENT_READY", "Legacy certified before the ladder existed");
    let p = await db.agentProfile.findUniqueOrThrow({ where: { id: ids.agentProfile } });
    expect([p.verificationLevel, p.verificationIsManual]).toEqual(["DEPLOYMENT_READY", true]);
    await recomputeVerification(db, ids.agentProfile, admin());
    p = await db.agentProfile.findUniqueOrThrow({ where: { id: ids.agentProfile } });
    expect([p.verificationLevel, p.verificationIsManual]).toEqual(["SKILLS_ASSESSED", false]);
  });

  it("admin-edited ladder rules change the computed level", async () => {
    await expect(updateRequirement(db, sales(), "HIREWISE_CERTIFIED", { profileApproved: true })).rejects.toThrow(ForbiddenError);
    await updateRequirement(db, admin(), "HIREWISE_CERTIFIED", { profileApproved: true, minAssessmentLabelRank: 2 });
    await updateRequirement(db, admin(), "INTERVIEW_READY", { profileApproved: true, videoApproved: true });
    expect(await recomputeVerification(db, ids.agentProfile, admin())).toBe("INTERVIEW_READY");
  });

  it("expired certifications are flipped by maintenance and 30-day warnings are queued", async () => {
    const soon = await db.certification.create({ data: { agentProfileId: ids.agent2Profile, templateId: ids.templateSetter, origin: "ADMIN_ISSUED", status: "APPROVED", approvedAt: new Date(), expiresAt: new Date(Date.now() + 10 * 86_400_000) } });
    const past = await db.certification.create({ data: { agentProfileId: ids.agent2Profile, templateId: ids.templateSetter, courseId: ids.freeCourse, origin: "ADMIN_ISSUED", status: "APPROVED", approvedAt: new Date(), expiresAt: new Date(Date.now() - 86_400_000) } });
    const r = await expireCertifications(db);
    expect(r).toEqual({ expired: 1, expiring: 1 });
    expect((await db.certification.findUniqueOrThrow({ where: { id: past.id } })).status).toBe("EXPIRED");
    expect((await db.certification.findUniqueOrThrow({ where: { id: soon.id } })).status).toBe("APPROVED");
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.agent2User, type: "CERTIFICATION_EXPIRING" } })).toBe(1);
  });
});
