import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { seedTerms } from "../setup/terms";
import { createAgencyDirect } from "@/server/services/agency.service";
import { inviteLinkForAgency, registerViaInvite } from "@/server/services/invite.service";
import { registerAgent, updateSkills, getOwnProfile } from "@/server/services/agent.service";
import { createRequirement } from "@/server/services/requirement.service";
import { publishOpportunity, listOpportunitiesForAgency, getOpportunityForClient, getOpportunityForStaff, submitAgent } from "@/server/services/opportunity.service";
import { saveSkillTag, listSkillTags, setCourseSkillTags, courseSkillTags, savePathway, requestSkillTag, myTagRequests, listTagRequests, decideTagRequest, setOpportunityRequirements, unmetRequirements, slugify, hashtagFor } from "@/server/services/skills.service";
import { recomputeSkillVerification, evaluateTag } from "@/server/services/skill-verification.service";
import { revokeAgencySponsoredOnExit } from "@/server/services/credential.service";
import { saveTemplate, issueCertification, revokeCertification } from "@/server/services/certification.service";
import { matchCandidates } from "@/server/services/match.service";
import { searchCandidates, getCandidateForClient } from "@/server/services/search.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { FORBIDDEN_FOR_CLIENT, collectKeys } from "@/server/views/forbidden-keys";
import { runWorkerOnce, runMaintenance } from "@/server/jobs/worker";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";

const db = testDb();
async function drain() {
  for (let i = 0; i < 10; i++) if (!(await runWorkerOnce(db)).events) break;
}
const meta = { ipAddress: "198.51.100.17", userAgent: "vitest" };
const PASSWORD = "Str0ngPassw0rd!";
const ids = { super: "su_sk", admin: "admin_sk", sales: "sales_sk", coach: "coach_sk", coach2: "coach2_sk", ownerA: "", agencyA: "", linkA: "", maria: "", mariaUser: "", leo: "", leoUser: "", clientA: "", userA: "", requirementId: "", opportunityId: "", template: "", courseExam: "", courseNoExam: "", coursePath1: "", coursePath2: "", tagCold: "", tagCrm: "", tagLead: "", tagPath: "", tagAny: "", pathway: "", requestId: "" };

const talent = (over: Record<string, unknown> = {}) => ({ termsAccepted: true, fullName: "Test Talent", displayName: "Test T.", email: "t@talent.example", password: PASSWORD, phone: "", locationCity: "Cebu", locationCountry: "Philippines", timezone: "Asia/Manila", primaryRole: "Cold Caller", yearsExperience: 3, ...over });
const superAdmin = () => makeActor("SUPER_ADMIN", { userId: ids.super });
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const coach = () => makeActor("COACH", { userId: ids.coach, coachCourseIds: [ids.courseExam, ids.courseNoExam, ids.coursePath1, ids.coursePath2] });
const coach2 = () => makeActor("COACH", { userId: ids.coach2, coachCourseIds: [] });
const ownerA = () => resolveActor(db, ids.ownerA);
const maria = () => makeActor("AGENT", { userId: ids.mariaUser, agentProfileId: ids.maria });
const leo = () => makeActor("AGENT", { userId: ids.leoUser, agentProfileId: ids.leo });
const clientA = () => makeActor("CLIENT", { userId: ids.userA, clientId: ids.clientA });

