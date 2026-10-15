import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { seedTerms } from "../setup/terms";
import { trainingCatalog, purchaseCourseSeats, recordCoursePurchase, assignCourse, agencyTrainingOverview, listCoursePurchases } from "@/server/services/training.service";
import { independentEligibility, applyIndependent, recordIndependentAccess, listIndependentAccess } from "@/server/services/independent.service";
import { revokeAgencySponsoredOnExit, inheritedSource, sourceForSelfEnrolment } from "@/server/services/credential.service";
import { enrol, getEnrollmentForAgent, recordCoursePayment } from "@/server/services/academy.service";
import { recordAssessment } from "@/server/services/assessment.service";
import { requestLeave, agencyDecide } from "@/server/services/exit.service";
import { assertLessonUnlocked } from "@/server/services/progress.service";
import { inviteLinkForAgency, registerViaInvite, joinAsExistingUser } from "@/server/services/invite.service";
import { createAgencyDirect } from "@/server/services/agency.service";
import { registerAgent } from "@/server/services/agent.service";
import { setSetting } from "@/server/services/setting.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { FORBIDDEN_FOR_AGENCY, FORBIDDEN_FOR_CLIENT, collectKeys } from "@/server/views/forbidden-keys";
import { toCandidateClientView } from "@/server/views/agent.views";
import { agentRepository } from "@/server/repositories/agent.repository";
import { runWorkerOnce } from "@/server/jobs/worker";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";

const db = testDb();
const email = new ConsoleEmailChannel();
const meta = { ipAddress: "198.51.100.13", userAgent: "vitest" };
const PASSWORD = "Str0ngPassw0rd!";
const ids = { super: "su_cred", admin: "admin_cred", sales: "sales_cred", coach: "coach_cred", ownerUser: "", agencyA: "", ownerB: "", agencyB: "", link: "", paidCourse: "", freeCourse: "", template: "", label: "", clientId: "" };
const people: Record<string, { userId: string; profileId: string }> = {};

const talent = (over: Record<string, unknown> = {}) => ({ termsAccepted: true, fullName: "Test Talent", displayName: "Test T.", email: "t@talent.example", password: PASSWORD, phone: "", locationCity: "Cebu", locationCountry: "Philippines", timezone: "Asia/Manila", primaryRole: "Cold Caller", yearsExperience: 2, ...over });
const superAdmin = () => makeActor("SUPER_ADMIN", { userId: ids.super });
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const owner = () => resolveActor(db, ids.ownerUser);
const agent = (name: string) => resolveActor(db, people[name].userId);

