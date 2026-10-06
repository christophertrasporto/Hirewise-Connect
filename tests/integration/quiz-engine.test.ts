import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { createCourse, saveModule, saveLesson, submitCourseForApproval, publishCourse, enrol, getEnrollmentForAgent } from "@/server/services/academy.service";
import { saveQuestion, deleteQuestion, moveQuestion, duplicateQuestion, startAttempt, attemptForLearner, submitAttempt, quizStateForLearner, attemptsAwaitingReview, reviewAttempt } from "@/server/services/quiz.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { collectKeys } from "@/server/views/forbidden-keys";
import { ROLE_NAMES, ROLE_PERMISSIONS, type RoleKey } from "@/server/policies/permissions";
import { runWorkerOnce } from "@/server/jobs/worker";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";

const db = testDb();
const ids = { coach: "coach_q", coach2: "coach_q2", admin: "admin_q", agentUser: "", agentProfile: "", agent2User: "", agent2Profile: "", cat: "", course: "", module: "", quiz: "", q1: "", q2: "", q3: "", q4: "", template: "" };

beforeAll(async () => {
  process.env.APP_URL = "http://localhost:3000";
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
  ids.template = (await db.certificationTemplate.create({ data: { name: "Certified Setter", requiresCompletion: true, minExamScore: 70, requiresCoachReview: false } })).id;
});

afterAll(async () => {
  setEmailChannelForTests(null);
  await db.$disconnect();
});

const coach = () => resolveActor(db, ids.coach);
const coach2 = () => resolveActor(db, ids.coach2);
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const agent = () => makeActor("AGENT", { userId: ids.agentUser, agentProfileId: ids.agentProfile });
const agent2 = () => makeActor("AGENT", { userId: ids.agent2User, agentProfileId: ids.agent2Profile });