async function complete(agentProfileId: string, courseId: string, examScore: number | null, sponsoringAgencyId: string | null = null) {
  const e = await db.courseEnrollment.upsert({ where: { courseId_agentProfileId: { courseId, agentProfileId } }, create: { courseId, agentProfileId, status: "COMPLETED", credentialSource: sponsoringAgencyId ? "AGENCY_SPONSORED" : "HIREWISE_DIRECT", sponsoringAgencyId }, update: { status: "COMPLETED", accessRevokedAt: null } });
  await db.courseCompletion.upsert({ where: { enrollmentId: e.id }, create: { enrollmentId: e.id, examScore }, update: { examScore } });
  return recomputeSkillVerification(db, agentProfileId);
}
const verifiedOf = async (agentProfileId: string) => new Map((await db.agentSkill.findMany({ where: { agentProfileId } })).map((s) => [s.skillId, s.verifiedAt]));

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16";
  process.env.APP_URL = "http://localhost:3000";
  await resetDb(db);
  resetRateLimits();
  setEmailChannelForTests(new ConsoleEmailChannel());
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  await seedTerms(db);
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.user.create({ data: { id: ids.super, email: "owner@hirewise.example", roleId: await role("SUPER_ADMIN"), emailVerifiedAt: new Date() } });
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN"), emailVerifiedAt: new Date() } });
  await db.user.create({ data: { id: ids.sales, email: "sales@hirewise.example", roleId: await role("SALES"), emailVerifiedAt: new Date() } });
  await db.user.create({ data: { id: ids.coach, email: "coach@hirewise.example", roleId: await role("COACH"), emailVerifiedAt: new Date() } });
  await db.user.create({ data: { id: ids.coach2, email: "coach2@hirewise.example", roleId: await role("COACH"), emailVerifiedAt: new Date() } });
  await db.plan.createMany({ data: [{ id: "plan_starter", key: "STARTER", name: "Starter", baseAgentSeats: 5, sortOrder: 1 }] });
  ids.ownerA = (await db.user.create({ data: { email: "dana@villanueva-teams.example", roleId: await role("APPLICANT"), emailVerifiedAt: new Date() } })).id;
  ids.agencyA = await createAgencyDirect(db, superAdmin(), { ownerEmail: "dana@villanueva-teams.example", name: "Villanueva Virtual Teams", country: "Philippines", reason: "skills tests", planKey: "STARTER" });
  ids.linkA = (await inviteLinkForAgency(db, await ownerA())).url.split("/join/")[1];

  // Taxonomy (as the foundation seed writes it).
  const mkTag = async (name: string, category: string) => (await db.skill.create({ data: { name, category, slug: slugify(name), hashtag: hashtagFor(name) } })).id;
  ids.tagCold = await mkTag("Cold Calling", "Sales");
  ids.tagCrm = await mkTag("CRM Management", "Sales");
  ids.tagLead = await mkTag("Lead Generation", "Sales");
  ids.tagPath = await mkTag("Inside Sales", "Sales");
  ids.tagAny = await mkTag("Objection Handling", "Sales");
  await db.software.create({ data: { name: "HubSpot", category: "CRM" } });

  // Courses: one with a final exam, one without, two for a pathway.
  const mkCourse = async (title: string) => (await db.academyCourse.create({ data: { code: title.replace(/\s/g, "-").toUpperCase(), title, category: "Sales", description: "A course description long enough to satisfy validation rules.", status: "PUBLISHED", ownerCoachUserId: ids.coach } })).id;
  ids.courseExam = await mkCourse("Cold Calling Mastery");
  ids.courseNoExam = await mkCourse("CRM Basics");
  ids.coursePath1 = await mkCourse("Inside Sales 1");
  ids.coursePath2 = await mkCourse("Inside Sales 2");
  for (const c of [ids.courseExam, ids.courseNoExam, ids.coursePath1, ids.coursePath2]) await db.courseCoach.create({ data: { courseId: c, coachUserId: ids.coach } });
  await db.exam.create({ data: { courseId: ids.courseExam, title: "Final", status: "PUBLISHED" } });
  ids.template = (await db.certificationTemplate.create({ data: { name: "Hirewise Certified Cold Caller" } })).id;

  // Maria: agency member. Leo: Hirewise Direct.
  resetRateLimits();
  const m = await registerViaInvite(db, talent({ email: "maria@talent.example", fullName: "Maria Santos Cruz", displayName: "Maria" }), ids.linkA, meta);
  ids.maria = m.agentProfileId;
  ids.mariaUser = m.userId;
  await db.user.update({ where: { id: m.userId }, data: { emailVerifiedAt: new Date() } });
  await db.agencyMembership.updateMany({ where: { agentProfileId: ids.maria, status: "PENDING_VERIFICATION" }, data: { status: "ACTIVE" } });
  await db.agentProfile.update({ where: { id: ids.maria }, data: { status: "APPROVED", approvedAt: new Date(), availabilityStatus: "AVAILABLE", languages: ["English"], clientLabel: "Maria S." } });
  resetRateLimits();
  const l = await registerAgent(db, talent({ email: "leo@talent.example", fullName: "Leo Dela Cruz", displayName: "Leo D." }), meta);
  ids.leo = l.agentProfileId;
  ids.leoUser = l.userId;
  await db.user.update({ where: { id: l.userId }, data: { emailVerifiedAt: new Date() } });
  await db.agentProfile.update({ where: { id: ids.leo }, data: { status: "APPROVED", approvedAt: new Date(), availabilityStatus: "AVAILABLE", languages: ["English"], clientLabel: "Leo D." } });
  for (const agentProfileId of [ids.maria, ids.leo]) await db.certification.create({ data: { agentProfileId, templateId: ids.template, origin: "ADMIN_ISSUED", status: "APPROVED" } });

  const uA = await db.user.create({ data: { email: "jordan@acme-solar.example", roleId: await role("CLIENT"), emailVerifiedAt: new Date() } });
  ids.userA = uA.id;
  ids.clientA = (await db.client.create({ data: { companyName: "Acme Solar", industry: "Solar", country: "United States", status: "ACTIVE", timezone: "America/Los_Angeles", accountManagerUserId: ids.sales, contacts: { create: { userId: uA.id, name: "Jordan", businessEmail: uA.email, isPrimary: true } } } })).id;
  ids.requirementId = await createRequirement(db, clientA(), { title: "Solar cold callers", role: "Cold Caller", agentsRequired: 2, skills: ["Cold Calling", "CRM Management"], software: [], jobDescription: "Outbound calls for US solar installers; Acme Solar scripts." });
});