async function joinNew(name: string, emailAddr: string) {
  resetRateLimits();
  const r = await registerViaInvite(db, talent({ email: emailAddr, displayName: name }), ids.link, meta);
  await db.user.update({ where: { id: r.userId }, data: { emailVerifiedAt: new Date() } });
  await db.agencyMembership.updateMany({ where: { agentProfileId: r.agentProfileId, status: "PENDING_VERIFICATION" }, data: { status: "ACTIVE" } });
  await db.agentProfile.update({ where: { id: r.agentProfileId }, data: { status: "APPROVED" } });
  people[name] = { userId: r.userId, profileId: r.agentProfileId };
  return people[name];
}

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16";
  process.env.APP_URL = "http://localhost:3000";
  await resetDb(db);
  resetRateLimits();
  setEmailChannelForTests(email);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  await seedTerms(db);
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.user.create({ data: { id: ids.super, email: "owner@hirewise.example", roleId: await role("SUPER_ADMIN"), emailVerifiedAt: new Date() } });
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN"), emailVerifiedAt: new Date() } });
  await db.user.create({ data: { id: ids.sales, email: "sales@hirewise.example", roleId: await role("SALES"), emailVerifiedAt: new Date() } });
  await db.user.create({ data: { id: ids.coach, email: "coach@hirewise.example", roleId: await role("COACH"), emailVerifiedAt: new Date() } });
  await db.plan.createMany({ data: [{ id: "plan_starter", key: "STARTER", name: "Starter", baseAgentSeats: 5, sortOrder: 1 }] });
  const applicantRole = await role("APPLICANT");
  ids.ownerUser = (await db.user.create({ data: { email: "owner-a@agency.example", roleId: applicantRole, emailVerifiedAt: new Date() } })).id;
  ids.ownerB = (await db.user.create({ data: { email: "owner-b@agency.example", roleId: applicantRole, emailVerifiedAt: new Date() } })).id;
  ids.agencyA = await createAgencyDirect(db, superAdmin(), { ownerEmail: "owner-a@agency.example", name: "Agency A", country: "Philippines", reason: "credential tests", planKey: "STARTER" });
  ids.agencyB = await createAgencyDirect(db, superAdmin(), { ownerEmail: "owner-b@agency.example", name: "Agency B", country: "Philippines", reason: "credential tests", planKey: "STARTER" });
  ids.link = (await inviteLinkForAgency(db, await owner())).url.split("/join/")[1];
  const template = await db.certificationTemplate.create({ data: { name: "Hirewise Certified Setter", requiresCompletion: true, requiresCoachReview: true, minResultLabelRank: 2 } });
  ids.template = template.id;
  ids.label = (await db.assessmentResultLabel.create({ data: { key: "GOOD", label: "Good", rank: 2 } })).id;
  const mk = async (title: string, priceCents: number) => (await db.academyCourse.create({ data: { code: title.replace(/\s/g, "-").toUpperCase(), title, category: "Sales", description: "A course description long enough to satisfy validation rules.", priceCents, status: "PUBLISHED", ownerCoachUserId: ids.coach, certificationTemplateId: template.id, passingScore: 70 } })).id;
  ids.paidCourse = await mk("Paid Setting Course", 4900);
  ids.freeCourse = await mk("Free Intro Course", 0);
  await db.courseCoach.create({ data: { courseId: ids.paidCourse, coachUserId: ids.coach } });
  await db.courseCoach.create({ data: { courseId: ids.freeCourse, coachUserId: ids.coach } });
  ids.clientId = (await db.client.create({ data: { companyName: "Acme", status: "ACTIVE", timezone: "America/Los_Angeles" } })).id;
  await joinNew("Ana", "ana@talent.example");
  await joinNew("Ben", "ben@talent.example");
});

afterAll(async () => {
  setEmailChannelForTests(null);
  await db.$disconnect();
});

describe("sources", () => {
  it("self-enrolment sources and inheritance", async () => {
    expect(sourceForSelfEnrolment(0)).toBe("HIREWISE_DIRECT");
    expect(sourceForSelfEnrolment(4900)).toBe("INDEPENDENT_PURCHASE");
    const ben = await agent("Ben");
    await enrol(db, ben, ids.paidCourse);
    const e = await db.courseEnrollment.findFirstOrThrow({ where: { agentProfileId: people.Ben.profileId, courseId: ids.paidCourse } });
    expect(e.credentialSource).toBe("INDEPENDENT_PURCHASE");
    await recordCoursePayment(db, admin(), e.id, { waived: true, reason: "Scholarship" });
    expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: e.id } })).credentialSource).toBe("ADMIN_ASSIGNMENT");
    expect(await inheritedSource(db, ids.paidCourse, people.Ben.profileId)).toEqual({ credentialSource: "ADMIN_ASSIGNMENT", sponsoringAgencyId: null });
    expect(await inheritedSource(db, null, people.Ben.profileId)).toEqual({ credentialSource: "HIREWISE_DIRECT", sponsoringAgencyId: null });
  });
});