describe("question builder", () => {
  it("coach builds a quiz lesson with every question type; validation per type; no question limit", async () => {
    ids.course = await createCourse(db, await coach(), { title: "Cold Calling Mastery", categoryId: ids.cat, description: "A course description long enough to satisfy validation rules.", difficulty: "BEGINNER", passingScore: 70, requiresCoachReview: false, priceUsd: "", syllabus: "", contentUrl: "" });
    ids.module = await saveModule(db, await coach(), ids.course, { title: "Module 1", description: "" });
    ids.quiz = await saveLesson(db, await coach(), ids.course, { moduleId: ids.module, title: "Module quiz", contentType: "QUIZ", passingScore: 60, maxAttempts: 2, shuffleAnswers: true, showCorrectAnswers: true, showExplanations: true });
    const text = await saveLesson(db, await coach(), ids.course, { moduleId: ids.module, title: "Intro", contentType: "TEXT", body: "# Hi", isRequired: false });

    await expect(saveQuestion(db, await coach(), ids.course, text, { prompt: "Not a quiz", choices: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] })).rejects.toThrow(/do not have questions/);
    await expect(saveQuestion(db, await coach(), ids.course, ids.quiz, { prompt: "One choice", choices: [{ text: "A", isCorrect: true }] })).rejects.toThrow();
    await expect(saveQuestion(db, await coach(), ids.course, ids.quiz, { prompt: "No correct", choices: [{ text: "A", isCorrect: false }, { text: "B", isCorrect: false }] })).rejects.toThrow();
    await expect(saveQuestion(db, await coach(), ids.course, ids.quiz, { type: "MULTIPLE_CHOICE", prompt: "Two correct", choices: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: true }] })).rejects.toThrow();
    await expect(saveQuestion(db, await coach(), ids.course, ids.quiz, { type: "TRUE_FALSE", prompt: "Bad TF", choices: [{ text: "True", isCorrect: true }] })).rejects.toThrow();

    ids.q1 = await saveQuestion(db, await coach(), ids.course, ids.quiz, { type: "MULTIPLE_CHOICE", prompt: "Goal of the first ten seconds?", explanation: "Earn permission.", points: 1, choices: [{ text: "Explain everything", isCorrect: false }, { text: "Earn permission to continue", isCorrect: true }, { text: "Ask for the sale", isCorrect: false }, { text: "Hang up", isCorrect: false }, { text: "Read the script", isCorrect: false }] });
    ids.q2 = await saveQuestion(db, await coach(), ids.course, ids.quiz, { type: "MULTIPLE_SELECT", prompt: "Which are qualification questions?", points: 2, choices: [{ text: "What is your current setup?", isCorrect: true }, { text: "Can I have the sale now?", isCorrect: false }, { text: "Who else is involved in the decision?", isCorrect: true }] });
    ids.q3 = await saveQuestion(db, await coach(), ids.course, ids.quiz, { type: "TRUE_FALSE", prompt: "You may share your personal phone number with clients.", points: 1, choices: [{ text: "True", isCorrect: false }, { text: "False", isCorrect: true }] });
    ids.q4 = await saveQuestion(db, await coach(), ids.course, ids.quiz, { type: "SHORT_ANSWER", prompt: "Name the CRM field you fill right after booking.", points: 1, keywords: ["time zone", "timezone"] });
    for (let i = 0; i < 6; i++) await saveQuestion(db, await coach(), ids.course, ids.quiz, { prompt: `Filler question ${i + 1}`, state: "DRAFT", choices: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] });
    const all = await db.question.findMany({ where: { lessonId: ids.quiz }, orderBy: { order: "asc" } });
    expect(all).toHaveLength(10);
    expect(all.map((q) => q.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await db.questionChoice.count({ where: { questionId: ids.q4 } })).toBe(0);
  });

  it("other coaches get NotFound; a coach without course.quiz.build is refused; admin may edit; reorder, duplicate, delete", async () => {
    await expect(saveQuestion(db, await coach2(), ids.course, ids.quiz, { prompt: "Intruder", choices: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] })).rejects.toBeInstanceOf(NotFoundError);
    const limited = { ...makeActor("COACH", { userId: ids.coach }), permissions: new Set(ROLE_PERMISSIONS.COACH.filter((k) => k !== "course.quiz.build")) };
    await expect(saveQuestion(db, limited, ids.course, ids.quiz, { prompt: "No build right", choices: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteQuestion(db, limited, ids.course, ids.q1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveQuestion(db, agent(), ids.course, ids.quiz, { prompt: "Agent", choices: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] })).rejects.toBeInstanceOf(ForbiddenError);

    const copyId = await duplicateQuestion(db, admin(), ids.course, ids.q1);
    const copy = await db.question.findUniqueOrThrow({ where: { id: copyId }, include: { choices: true } });
    expect(copy.state).toBe("DRAFT");
    expect(copy.prompt).toMatch(/\(copy\)$/);
    expect(copy.choices).toHaveLength(5);
    await moveQuestion(db, await coach(), ids.course, copyId, -1);
    const after = await db.question.findMany({ where: { lessonId: ids.quiz }, orderBy: { order: "asc" }, select: { id: true } });
    expect(after[after.length - 2].id).toBe(copyId);
    await deleteQuestion(db, await coach(), ids.course, copyId);
    expect(await db.question.count({ where: { lessonId: ids.quiz } })).toBe(10);
    expect((await db.question.findMany({ where: { lessonId: ids.quiz }, orderBy: { order: "asc" } })).map((q) => q.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("learner attempts", () => {
  it("published course with questions; locked for the unenrolled; snapshot never leaks answers; shuffled choices score correctly", async () => {
    await submitCourseForApproval(db, await coach(), ids.course);
    await publishCourse(db, admin(), ids.course, { certificationTemplateId: ids.template });
    await expect(startAttempt(db, agent(), ids.quiz)).rejects.toBeInstanceOf(NotFoundError); // not enrolled
    await enrol(db, agent(), ids.course);
    const state = await quizStateForLearner(db, agent(), ids.quiz);
    expect(state.lesson.questionCount).toBe(4); // drafts excluded
    expect(state.canStart).toBe(true);

    const attemptId = await startAttempt(db, agent(), ids.quiz);
    expect(await startAttempt(db, agent(), ids.quiz)).toBe(attemptId); // resume
    const view = await attemptForLearner(db, agent(), attemptId);
    expect(view.questions).toHaveLength(4);
    expect(JSON.stringify(view)).not.toContain("correctChoiceIds");
    expect(JSON.stringify(view)).not.toContain("isCorrect");
    expect(collectKeys(view).has("keywords")).toBe(false);
    await expect(attemptForLearner(db, agent2(), attemptId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(submitAttempt(db, agent2(), attemptId, {})).rejects.toBeInstanceOf(NotFoundError);

    // answer by choice id regardless of the shuffled display order
    const q1 = view.questions.find((q) => q.questionId === ids.q1)!;
    const q2 = view.questions.find((q) => q.questionId === ids.q2)!;
    const q3 = view.questions.find((q) => q.questionId === ids.q3)!;
    const pick = (q: typeof q1, texts: string[]) => q.choices.filter((c) => texts.includes(c.text)).map((c) => c.id);
    const r = await submitAttempt(db, agent(), attemptId, { [ids.q1]: pick(q1, ["Earn permission to continue"]), [ids.q2]: pick(q2, ["What is your current setup?", "Who else is involved in the decision?"]), [ids.q3]: pick(q3, ["False"]), [ids.q4]: "I update the timezone and context" });
    expect(r).toMatchObject({ scorePercent: 100, passed: true, expired: false, pendingReview: false, courseCompleted: true });
    expect(r.coursePercent).toBe(100); // the only required published lesson is the quiz; completion is recorded on the enrolment
    await expect(submitAttempt(db, agent(), attemptId, {})).rejects.toThrow(/already submitted/);

    const reviewed = await attemptForLearner(db, agent(), attemptId);
    expect(reviewed.result?.passed).toBe(true);
    expect(reviewed.questions.find((q) => q.questionId === ids.q1)?.correctChoiceIds).toHaveLength(1);
    expect(reviewed.questions.find((q) => q.questionId === ids.q1)?.explanation).toBe("Earn permission.");
    expect(reviewed.questions.every((q) => q.correct === true)).toBe(true);

    const e = await getEnrollmentForAgent(db, agent(), ids.course);
    expect(e.lessonProgress[ids.quiz]?.status).toBe("COMPLETED");
    expect(e.courseProgress?.percent).toBe(100);
    const enrollment = await db.courseEnrollment.findUniqueOrThrow({ where: { courseId_agentProfileId: { courseId: ids.course, agentProfileId: ids.agentProfile } }, include: { completion: true } });
    expect(enrollment.status).toBe("COMPLETED");
    expect(enrollment.completion?.examScore).toBe(100);
    expect(await db.certification.count({ where: { agentProfileId: ids.agentProfile, courseId: ids.course } })).toBe(1);
    const w = await runWorkerOnce(db);
    expect(w.failures).toBe(0);
  });

  it("failing, attempt limits, retake wait, score policy, and editing questions after attempts leaves history intact", async () => {
    await enrol(db, agent2(), ids.course);
    const a1 = await startAttempt(db, agent2(), ids.quiz);
    const v1 = await attemptForLearner(db, agent2(), a1);
    const wrong = Object.fromEntries(v1.questions.filter((q) => q.type !== "SHORT_ANSWER").map((q) => [q.questionId, [q.choices[0].id]]));
    const fail = await submitAttempt(db, agent2(), a1, { ...wrong, [ids.q4]: "no idea" });
    expect(fail.passed).toBe(false);
    expect(fail.attemptsLeft).toBe(1);
    let st = await quizStateForLearner(db, agent2(), ids.quiz);
    expect(st.progress?.status).toBe("RETAKE_REQUIRED");
    expect(st.canStart).toBe(true);

    // the coach rewords q1 and removes a choice: the submitted attempt still renders its own copy
    const before = await db.question.findUniqueOrThrow({ where: { id: ids.q1 }, include: { choices: { orderBy: { order: "asc" } } } });
    await saveQuestion(db, await coach(), ids.course, ids.quiz, { id: ids.q1, type: "MULTIPLE_CHOICE", prompt: "Goal of the first ten seconds (v2)?", points: 1, choices: before.choices.slice(0, 3).map((c) => ({ id: c.id, text: c.text, isCorrect: c.isCorrect })) });
    const afterQ = await db.question.findUniqueOrThrow({ where: { id: ids.q1 }, include: { choices: true } });
    expect(afterQ.version).toBe(2);
    expect(afterQ.choices).toHaveLength(3);
    const old = await attemptForLearner(db, agent2(), a1);
    const oldQ1 = old.questions.find((q) => q.questionId === ids.q1)!;
    expect(oldQ1.prompt).toBe("Goal of the first ten seconds?");
    expect(oldQ1.choices).toHaveLength(5);
    expect((await db.quizAttempt.findUniqueOrThrow({ where: { id: a1 } })).scorePercent).toBe(fail.scorePercent);

    // retake wait is enforced when configured
    await db.courseLesson.update({ where: { id: ids.quiz }, data: { retakeWaitMinutes: 60 } });
    st = await quizStateForLearner(db, agent2(), ids.quiz);
    expect(st.canStart).toBe(false);
    expect(st.blocked).toMatch(/retake this quiz after/);
    await expect(startAttempt(db, agent2(), ids.quiz)).rejects.toThrow(/retake/);
    await db.courseLesson.update({ where: { id: ids.quiz }, data: { retakeWaitMinutes: null } });

    const a2 = await startAttempt(db, agent2(), ids.quiz);
    const v2 = await attemptForLearner(db, agent2(), a2);
    expect(v2.questions.find((q) => q.questionId === ids.q1)?.prompt).toBe("Goal of the first ten seconds (v2)?");
    const right = Object.fromEntries(v2.questions.filter((q) => q.type !== "SHORT_ANSWER").map((q) => [q.questionId, q.choices.filter((c) => ["Earn permission to continue", "What is your current setup?", "Who else is involved in the decision?", "False"].includes(c.text)).map((c) => c.id)]));
    const pass = await submitAttempt(db, agent2(), a2, { ...right, [ids.q4]: "time zone" });
    expect(pass.passed).toBe(true);
    expect(pass.attemptsLeft).toBe(0);
    st = await quizStateForLearner(db, agent2(), ids.quiz);
    expect(st.countingScore).toBe(100); // HIGHEST
    expect(st.canStart).toBe(false);
    expect(st.blocked).toMatch(/all 2 attempts/);
    await db.courseLesson.update({ where: { id: ids.quiz }, data: { scorePolicy: "LATEST" } });
    expect((await quizStateForLearner(db, agent2(), ids.quiz)).countingScore).toBe(100);
  });

  it("short answers without keywords go to coach review; the coach's score decides pass or fail and updates progress", async () => {
    const lesson = await saveLesson(db, await coach(), ids.course, { moduleId: ids.module, title: "Reflection", contentType: "ASSESSMENT", passingScore: 50, reviewMode: "AUTO", isRequired: false });
    await saveQuestion(db, await coach(), ids.course, lesson, { type: "SHORT_ANSWER", prompt: "Describe your opener.", points: 2 });
    await saveQuestion(db, await coach(), ids.course, lesson, { type: "TRUE_FALSE", prompt: "Hirewise sets client rates.", points: 1, choices: [{ text: "True", isCorrect: true }, { text: "False", isCorrect: false }] });
    const id = await startAttempt(db, agent(), lesson);
    const v = await attemptForLearner(db, agent(), id);
    const tf = v.questions.find((q) => q.type === "TRUE_FALSE")!;
    const sa = v.questions.find((q) => q.type === "SHORT_ANSWER")!;
    const r = await submitAttempt(db, agent(), id, { [tf.questionId]: [tf.choices.find((c) => c.text === "True")!.id], [sa.questionId]: "I open with a reason and ask for thirty seconds." });
    expect(r.pendingReview).toBe(true);
    expect(r.passed).toBeNull();
    expect(r.scorePercent).toBe(33);
    expect((await quizStateForLearner(db, agent(), lesson)).progress?.status).toBe("PENDING_REVIEW");

    await expect(attemptsAwaitingReview(db, await coach2(), ids.course)).rejects.toBeInstanceOf(NotFoundError);
    const queue = await attemptsAwaitingReview(db, await coach(), ids.course);
    expect(queue).toHaveLength(1);
    expect(queue[0].shortAnswers[0].answer).toMatch(/thirty seconds/);
    await expect(reviewAttempt(db, agent(), ids.course, id, { scorePercent: 100 })).rejects.toBeInstanceOf(ForbiddenError);
    await reviewAttempt(db, await coach(), ids.course, id, { scorePercent: 100, feedback: "Clear and concise." });
    const done = await attemptForLearner(db, agent(), id);
    expect(done.result).toMatchObject({ scorePercent: 100, passed: true, pendingReview: false, feedback: "Clear and concise." });
    expect((await quizStateForLearner(db, agent(), lesson)).progress?.status).toBe("COMPLETED");
    await expect(reviewAttempt(db, await coach(), ids.course, id, { scorePercent: 10 })).rejects.toThrow(/not awaiting review/);
  });

  it("a timed attempt that runs out is recorded as expired and never passes", async () => {
    const lesson = await saveLesson(db, await coach(), ids.course, { moduleId: ids.module, title: "Timed", contentType: "QUIZ", passingScore: 1, timeLimitMin: 5, isRequired: false });
    await saveQuestion(db, await coach(), ids.course, lesson, { prompt: "Quick one?", choices: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] });
    const id = await startAttempt(db, agent(), lesson);
    await db.quizAttempt.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 120_000) } });
    const v = await attemptForLearner(db, agent(), id);
    const r = await submitAttempt(db, agent(), id, { [v.questions[0].questionId]: [v.questions[0].choices.find((c) => c.text === "A")!.id] });
    expect(r.expired).toBe(true);
    expect(r.passed).toBe(false);
    expect((await db.quizAttempt.findUniqueOrThrow({ where: { id } })).status).toBe("EXPIRED");
  });
});