afterAll(async () => {
  setEmailChannelForTests(null);
  await db.$disconnect();
});

describe("tags (curated by Hirewise)", () => {
  it("derives slug and hashtag, rejects duplicates, and only skills.manage may write", async () => {
    expect(slugify("Cold Calling")).toBe("cold-calling");
    expect(hashtagFor("Cold  Calling")).toBe("#ColdCalling");
    const t = await saveSkillTag(db, admin(), { name: "Appointment Setting", category: "Sales" });
    expect(t.slug).toBe("appointment-setting");
    expect(t.hashtag).toBe("#AppointmentSetting");
    expect(t.verificationMode).toBe("NONE");
    await expect(saveSkillTag(db, admin(), { name: "appointment setting", category: "Sales" })).rejects.toThrow(/already exists/);
    await expect(saveSkillTag(db, admin(), { name: "Broken", category: "Sales", verificationMode: "REQUIRED_COURSE" })).rejects.toThrow(/required course/);
    for (const actor of [sales(), coach(), maria(), clientA(), await ownerA()]) await expect(saveSkillTag(db, actor, { name: "Nope", category: "Sales" })).rejects.toThrow(ForbiddenError);
    await expect(listSkillTags(db, clientA())).rejects.toThrow(ForbiddenError);
    expect((await listSkillTags(db, admin(), true)).some((x) => x.id === t.id)).toBe(true);
  });

  it("configures verification per tag: required course, pathway, any mapped course", async () => {
    const cold = await saveSkillTag(db, admin(), { id: ids.tagCold, name: "Cold Calling", category: "Sales", verificationMode: "REQUIRED_COURSE", requiredCourseId: ids.courseExam, minAssessmentScore: 80 });
    expect(cold.requiredCourse?.id).toBe(ids.courseExam);
    const crm = await saveSkillTag(db, admin(), { id: ids.tagCrm, name: "CRM Management", category: "Sales", verificationMode: "REQUIRED_COURSE", requiredCourseId: ids.courseNoExam });
    expect(crm.verificationMode).toBe("REQUIRED_COURSE");
    const p = await savePathway(db, admin(), { title: "Inside Sales Pathway", courses: [{ courseId: ids.coursePath1, isRequired: true }, { courseId: ids.coursePath2, isRequired: true }] });
    ids.pathway = p.id;
    expect(p.slug).toBe("inside-sales-pathway");
    expect(p.courses.map((c) => c.sortOrder)).toEqual([0, 1]);
    await expect(savePathway(db, coach(), { title: "x pathway", courses: [] })).rejects.toThrow(ForbiddenError);
    await saveSkillTag(db, admin(), { id: ids.tagPath, name: "Inside Sales", category: "Sales", verificationMode: "PATHWAY", requiredPathwayId: p.id });
    await saveSkillTag(db, admin(), { id: ids.tagAny, name: "Objection Handling", category: "Sales", verificationMode: "ANY_COURSE" });
    // Course mapping is the coach's (course ownership), not skills.manage.
    await expect(setCourseSkillTags(db, coach2(), ids.courseExam, [ids.tagAny])).rejects.toThrow(NotFoundError);
    await expect(setCourseSkillTags(db, maria(), ids.courseExam, [ids.tagAny])).rejects.toThrow(ForbiddenError);
    await expect(setCourseSkillTags(db, coach(), "nope", [ids.tagAny])).rejects.toThrow(NotFoundError);
    expect(await setCourseSkillTags(db, coach(), ids.courseNoExam, [ids.tagAny, ids.tagAny, "not-a-tag"])).toEqual([ids.tagAny]);
    expect((await courseSkillTags(db, coach(), ids.courseNoExam)).map((t) => t.id)).toEqual([ids.tagAny]);
  });
});