describe("Course Seats and assignment", () => {
  it("the owner buys seats, Hirewise records them, and assignment creates an agency-sponsored enrollment", async () => {
    const catalog = await trainingCatalog(db, await owner());
    expect(catalog.courses.map((c) => c.title).sort()).toEqual(["Free Intro Course", "Paid Setting Course"]);
    const keys = collectKeys(catalog);
    for (const k of FORBIDDEN_FOR_AGENCY) expect(keys.has(k), `forbidden key present: ${k}`).toBe(false);
    await expect(purchaseCourseSeats(db, sales(), { courseId: ids.paidCourse, seatCount: 2 })).rejects.toThrow(ForbiddenError);
    await expect(purchaseCourseSeats(db, await owner(), { courseId: ids.freeCourse, seatCount: 2 })).rejects.toThrow(/free/);
    await expect(assignCourse(db, await owner(), { courseId: ids.paidCourse, agentProfileId: people.Ana.profileId })).rejects.toThrow(/No Course Seats/);
    const p = await purchaseCourseSeats(db, await owner(), { courseId: ids.paidCourse, seatCount: 2, note: "Two setters" });
    expect(p).toMatchObject({ status: "PENDING", seatCount: 2, amountMinor: 9800 });
    await runWorkerOnce(db);
    expect(await db.task.count({ where: { type: "RECORD_COURSE_PURCHASE", relatedId: p.id, status: "OPEN" } })).toBe(1);
    await expect(recordCoursePurchase(db, sales(), p.id, { outcome: "PAID", reference: "x" })).rejects.toThrow(ForbiddenError);
    const paid = await recordCoursePurchase(db, admin(), p.id, { outcome: "PAID", reference: "GCASH-9" });
    expect(paid.status).toBe("PAID");
    expect((await trainingCatalog(db, await owner())).courses.find((c) => c.id === ids.paidCourse)).toMatchObject({ seatsBought: 2, seatsUsed: 0, seatsAvailable: 2 });
    await assignCourse(db, await owner(), { courseId: ids.paidCourse, agentProfileId: people.Ana.profileId });
    await expect(assignCourse(db, await owner(), { courseId: ids.paidCourse, agentProfileId: people.Ana.profileId })).rejects.toThrow(/already enrolled/);
    const e = await db.courseEnrollment.findFirstOrThrow({ where: { agentProfileId: people.Ana.profileId, courseId: ids.paidCourse } });
    expect(e).toMatchObject({ credentialSource: "AGENCY_SPONSORED", sponsoringAgencyId: ids.agencyA, paymentStatus: "WAIVED" });
    expect(e.courseSeatAssignmentId).toBeTruthy();
    expect((await trainingCatalog(db, await owner())).courses.find((c) => c.id === ids.paidCourse)).toMatchObject({ seatsUsed: 1, seatsAvailable: 1 });
    // Free course: no purchase needed.
    await assignCourse(db, await owner(), { courseId: ids.freeCourse, agentProfileId: people.Ana.profileId });
    expect((await db.courseEnrollment.findFirstOrThrow({ where: { agentProfileId: people.Ana.profileId, courseId: ids.freeCourse } })).credentialSource).toBe("AGENCY_SPONSORED");
    // A member of another agency cannot be assigned; a stranger cannot read.
    await expect(assignCourse(db, await resolveActor(db, ids.ownerB), { courseId: ids.freeCourse, agentProfileId: people.Ana.profileId })).rejects.toThrow(NotFoundError);
    await expect(trainingCatalog(db, await resolveActor(db, ids.ownerB), ids.agencyA)).rejects.toThrow(NotFoundError);
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: people.Ana.userId, type: "COURSE_SEAT_ASSIGNED" } })).toBe(2);
    expect((await listCoursePurchases(db, admin(), "PAID")).rows.some((x) => x.id === p.id)).toBe(true);
  });

  it("certifications and assessments inherit the sponsored source", async () => {
    const e = await db.courseEnrollment.findFirstOrThrow({ where: { agentProfileId: people.Ana.profileId, courseId: ids.paidCourse } });
    await db.courseEnrollment.update({ where: { id: e.id }, data: { status: "COMPLETED", completion: { create: { examScore: 90 } } } });
    const coach = makeActor("COACH", { userId: ids.coach, coachCourseIds: [ids.paidCourse, ids.freeCourse] });
    const r = await recordAssessment(db, coach, { courseId: ids.paidCourse, agentProfileId: people.Ana.profileId, type: "ROLEPLAY", examScore: 90, practicalScore: "", roleplayScore: 88, communicationScore: 85, comments: "", strengths: "Tone", areasForImprovement: "", resultLabelId: ids.label, certificationRecommended: true });
    expect(r.certification.issued).toBe(true);
    const cert = await db.certification.findFirstOrThrow({ where: { agentProfileId: people.Ana.profileId, courseId: ids.paidCourse } });
    expect(cert).toMatchObject({ status: "APPROVED", credentialSource: "AGENCY_SPONSORED", sponsoringAgencyId: ids.agencyA });
    const a = await db.assessment.findUniqueOrThrow({ where: { id: r.assessmentId } });
    expect(a).toMatchObject({ credentialSource: "AGENCY_SPONSORED", sponsoringAgencyId: ids.agencyA });
    const overview = await agencyTrainingOverview(db, await owner());
    const ana = overview.find((m) => m.agentProfileId === people.Ana.profileId)!;
    expect(ana.certifications[0]).toMatchObject({ active: true, source: "Sponsored by you" });
    expect(ana.courses.find((c) => c.courseId === ids.paidCourse)).toMatchObject({ status: "COMPLETED", sponsoredByYou: true, revoked: false });
  });
});

