import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { seedTerms } from "../setup/terms";
import { createAgencyDirect } from "@/server/services/agency.service";
import { inviteLinkForAgency, registerViaInvite } from "@/server/services/invite.service";
import { registerAgent } from "@/server/services/agent.service";
import { createRequirement } from "@/server/services/requirement.service";
import { publishOpportunity, closeOpportunity, listOpportunitiesForStaff, listOpportunitiesForAgency, listOpportunitiesForAgent, listOpportunitiesForClient, getOpportunityForClient, submitAgent, reviewSubmission, withdrawSubmission, withdrawSubmissionsOnExit, requestInterviewsFromOpportunity, agencySubmissions } from "@/server/services/opportunity.service";
import { agencyReport } from "@/server/services/agency-report.service";
import { partnerTeamsForClient } from "@/server/services/partner.service";
import { getRequest, startSalesReview, proposeSlots, clientConfirmSlots, candidateRespond, scheduleInterviews, completeInterview, recordClientDecision } from "@/server/services/interview.service";
import { performanceRatingFrom } from "@/server/views/partner.views";
import { setSetting } from "@/server/services/setting.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { FORBIDDEN_FOR_CLIENT, FORBIDDEN_FOR_AGENCY, collectKeys } from "@/server/views/forbidden-keys";
import { runWorkerOnce } from "@/server/jobs/worker";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";

const db = testDb();
async function drain() {
  for (let i = 0; i < 10; i++) if (!(await runWorkerOnce(db)).events) break;
}
const meta = { ipAddress: "198.51.100.16", userAgent: "vitest" };
const PASSWORD = "Str0ngPassw0rd!";
const ids = { super: "su_op", admin: "admin_op", sales: "sales_op", ownerA: "", agencyA: "", ownerB: "", agencyB: "", linkA: "", maria: "", mariaUser: "", ben: "", benUser: "", leo: "", leoUser: "", clientA: "", userA: "", clientB: "", userB: "", requirementId: "", opportunityId: "", submissionMaria: "", submissionLeo: "", requestId: "", template: "" };

const talent = (over: Record<string, unknown> = {}) => ({ termsAccepted: true, fullName: "Test Talent", displayName: "Test T.", email: "t@talent.example", password: PASSWORD, phone: "", locationCity: "Cebu", locationCountry: "Philippines", timezone: "Asia/Manila", primaryRole: "Appointment Setter", yearsExperience: 3, ...over });
const superAdmin = () => makeActor("SUPER_ADMIN", { userId: ids.super });
const sales = () => makeActor("SALES", { userId: ids.sales });
const ownerA = () => resolveActor(db, ids.ownerA);
const ownerB = () => resolveActor(db, ids.ownerB);
const maria = () => makeActor("AGENT", { userId: ids.mariaUser, agentProfileId: ids.maria });
const leo = () => makeActor("AGENT", { userId: ids.leoUser, agentProfileId: ids.leo });
const clientA = () => makeActor("CLIENT", { userId: ids.userA, clientId: ids.clientA });
const clientB = () => makeActor("CLIENT", { userId: ids.userB, clientId: ids.clientB });

function noLeaks(value: unknown, label: string, strings: string[], keys: readonly string[]) {
  const json = JSON.stringify(value);
  for (const s of strings) expect(json.includes(s), `${label} leaks "${s}"`).toBe(false);
  const found = collectKeys(value);
  for (const k of keys) expect(found.has(k), `${label} has forbidden key ${k}`).toBe(false);
}