describe("declared tags (talent)", () => {
  it("talent picks at least three curated tags; unknown ids are dropped; verification is never part of the input", async () => {
    await expect(updateSkills(db, maria(), { skills: [ids.tagCold, ids.tagCrm], software: [] })).rejects.toThrow();
    await updateSkills(db, maria(), { skills: [ids.tagCold, ids.tagCrm, ids.tagLead, "not-a-skill"], software: [] });
    await updateSkills(db, leo(), { skills: [ids.tagCold, ids.tagCrm, ids.tagPath, ids.tagAny], software: [] });
    const mine = await getOwnProfile(db, maria());
    expect(mine.skills.map((s) => s.skillId).sort()).toEqual([ids.tagCold, ids.tagCrm, ids.tagLead].sort());
    expect(mine.skills.every((s) => s.verified === false && s.verifiedAt === null)).toBe(true);
    expect(mine.skills.find((s) => s.skillId === ids.tagCold)?.hashtag).toBe("#ColdCalling");
    expect(mine.skills.find((s) => s.skillId === ids.tagCold)?.verifiable).toBe(true);
    expect(mine.skills.find((s) => s.skillId === ids.tagLead)?.verifiable).toBe(false);
  });
});

describe("Verified by Hirewise (derived, never set by hand)", () => {
  it("evaluateTag applies the score threshold only when the course has an exam", () => {
    const tag = { verificationMode: "REQUIRED_COURSE", requiredCourseId: "c1", minAssessmentScore: 80, courses: [], requiredPathway: null };
    expect(evaluateTag(tag, new Map([["c1", { courseId: "c1", score: 79, hasExam: true }]])).verified).toBe(false);
    expect(evaluateTag(tag, new Map([["c1", { courseId: "c1", score: 80, hasExam: true }]])).verified).toBe(true);
    expect(evaluateTag(tag, new Map([["c1", { courseId: "c1", score: null, hasExam: false }]])).verified).toBe(true);
    expect(evaluateTag({ ...tag, verificationMode: "NONE" }, new Map([["c1", { courseId: "c1", score: 100, hasExam: true }]])).verified).toBe(false);
    expect(evaluateTag({ ...tag, verificationMode: "PATHWAY", requiredPathway: { courses: [] } }, new Map()).verified).toBe(false);
  });

  it("a required course with an exam verifies only at or above the tag's minimum score", async () => {
    expect(await complete(ids.leo, ids.courseExam, 70)).toEqual({ verified: 0, cleared: 0 });
    expect((await verifiedOf(ids.leo)).get(ids.tagCold)).toBeNull();
    expect(await complete(ids.leo, ids.courseExam, 85)).toEqual({ verified: 1, cleared: 0 });
    const row = await db.agentSkill.findUniqueOrThrow({ where: { agentProfileId_skillId: { agentProfileId: ids.leo, skillId: ids.tagCold } } });
    expect(row.verifiedAt).not.toBeNull();
    expect(row.verifiedVia).toBe(ids.courseExam);
    // A later recompute keeps the original date.
    expect(await recomputeSkillVerification(db, ids.leo)).toEqual({ verified: 0, cleared: 0 });
    expect((await db.agentSkill.findUniqueOrThrow({ where: { agentProfileId_skillId: { agentProfileId: ids.leo, skillId: ids.tagCold } } })).verifiedAt?.getTime()).toBe(row.verifiedAt?.getTime());
  });

  it("a course without an exam verifies on completion, and ANY_COURSE follows the course mapping", async () => {
    expect(await complete(ids.leo, ids.courseNoExam, null)).toEqual({ verified: 2, cleared: 0 });
    const v = await verifiedOf(ids.leo);
    expect(v.get(ids.tagCrm)).not.toBeNull();
    expect(v.get(ids.tagAny)).not.toBeNull();
    // Unmapping the course clears the ANY_COURSE badge for everyone who passed it.
    await setCourseSkillTags(db, coach(), ids.courseNoExam, []);
    expect((await verifiedOf(ids.leo)).get(ids.tagAny)).toBeNull();
    await setCourseSkillTags(db, coach(), ids.courseNoExam, [ids.tagAny]);
    expect((await verifiedOf(ids.leo)).get(ids.tagAny)).not.toBeNull();
  });

  it("a pathway needs every required course", async () => {
    expect(await complete(ids.leo, ids.coursePath1, null)).toEqual({ verified: 0, cleared: 0 });
    expect(await complete(ids.leo, ids.coursePath2, null)).toEqual({ verified: 1, cleared: 0 });
    expect((await db.agentSkill.findUniqueOrThrow({ where: { agentProfileId_skillId: { agentProfileId: ids.leo, skillId: ids.tagPath } } })).verifiedVia).toBe("pathway:2");
    // Making course 2 optional keeps it verified; a new required course clears it.
    await savePathway(db, admin(), { id: ids.pathway, title: "Inside Sales Pathway", courses: [{ courseId: ids.coursePath1, isRequired: true }, { courseId: ids.coursePath2, isRequired: false }, { courseId: ids.courseExam, isRequired: true }] });
    expect((await verifiedOf(ids.leo)).get(ids.tagPath)).not.toBeNull(); // courseExam passed at 85
    await savePathway(db, admin(), { id: ids.pathway, title: "Inside Sales Pathway", courses: [{ courseId: ids.coursePath1, isRequired: true }, { courseId: ids.coursePath2, isRequired: true }, { courseId: ids.courseNoExam, isRequired: true }] });
    expect((await verifiedOf(ids.leo)).get(ids.tagPath)).not.toBeNull(); // all three passed
  });

  it("raising a tag's threshold or revoking course access clears the badge; re-declaring keeps a surviving one", async () => {
    await saveSkillTag(db, admin(), { id: ids.tagCold, name: "Cold Calling", category: "Sales", verificationMode: "REQUIRED_COURSE", requiredCourseId: ids.courseExam, minAssessmentScore: 90 });
    expect((await verifiedOf(ids.leo)).get(ids.tagCold)).toBeNull();
    await saveSkillTag(db, admin(), { id: ids.tagCold, name: "Cold Calling", category: "Sales", verificationMode: "REQUIRED_COURSE", requiredCourseId: ids.courseExam, minAssessmentScore: 80 });
    expect((await verifiedOf(ids.leo)).get(ids.tagCold)).not.toBeNull();
    await updateSkills(db, leo(), { skills: [ids.tagCold, ids.tagCrm, ids.tagPath, ids.tagAny, ids.tagLead], software: [] });
    expect((await verifiedOf(ids.leo)).get(ids.tagCold)).not.toBeNull();
    await db.courseEnrollment.update({ where: { courseId_agentProfileId: { courseId: ids.courseExam, agentProfileId: ids.leo } }, data: { accessRevokedAt: new Date(), status: "REVOKED" } });
    expect(await recomputeSkillVerification(db, ids.leo)).toEqual({ verified: 0, cleared: 1 });
    await db.courseEnrollment.update({ where: { courseId_agentProfileId: { courseId: ids.courseExam, agentProfileId: ids.leo } }, data: { accessRevokedAt: null, status: "COMPLETED" } });
    expect(await recomputeSkillVerification(db, ids.leo)).toEqual({ verified: 1, cleared: 0 });
  });

  it("an agency exit revokes sponsored completions and clears the badges they earned", async () => {
    expect(await complete(ids.maria, ids.courseExam, 95, ids.agencyA)).toEqual({ verified: 1, cleared: 0 });
    const r = await revokeAgencySponsoredOnExit(db, { agencyId: ids.agencyA, agencyName: "Villanueva Virtual Teams", agentProfileId: ids.maria, agentUserId: ids.mariaUser, ownerUserId: ids.ownerA, displayName: "Maria", membershipId: "m", reason: "left the agency" });
    expect(r.enrollments).toBe(1);
    expect((await verifiedOf(ids.maria)).get(ids.tagCold)).toBeNull();
    await runMaintenance(db);
    expect((await verifiedOf(ids.maria)).get(ids.tagCold)).toBeNull(); // revoked completions never count again
  });

  it("a revoked or expired certification that validates the tag clears the badge until a new one is approved (decision 2)", async () => {
    await expect(saveTemplate(db, sales(), { name: "Cold Calling Specialist", requiresCompletion: true, requiresCoachReview: false, isActive: true, skillId: ids.tagCold })).rejects.toThrow(ForbiddenError);
    await saveTemplate(db, admin(), { name: "Cold Calling Specialist", requiresCompletion: true, requiresCoachReview: false, isActive: true, skillId: ids.tagCold });
    const linked = await db.certificationTemplate.findFirstOrThrow({ where: { name: "Cold Calling Specialist" } });
    expect(linked.skillId).toBe(ids.tagCold);
    expect((await verifiedOf(ids.leo)).get(ids.tagCold)).not.toBeNull();
    await issueCertification(db, admin(), { agentProfileId: ids.leo, templateId: linked.id, reason: "Passed the specialist review" });
    expect((await verifiedOf(ids.leo)).get(ids.tagCold)).not.toBeNull();
    const cert = await db.certification.findFirstOrThrow({ where: { agentProfileId: ids.leo, templateId: linked.id } });
    await revokeCertification(db, admin(), cert.id, "Misconduct on a client call");
    expect((await verifiedOf(ids.leo)).get(ids.tagCold)).toBeNull();
    expect(await recomputeSkillVerification(db, ids.leo)).toEqual({ verified: 0, cleared: 0 });
    await issueCertification(db, admin(), { agentProfileId: ids.leo, templateId: linked.id, reason: "Re-certified after retraining" });
    expect((await verifiedOf(ids.leo)).get(ids.tagCold)).not.toBeNull();
  });

  it("the worker's maintenance pass recomputes every holder of a verifiable tag", async () => {
    await db.agentSkill.update({ where: { agentProfileId_skillId: { agentProfileId: ids.leo, skillId: ids.tagLead } }, data: { verifiedAt: new Date(), verifiedVia: "tampered" } });
    await runMaintenance(db);
    expect((await verifiedOf(ids.leo)).get(ids.tagLead)).toBeNull();
  });
});