describe("exit revokes agency-sponsored items only", () => {
  it("in-progress revoked, completed kept without access, certification inactive, assessment historical, seats returned, verification recomputed", async () => {
    const before = (await db.agentProfile.findUniqueOrThrow({ where: { id: people.Ana.profileId } })).verificationLevel;
    expect(before).not.toBe("PROFILE_SUBMITTED");
    const ana = await agent("Ana");
    const r = await requestLeave(db, ana, { reason: "Starting my own thing next month" }, meta);
    const decided = await agencyDecide(db, await owner(), r.id, { decision: "APPROVE", effectiveOption: "IMMEDIATE" });
    expect(decided.status).toBe("COMPLETED");
    // The exit handler revokes and publishes CREDENTIALS_REVOKED; the second pass delivers the notifications.
    await runWorkerOnce(db);
    await runWorkerOnce(db);
    const paid = await db.courseEnrollment.findFirstOrThrow({ where: { agentProfileId: people.Ana.profileId, courseId: ids.paidCourse } });
    expect(paid.status).toBe("COMPLETED");
    expect(paid.accessRevokedAt).toBeTruthy();
    const free = await db.courseEnrollment.findFirstOrThrow({ where: { agentProfileId: people.Ana.profileId, courseId: ids.freeCourse } });
    expect(free.status).toBe("REVOKED");
    const cert = await db.certification.findFirstOrThrow({ where: { agentProfileId: people.Ana.profileId, courseId: ids.paidCourse } });
    expect(cert.status).toBe("INACTIVE_FOR_PLATFORM_USE");
    expect(cert.inactivatedAt).toBeTruthy();
    expect((await db.assessment.findFirstOrThrow({ where: { agentProfileId: people.Ana.profileId } })).status).toBe("HISTORICAL");
    expect(await db.courseSeatAssignment.count({ where: { agentProfileId: people.Ana.profileId, revokedAt: null } })).toBe(0);
    expect((await trainingCatalog(db, await owner())).courses.find((c) => c.id === ids.paidCourse)).toMatchObject({ seatsUsed: 0, seatsAvailable: 2 });
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: people.Ana.profileId } })).verificationLevel).toBe("PROFILE_SUBMITTED");
    expect(await db.auditLog.count({ where: { action: "CREDENTIALS_REVOKED_ON_EXIT", entityId: people.Ana.profileId } })).toBe(1);
    expect(await db.notification.count({ where: { userId: people.Ana.userId, type: "CREDENTIALS_REVOKED" } })).toBe(1);
    // Ben's independent and admin-assigned items are untouched.
    expect((await db.courseEnrollment.findFirstOrThrow({ where: { agentProfileId: people.Ben.profileId, courseId: ids.paidCourse } })).accessRevokedAt).toBeNull();
    // Running the revocation again is a no-op.
    expect(await revokeAgencySponsoredOnExit(db, { agencyId: ids.agencyA, agencyName: "Agency A", agentProfileId: people.Ana.profileId, agentUserId: people.Ana.userId, ownerUserId: ids.ownerUser, displayName: "Ana", membershipId: "x", reason: "again" })).toEqual({ enrollments: 0, certifications: 0, assessments: 0, seatsReturned: 0 });
  });

  it("inactive and historical items never satisfy eligibility or reach clients; revoked courses are refused", async () => {
    const record = await agentRepository.findSelf(db, people.Ana.profileId);
    const view = toCandidateClientView(record!);
    expect(view.certifications).toHaveLength(0);
    expect(view.assessment).toBeNull();
    const keys = collectKeys(view);
    for (const k of FORBIDDEN_FOR_CLIENT) expect(keys.has(k), `forbidden key present: ${k}`).toBe(false);
    const ana = await agent("Ana");
    const page = await getEnrollmentForAgent(db, ana, ids.freeCourse);
    expect(page.locked).toMatchObject({ kind: "REVOKED" });
    const lesson = await db.courseLesson.create({ data: { title: "L1", contentType: "TEXT", order: 1, status: "PUBLISHED", module: { create: { courseId: ids.freeCourse, title: "M1", order: 1, status: "PUBLISHED" } } }, include: { module: true } });
    await expect(assertLessonUnlocked(db, { id: lesson.id, module: { courseId: ids.freeCourse } }, people.Ana.profileId)).rejects.toThrow(ForbiddenError);
  });
});