async function joinAgency(name: string, email: string, link: string) {
  resetRateLimits();
  const r = await registerViaInvite(db, talent({ email, fullName: `${name} Santos Cruz`, displayName: name }), link, meta);
  await db.user.update({ where: { id: r.userId }, data: { emailVerifiedAt: new Date() } });
  await db.agencyMembership.updateMany({ where: { agentProfileId: r.agentProfileId, status: "PENDING_VERIFICATION" }, data: { status: "ACTIVE" } });
  await db.agentProfile.update({ where: { id: r.agentProfileId }, data: { status: "APPROVED", approvedAt: new Date(), availabilityStatus: "AVAILABLE", languages: ["English"] } });
  return r;
}

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
  await db.plan.createMany({ data: [{ id: "plan_starter", key: "STARTER", name: "Starter", baseAgentSeats: 5, sortOrder: 1 }] });
  const applicantRole = await role("APPLICANT");
  ids.ownerA = (await db.user.create({ data: { email: "dana@villanueva-teams.example", roleId: applicantRole, emailVerifiedAt: new Date() } })).id;
  ids.ownerB = (await db.user.create({ data: { email: "owner-b@agency.example", roleId: applicantRole, emailVerifiedAt: new Date() } })).id;
  ids.agencyA = await createAgencyDirect(db, superAdmin(), { ownerEmail: "dana@villanueva-teams.example", name: "Villanueva Virtual Teams", country: "Philippines", reason: "opportunity tests", planKey: "STARTER" });
  ids.agencyB = await createAgencyDirect(db, superAdmin(), { ownerEmail: "owner-b@agency.example", name: "Agency B", country: "Philippines", reason: "opportunity tests", planKey: "STARTER" });
  ids.linkA = (await inviteLinkForAgency(db, await ownerA())).url.split("/join/")[1];
  const m = await joinAgency("Maria", "maria@talent.example", ids.linkA);
  ids.maria = m.agentProfileId;
  ids.mariaUser = m.userId;
  const b = await joinAgency("Ben", "ben@talent.example", ids.linkA);
  ids.ben = b.agentProfileId;
  ids.benUser = b.userId;
  resetRateLimits();
  const l = await registerAgent(db, talent({ email: "leo@talent.example", fullName: "Leo Dela Cruz", displayName: "Leo D." }), meta);
  ids.leo = l.agentProfileId;
  ids.leoUser = l.userId;
  await db.user.update({ where: { id: l.userId }, data: { emailVerifiedAt: new Date() } });
  await db.agentProfile.update({ where: { id: ids.leo }, data: { status: "APPROVED", approvedAt: new Date(), availabilityStatus: "AVAILABLE", languages: ["English"] } });
  ids.template = (await db.certificationTemplate.create({ data: { name: "Hirewise Certified Appointment Setter" } })).id;
  // Maria and Leo hold an active credential; Ben does not.
  for (const agentProfileId of [ids.maria, ids.leo]) await db.certification.create({ data: { agentProfileId, templateId: ids.template, origin: "ADMIN_ISSUED", status: "APPROVED" } });
  const clientRole = await role("CLIENT");
  const uA = await db.user.create({ data: { email: "jordan@acme-solar.example", roleId: clientRole, emailVerifiedAt: new Date() } });
  const uB = await db.user.create({ data: { email: "sam@beta.example", roleId: clientRole, emailVerifiedAt: new Date() } });
  ids.userA = uA.id;
  ids.userB = uB.id;
  ids.clientA = (await db.client.create({ data: { companyName: "Acme Solar", industry: "Healthcare", country: "United States", status: "ACTIVE", timezone: "America/Los_Angeles", accountManagerUserId: ids.sales, contacts: { create: { userId: uA.id, name: "Jordan", businessEmail: uA.email, isPrimary: true } } } })).id;
  ids.clientB = (await db.client.create({ data: { companyName: "Beta", status: "ACTIVE", timezone: "Australia/Sydney", contacts: { create: { userId: uB.id, name: "Sam", businessEmail: uB.email, isPrimary: true } } } })).id;
  ids.requirementId = await createRequirement(db, clientA(), { title: "Patient intake setters", role: "Appointment Setter", agentsRequired: 2, skills: ["Appointment setting"], software: [], jobDescription: "Book intake calls for US clinics; Acme Solar branded scripts." });
});

afterAll(async () => {
  setEmailChannelForTests(null);
  await db.$disconnect();
});

const CLIENT_SECRETS = ["Acme Solar", "jordan@acme-solar.example"];
const AGENCY_SECRETS = ["Villanueva", "Agency B", "maria@talent.example"];