describe("tag requests", () => {
  it("talent requests, Hirewise approves (creating the tag and adding it to the requester), merges, or rejects with a note", async () => {
    await expect(requestSkillTag(db, clientA(), "Medical billing")).rejects.toThrow(ForbiddenError);
    await expect(requestSkillTag(db, maria(), "#cold calling")).rejects.toThrow(/already exists/);
    const r = await requestSkillTag(db, maria(), "Medical billing");
    ids.requestId = r.id;
    expect(r.status).toBe("OPEN");
    await drain();
    expect(await db.notification.count({ where: { userId: ids.admin, type: "SKILL_TAG_REQUESTED" } })).toBe(1);
    await expect(decideTagRequest(db, maria(), { requestId: r.id, decision: "APPROVE" })).rejects.toThrow(ForbiddenError);
    await expect(listTagRequests(db, coach())).rejects.toThrow(ForbiddenError);
    await expect(decideTagRequest(db, admin(), { requestId: r.id, decision: "REJECT" })).rejects.toThrow(/note/);
    const approved = await decideTagRequest(db, admin(), { requestId: r.id, decision: "APPROVE", category: "Healthcare" });
    expect(approved.status).toBe("APPROVED");
    expect(approved.createdSkill?.name).toBe("Medical Billing");
    expect((await db.skill.findUniqueOrThrow({ where: { id: approved.createdSkill!.id } })).hashtag).toBe("#MedicalBilling");
    expect(await db.agentSkill.count({ where: { agentProfileId: ids.maria, skillId: approved.createdSkill!.id } })).toBe(1);
    await expect(decideTagRequest(db, admin(), { requestId: r.id, decision: "APPROVE" })).rejects.toThrow(/already decided/);
    const r2 = await requestSkillTag(db, maria(), "Cold calls");
    const merged = await decideTagRequest(db, admin(), { requestId: r2.id, decision: "MERGE", mergeIntoSkillId: ids.tagCold });
    expect(merged.status).toBe("MERGED");
    expect(merged.mergedInto?.id).toBe(ids.tagCold);
    const r3 = await requestSkillTag(db, maria(), "Being awesome");
    expect((await decideTagRequest(db, admin(), { requestId: r3.id, decision: "REJECT", note: "Not a job skill" })).status).toBe("REJECTED");
    await drain();
    expect(await db.notification.count({ where: { userId: ids.mariaUser, type: "SKILL_TAG_REQUEST_DECIDED" } })).toBe(3);
    expect((await myTagRequests(db, maria())).map((x) => x.status).sort()).toEqual(["APPROVED", "MERGED", "REJECTED"]);
    expect((await listTagRequests(db, admin(), "OPEN")).length).toBe(0);
  });
});