describe("independent reapplication", () => {
  it("a former agent applies with the terms re-accepted and starts a fresh profile with no inherited credentials", async () => {
    const ana = await agent("Ana");
    const e = await independentEligibility(db, ana);
    expect(e).toMatchObject({ eligible: true, feeMinor: 0 });
    await expect(independentEligibility(db, await agent("Ben"))).resolves.toMatchObject({ eligible: false });
    await expect(applyIndependent(db, ana, { termsAccepted: false }, meta)).rejects.toMatchObject({ field: "termsAccepted" });
    const r = await applyIndependent(db, ana, { termsAccepted: true }, meta);
    expect(r.status).toBe("ACTIVE");
    const fresh = await db.agentProfile.findUniqueOrThrow({ where: { id: r.profileId! }, include: { certifications: true, enrollments: true, assessments: true } });
    expect(fresh).toMatchObject({ userId: people.Ana.userId, talentType: "INDEPENDENT_FREELANCER", status: "DRAFT" });
    expect(fresh.certifications).toHaveLength(0);
    expect(fresh.enrollments).toHaveLength(0);
    expect(fresh.assessments).toHaveLength(0);
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: people.Ana.profileId } })).status).toBe("ARCHIVED");
    expect(await db.agreementAcceptance.count({ where: { userId: people.Ana.userId, context: "INDEPENDENT_REAPPLICATION" } })).toBe(2);
    expect((await resolveActor(db, people.Ana.userId)).agentProfileId).toBe(fresh.id);
    await expect(independentEligibility(db, await resolveActor(db, people.Ana.userId))).resolves.toMatchObject({ eligible: false, reason: expect.stringMatching(/already have an independent profile/) });
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: people.Ana.userId, type: "INDEPENDENT_ACTIVATED" } })).toBe(1);
  });

  it("with a fee, the profile waits for Hirewise to record the payment; an independent may still join an agency", async () => {
    await setSetting(db, superAdmin(), "independentAccess", { enabled: true, feeMinor: 2500, currency: "USD" });
    // Ben leaves Agency A, then applies.
    const ben = await agent("Ben");
    const r = await requestLeave(db, ben, { reason: "Going solo after this campaign" }, meta);
    await agencyDecide(db, await owner(), r.id, { decision: "APPROVE", effectiveOption: "IMMEDIATE" });
    const benAfter = await resolveActor(db, people.Ben.userId);
    const applied = await applyIndependent(db, benAfter, { termsAccepted: true }, meta);
    expect(applied.status).toBe("PENDING_PAYMENT");
    expect((await independentEligibility(db, benAfter)).pending?.amountLabel).toBe("$25.00");
    await runWorkerOnce(db);
    const access = (await listIndependentAccess(db, admin(), "PENDING_PAYMENT")).rows.find((x) => x.userId === people.Ben.userId)!;
    expect(await db.task.count({ where: { type: "RECORD_INDEPENDENT_ACCESS", relatedId: access.id, status: "OPEN" } })).toBe(1);
    await expect(recordIndependentAccess(db, sales(), access.id, { outcome: "WAIVED" })).rejects.toThrow(ForbiddenError);
    const done = await recordIndependentAccess(db, admin(), access.id, { outcome: "WAIVED", note: "Pilot" });
    expect(done.status).toBe("ACTIVE");
    const fresh = await db.agentProfile.findFirstOrThrow({ where: { userId: people.Ben.userId, archivedAt: null } });
    expect(fresh.talentType).toBe("INDEPENDENT_FREELANCER");
    // The independent freelancer joins Agency B: fresh agency profile again (decision 7).
    const linkB = (await inviteLinkForAgency(db, await resolveActor(db, ids.ownerB))).url.split("/join/")[1];
    const member = await joinAsExistingUser(db, await resolveActor(db, people.Ben.userId), linkB, meta);
    expect(member.agentProfileId).not.toBe(fresh.id);
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("ARCHIVED");
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: member.agentProfileId } })).talentType).toBe("AGENCY_AGENT");
    await setSetting(db, superAdmin(), "independentAccess", { enabled: true, feeMinor: 0, currency: "USD" });
    // Direct talent with an active profile cannot apply.
    resetRateLimits();
    const direct = await registerAgent(db, talent({ email: "direct@talent.example" }), meta);
    await expect(independentEligibility(db, await resolveActor(db, direct.userId))).resolves.toMatchObject({ eligible: false });
  });
});