describe("publishing", () => {
  it("Hirewise publishes a requirement with the client masked; agencies and direct talent see it, clients see their own", async () => {
    await expect(publishOpportunity(db, await ownerA(), { requirementId: ids.requirementId })).rejects.toThrow(ForbiddenError);
    const o = await publishOpportunity(db, sales(), { requirementId: ids.requirementId, roleSummary: "Book intake calls for US clinics. Scripts provided." });
    ids.opportunityId = o.id;
    expect(o.maskedClientLabel).toBe("Healthcare client, United States");
    expect(o.headcount).toBe(2);
    expect((await db.clientRequirement.findUniqueOrThrow({ where: { id: ids.requirementId } })).status).toBe("IN_PROGRESS");
    await expect(publishOpportunity(db, sales(), { requirementId: ids.requirementId })).rejects.toThrow(/already published/);
    await drain();
    expect(await db.notification.count({ where: { userId: ids.ownerA, type: "OPPORTUNITY_PUBLISHED" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: ids.ownerB, type: "OPPORTUNITY_PUBLISHED" } })).toBe(1);

    const forA = await listOpportunitiesForAgency(db, await ownerA());
    expect(forA.opportunities.map((x) => x.id)).toEqual([o.id]);
    expect(forA.opportunities[0].clientLabel).toBe("Healthcare client, United States");
    noLeaks(forA, "agency list", CLIENT_SECRETS, FORBIDDEN_FOR_AGENCY);
    expect(forA.members.find((m) => m.id === ids.maria)?.eligible).toBe(true);
    expect(forA.members.find((m) => m.id === ids.ben)?.eligible).toBe(false);
    const forLeo = await listOpportunitiesForAgent(db, leo());
    expect(forLeo.agencyAgent).toBe(false);
    expect(forLeo.opportunities.map((x) => x.id)).toEqual([o.id]);
    noLeaks(forLeo, "agent list", CLIENT_SECRETS, []);
    const forMaria = await listOpportunitiesForAgent(db, maria());
    expect(forMaria.agencyAgent).toBe(true);
    expect(forMaria.opportunities).toEqual([]);
    const forClient = await listOpportunitiesForClient(db, clientA());
    expect(forClient[0].candidatesApproved).toBe(0);
    noLeaks(forClient, "client list", AGENCY_SECRETS, FORBIDDEN_FOR_CLIENT);
    await expect(getOpportunityForClient(db, clientB(), o.id)).rejects.toThrow(NotFoundError);
    expect((await listOpportunitiesForStaff(db, sales())).length).toBe(1);
    await expect(listOpportunitiesForStaff(db, makeActor("COACH"))).rejects.toThrow(ForbiddenError);
  });

  it("selected-agency visibility hides the opportunity from other agencies and from direct talent", async () => {
    const reqB = await createRequirement(db, clientB(), { title: "Beta support", role: "Customer Service Representative", agentsRequired: 1, skills: [], software: [] });
    await expect(publishOpportunity(db, sales(), { requirementId: reqB, visibility: "SELECTED_AGENCIES", agencyIds: [] })).rejects.toThrow(/at least one agency/);
    const o = await publishOpportunity(db, sales(), { requirementId: reqB, visibility: "SELECTED_AGENCIES", agencyIds: [ids.agencyB] });
    expect((await listOpportunitiesForAgency(db, await ownerA())).opportunities.map((x) => x.id)).not.toContain(o.id);
    expect((await listOpportunitiesForAgency(db, await ownerB())).opportunities.map((x) => x.id)).toContain(o.id);
    expect((await listOpportunitiesForAgent(db, leo())).opportunities.map((x) => x.id)).not.toContain(o.id);
    await expect(submitAgent(db, await ownerA(), { opportunityId: o.id, agentProfileId: ids.maria })).rejects.toThrow(NotFoundError);
    await expect(submitAgent(db, leo(), { opportunityId: o.id, agentProfileId: ids.leo })).rejects.toThrow(NotFoundError);
    await closeOpportunity(db, sales(), o.id, "CLOSED", "Client paused hiring");
  });
});