describe("opportunity requirements (hard rules)", () => {
  it("publishing seeds DECLARED requirements from the client's skills; staff raise one to VERIFIED", async () => {
    const o = await publishOpportunity(db, sales(), { requirementId: ids.requirementId, roleSummary: "Outbound solar calls." });
    ids.opportunityId = o.id;
    const staff = await getOpportunityForStaff(db, sales(), o.id);
    expect(staff.requirements.map((r) => `${r.skill?.hashtag}:${r.requiredLevel}`).sort()).toEqual(["#CRMManagement:DECLARED", "#ColdCalling:DECLARED"]);
    await expect(setOpportunityRequirements(db, await ownerA(), { opportunityId: o.id, items: [] })).rejects.toThrow(ForbiddenError);
    await expect(setOpportunityRequirements(db, clientA(), { opportunityId: o.id, items: [] })).rejects.toThrow(ForbiddenError);
    const saved = await setOpportunityRequirements(db, sales(), { opportunityId: o.id, items: [{ skillId: ids.tagCold, requiredLevel: "VERIFIED" }, { skillId: ids.tagCrm, requiredLevel: "DECLARED" }, { certificationTemplateId: ids.template, requiredLevel: "CERTIFIED" }, { skillId: "", requiredLevel: "DECLARED" }] });
    expect(saved.length).toBe(3);
    expect(saved.find((r) => r.requiredLevel === "CERTIFIED")?.certification?.name).toBe("Hirewise Certified Cold Caller");
  });

  it("agencies see which members miss a requirement and cannot submit them; clients see requirements without leaks", async () => {
    expect(await unmetRequirements(db, ids.maria, ids.opportunityId)).toEqual(["#ColdCalling not verified"]);
    expect(await unmetRequirements(db, ids.leo, ids.opportunityId)).toEqual([]);
    const list = await listOpportunitiesForAgency(db, await ownerA());
    const opp = list.opportunities.find((x) => x.id === ids.opportunityId)!;
    expect(opp.requirements.map((r) => r.label).sort()).toEqual(["#CRMManagement (declared)", "#ColdCalling (verified)", "Hirewise Certified Cold Caller (certified)"]);
    expect(list.unmet[ids.opportunityId][ids.maria]).toEqual(["#ColdCalling not verified"]);
    await expect(submitAgent(db, await ownerA(), { opportunityId: ids.opportunityId, agentProfileId: ids.maria })).rejects.toThrow(/Requirements not met: #ColdCalling not verified/);
    // Maria passes the required course: the badge is derived and the submission goes through.
    expect(await complete(ids.maria, ids.courseExam, 90)).toEqual({ verified: 1, cleared: 0 });
    expect((await listOpportunitiesForAgency(db, await ownerA())).unmet[ids.opportunityId][ids.maria]).toEqual([]);
    expect((await submitAgent(db, await ownerA(), { opportunityId: ids.opportunityId, agentProfileId: ids.maria })).status).toBe("PENDING_REVIEW");
    const client = await getOpportunityForClient(db, clientA(), ids.opportunityId);
    expect(client.opportunity.requirements.length).toBe(3);
    const found = collectKeys(client);
    for (const k of FORBIDDEN_FOR_CLIENT) expect(found.has(k), `client opportunity has ${k}`).toBe(false);
    expect(JSON.stringify(client).includes("verifiedVia")).toBe(false);
  });
});

describe("search and client views", () => {
  it("clients filter to verified skills only and see the badge without the verification source", async () => {
    const all = await searchCandidates(db, clientA(), { skills: [ids.tagCold] });
    expect(all.cards.map((r) => r.id).sort()).toEqual([ids.leo, ids.maria].sort());
    await db.agentSkill.update({ where: { agentProfileId_skillId: { agentProfileId: ids.maria, skillId: ids.tagCrm } }, data: { verifiedAt: null } });
    const verified = await searchCandidates(db, clientA(), { skills: [ids.tagCrm], verifiedOnly: true });
    expect(verified.cards.map((r) => r.id)).toEqual([ids.leo]);
    const card = verified.cards[0];
    expect(card.verifiedSkillCount).toBeGreaterThan(0);
    expect(card.skills.find((s) => s.name === "CRM Management")?.verified).toBe(true);
    const { candidate: detail } = await getCandidateForClient(db, clientA(), ids.leo);
    const cold = detail.skills.find((s) => s.name === "Cold Calling")!;
    expect(cold.hashtag).toBe("#ColdCalling");
    expect(cold.verified).toBe(true);
    expect(JSON.stringify(detail).includes("verifiedVia")).toBe(false);
    expect(JSON.stringify(detail).includes("verifiedAt")).toBe(false);
  });
});

describe("matching", () => {
  it("VERIFIED requirements of the published opportunity are hard rules in matching; DECLARED stays a soft score", async () => {
    await setOpportunityRequirements(db, sales(), { opportunityId: ids.opportunityId, items: [{ skillId: ids.tagCrm, requiredLevel: "VERIFIED" }, { skillId: ids.tagCold, requiredLevel: "DECLARED" }] });
    expect((await verifiedOf(ids.maria)).get(ids.tagCrm)).toBeNull();
    expect((await verifiedOf(ids.leo)).get(ids.tagCrm)).not.toBeNull();
    const m = await matchCandidates(db, admin(), ids.requirementId);
    const ids_ = m.matches.map((x) => x.candidate.id);
    expect(ids_).toContain(ids.leo);
    expect(ids_).not.toContain(ids.maria);
    expect(m.nearMisses.map((x) => x.candidate.id)).not.toContain(ids.maria); // not a role or availability miss
    await setOpportunityRequirements(db, sales(), { opportunityId: ids.opportunityId, items: [{ skillId: ids.tagCrm, requiredLevel: "DECLARED" }, { skillId: ids.tagCold, requiredLevel: "DECLARED" }] });
    expect((await matchCandidates(db, admin(), ids.requirementId)).matches.map((x) => x.candidate.id).sort()).toEqual([ids.leo, ids.maria].sort());
  });
});