describe("submissions", () => {
  it("eligibility, exclusivity, caps, and tenant scope are enforced; Hirewise is notified", async () => {
    // Agency agents never self-submit; agency B cannot submit agency A's member; Ben lacks an active credential.
    await expect(submitAgent(db, maria(), { opportunityId: ids.opportunityId, agentProfileId: ids.maria })).rejects.toThrow(ForbiddenError);
    await expect(submitAgent(db, await ownerB(), { opportunityId: ids.opportunityId, agentProfileId: ids.maria })).rejects.toThrow(NotFoundError);
    await expect(submitAgent(db, await ownerA(), { opportunityId: ids.opportunityId, agentProfileId: ids.ben })).rejects.toThrow(/active certification/);
    await setSetting(db, superAdmin(), "opportunities", { requireActiveCredentials: false, maxSubmissionsPerAgency: 1 });
    const s = await submitAgent(db, await ownerA(), { opportunityId: ids.opportunityId, agentProfileId: ids.maria, note: "Three years of intake work." });
    ids.submissionMaria = s.id;
    await expect(submitAgent(db, await ownerA(), { opportunityId: ids.opportunityId, agentProfileId: ids.maria })).rejects.toThrow(/already has an open submission/);
    await expect(submitAgent(db, await ownerA(), { opportunityId: ids.opportunityId, agentProfileId: ids.ben })).rejects.toThrow(/limit 1/);
    await setSetting(db, superAdmin(), "opportunities", { requireActiveCredentials: true, maxSubmissionsPerAgency: 5 });
    ids.submissionLeo = (await submitAgent(db, leo(), { opportunityId: ids.opportunityId, agentProfileId: ids.leo })).id;
    await drain();
    expect(await db.notification.count({ where: { userId: ids.sales, type: "SUBMISSION_CREATED" } })).toBe(2);
    expect(await db.task.count({ where: { type: "REVIEW_SUBMISSION", status: "OPEN" } })).toBe(2);
    // The client sees nothing until Hirewise approves.
    expect((await getOpportunityForClient(db, clientA(), ids.opportunityId)).candidates).toEqual([]);
    // Agency B sees none of agency A's submissions.
    const mineB = await agencySubmissions(db, await ownerB());
    expect(mineB).toEqual([]);
    await expect(agencySubmissions(db, await ownerB(), ids.agencyA)).rejects.toThrow(NotFoundError); // cross-tenant reads are NotFound, never an oracle
  });

  it("Hirewise reviews; approved candidates reach the client as client-safe cards; declines carry a note; withdrawal works", async () => {
    await expect(reviewSubmission(db, await ownerA(), ids.submissionMaria, "APPROVE")).rejects.toThrow(ForbiddenError);
    await expect(reviewSubmission(db, sales(), ids.submissionLeo, "DECLINE")).rejects.toThrow(/note/);
    await reviewSubmission(db, sales(), ids.submissionMaria, "APPROVE");
    await reviewSubmission(db, sales(), ids.submissionLeo, "DECLINE", "Timezone does not fit");
    await drain();
    expect(await db.notification.count({ where: { userId: ids.ownerA, type: "SUBMISSION_REVIEWED" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: ids.leoUser, type: "SUBMISSION_REVIEWED" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: ids.userA, type: "SUBMISSION_REVIEWED" } })).toBe(1);
    const view = await getOpportunityForClient(db, clientA(), ids.opportunityId);
    expect(view.candidates.map((c) => c.name)).toEqual(["Maria C."]);
    expect(view.candidates[0].partnerTeam?.code).toMatch(/^HWC-/);
    noLeaks(view, "client opportunity", AGENCY_SECRETS, FORBIDDEN_FOR_CLIENT);
    const leoView = (await listOpportunitiesForAgent(db, leo())).opportunities[0];
    expect(leoView.mySubmission?.status).toBe("DECLINED");
    expect(leoView.mySubmission?.reviewNote).toBe("Timezone does not fit");
    // Leo resubmits and withdraws.
    const again = await submitAgent(db, leo(), { opportunityId: ids.opportunityId, agentProfileId: ids.leo });
    await expect(withdrawSubmission(db, maria(), again.id, "not mine")).rejects.toThrow(NotFoundError);
    await withdrawSubmission(db, leo(), again.id, "Took another role");
    expect((await db.submission.findUniqueOrThrow({ where: { id: again.id } })).status).toBe("WITHDRAWN");
  });

  it("the client requests interviews from the opportunity; outcomes flow back to the submission and the rating inputs", async () => {
    await expect(requestInterviewsFromOpportunity(db, clientB(), { opportunityId: ids.opportunityId, agentProfileIds: [ids.maria], timezone: "Australia/Sydney" })).rejects.toThrow(NotFoundError);
    ids.requestId = await requestInterviewsFromOpportunity(db, clientA(), { opportunityId: ids.opportunityId, agentProfileIds: [ids.maria], timezone: "America/Los_Angeles", requestedWindows: "Tue 9-11am PST" });
    expect((await db.submission.findUniqueOrThrow({ where: { id: ids.submissionMaria } })).status).toBe("INTERVIEWING");
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: ids.opportunityId } })).status).toBe("INTERVIEWING");
    const req = (await getRequest(db, clientA(), ids.requestId)).request as { candidates: Array<{ name: string }>; requestedWindows: string[] };
    expect(req.candidates[0].name).toBe("Maria C.");
    expect(req.requestedWindows).toEqual(["Tue 9-11am PST"]);
    expect(await db.messageThread.count({ where: { interviewRequestId: ids.requestId } })).toBe(1);
    await startSalesReview(db, sales(), ids.requestId);
    await proposeSlots(db, sales(), ids.requestId, "Tuesday 9am PST?");
    await clientConfirmSlots(db, clientA(), ids.requestId);
    await candidateRespond(db, maria(), ids.requestId, "CONFIRMED");
    const when = new Date(Date.now() + 2 * 86_400_000).toISOString();
    await scheduleInterviews(db, sales(), ids.requestId, { timezone: "America/Los_Angeles", items: [{ agentProfileId: ids.maria, scheduledAt: when, durationMin: 30, meetingLink: "https://zoom.us/j/777" }] });
    const iv = await db.interview.findFirstOrThrow({ where: { interviewRequestId: ids.requestId } });
    await completeInterview(db, sales(), iv.id, "COMPLETED", "Good");
    await recordClientDecision(db, clientA(), iv.id, { decision: "SELECTED", feedback: "Hire" });
    expect((await db.submission.findUniqueOrThrow({ where: { id: ids.submissionMaria } })).status).toBe("SELECTED");
    const report = await agencyReport(db, await ownerA());
    expect(report.submissions.selected).toBe(1);
    expect(report.placements.inPipeline).toBe(1);
    expect(report.interviews.scheduled).toBe(1);
    noLeaks(report, "agency report", CLIENT_SECRETS, FORBIDDEN_FOR_AGENCY);
    await expect(agencyReport(db, await ownerB(), ids.agencyA)).rejects.toThrow(NotFoundError);
    expect((await agencyReport(db, sales(), ids.agencyA)).submissions.selected).toBe(1);
    // Rating needs five data points; the view stays null until then.
    expect(performanceRatingFrom({ selected: 1, active: 1 })).toBeNull();
    expect(performanceRatingFrom({ selected: 5, active: 4 })).toBe(80);
    expect((await partnerTeamsForClient(db, clientA())).find((t) => t.name.includes("HWC"))?.performanceRating ?? null).toBeNull();
  });

  it("an agency exit withdraws that agency's open submissions for the agent and tells Hirewise", async () => {
    const extra = await publishOpportunity(db, sales(), { requirementId: await createRequirement(db, clientA(), { title: "Second role", role: "Appointment Setter", agentsRequired: 1, skills: [], software: [] }) });
    await db.certification.create({ data: { agentProfileId: ids.ben, templateId: ids.template, origin: "ADMIN_ISSUED", status: "APPROVED" } });
    const s = await submitAgent(db, await ownerA(), { opportunityId: extra.id, agentProfileId: ids.ben });
    const n = await withdrawSubmissionsOnExit(db, { agentProfileId: ids.ben, agencyId: ids.agencyA, agencyName: "Villanueva Virtual Teams", displayName: "Ben", reason: "Agent requested leave" });
    expect(n).toBe(1);
    const row = await db.submission.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.status).toBe("WITHDRAWN");
    expect(row.withdrawnReason).toContain("Agency membership ended");
    expect((await db.submission.findUniqueOrThrow({ where: { id: ids.submissionMaria } })).status).toBe("SELECTED"); // decided submissions are untouched
    await drain();
    expect(await db.notification.count({ where: { userId: ids.sales, type: "SUBMISSION_WITHDRAWN", title: { contains: "agency exit" } } })).toBe(1);
    expect(await withdrawSubmissionsOnExit(db, { agentProfileId: ids.ben, agencyId: ids.agencyA, agencyName: "Villanueva Virtual Teams", displayName: "Ben", reason: "again" })).toBe(0);
  });

  it("closing an opportunity withdraws pending and approved submissions and marks the requirement filled", async () => {
    const o = await closeOpportunity(db, sales(), ids.opportunityId, "FILLED", "Both positions covered");
    expect(o.status).toBe("FILLED");
    expect((await db.clientRequirement.findUniqueOrThrow({ where: { id: ids.requirementId } })).status).toBe("FILLED");
    await expect(submitAgent(db, await ownerA(), { opportunityId: ids.opportunityId, agentProfileId: ids.ben })).rejects.toThrow(/no longer open/);
    await expect(closeOpportunity(db, sales(), ids.opportunityId, "CLOSED", "again")).rejects.toThrow(/already closed/);
  });
});
