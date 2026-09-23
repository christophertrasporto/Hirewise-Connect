import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDb, resetDb } from "../setup/db";
import { matchCandidates } from "@/server/services/match.service";
import { saveSearch, listSavedSearches, deleteSavedSearch } from "@/server/services/saved-search.service";
import { createIncident, listIncidents, getIncident, transitionIncident, suspendUser, reinstateUser, incidentsForUser } from "@/server/services/incident.service";
import { bulkAgentAction, broadcastNotification, anonymiseUser, retentionCandidates, runRetention } from "@/server/services/admin.service";
import { exportClientData } from "@/server/services/export.service";
import { analyticsDashboard } from "@/server/services/analytics.service";
import { createCheckout, recordProviderPayment } from "@/server/services/billing.service";
import { scheduleInterviews, interviewCalendar, createInterviewRequest } from "@/server/services/interview.service";
import { addToShortlist, removeFromShortlist } from "@/server/services/shortlist.service";
import { getCandidateForClient } from "@/server/services/search.service";
import { updateProfessional } from "@/server/services/agent.service";
import { setPaymentProviderForTests, FakePaymentProvider } from "@/server/adapters/payments";
import { setMeetingProviderForTests, FakeMeetingProvider } from "@/server/adapters/meetings";
import { setSmsChannelForTests, ConsoleSmsChannel } from "@/server/adapters/sms";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { runWorkerOnce } from "@/server/jobs/worker";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";

const db = testDb();
let dir = "";
const sms = new ConsoleSmsChannel();
const ids = { owner: "owner_1", admin: "admin_1", sales: "sales_1", ops: "ops_1", clientUserA: "", clientA: "", clientUserB: "", clientB: "", agentUser: "", agent: "", agent2User: "", agent2: "", requirement: "", invoice: "", placement: "" };

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hw-p5-"));
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  process.env.APP_URL = "http://localhost:3000";
  resetEnvCache();
  setEmailChannelForTests(new ConsoleEmailChannel());
  setPaymentProviderForTests(new FakePaymentProvider());
  setMeetingProviderForTests(new FakeMeetingProvider());
  setSmsChannelForTests(sms);
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.setting.createMany({ data: [{ key: "hoursPerMonthDefault", value: 173 }, { key: "reservationTtlDays", value: 7 }, { key: "profileViewBurstPerHour", value: 3 }, { key: "shortlistChurnPerDay", value: 3 }, { key: "retentionDays", value: 30 }] });
  await db.user.create({ data: { id: ids.owner, email: "owner@hirewise.example", roleId: await role("SUPER_ADMIN") } });
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN") } });
  await db.user.create({ data: { id: ids.sales, email: "sales@hirewise.example", roleId: await role("SALES") } });
  await db.user.create({ data: { id: ids.ops, email: "ops@hirewise.example", roleId: await role("OPERATIONS") } });
  const uA = await db.user.create({ data: { email: "a@acme.example", roleId: await role("CLIENT"), emailVerifiedAt: new Date() } });
  const uB = await db.user.create({ data: { email: "b@beta.example", roleId: await role("CLIENT"), emailVerifiedAt: new Date() } });
  ids.clientUserA = uA.id;
  ids.clientUserB = uB.id;
  ids.clientA = (await db.client.create({ data: { companyName: "Acme Solar", status: "ACTIVE", timezone: "America/Los_Angeles", source: "referral", accountManagerUserId: ids.sales, contacts: { create: { userId: uA.id, name: "Jordan", businessEmail: uA.email, isPrimary: true } } } })).id;
  ids.clientB = (await db.client.create({ data: { companyName: "Beta", status: "ACTIVE", timezone: "Australia/Sydney", contacts: { create: { userId: uB.id, name: "Sam", businessEmail: uB.email, isPrimary: true } } } })).id;
  const cc = await db.skill.create({ data: { name: "Cold Calling", category: "Sales" } });
  const as = await db.skill.create({ data: { name: "Appointment Setting", category: "Sales" } });
  const agentRole = await role("AGENT");
  const mk = async (email: string, name: string, opts: { role: string; skills: string[]; level: "MID" | "SENIOR"; availability: "AVAILABLE" | "AVAILABLE_SOON"; industry: string; phone?: string }) => {
    const u = await db.user.create({ data: { email, roleId: agentRole } });
    const p = await db.agentProfile.create({ data: { userId: u.id, displayName: name, headline: "H", primaryRole: opts.role, status: "APPROVED", availabilityStatus: opts.availability, timezone: "Asia/Manila", experienceLevel: opts.level, approvedAt: new Date(), submittedAt: new Date(Date.now() - 2 * 86_400_000), languages: ["English"], privateContact: { create: { fullLegalName: `${name} Legal`, phone: opts.phone ?? "+63" } }, skills: { create: opts.skills.map((id) => ({ skillId: id, level: "ADVANCED" as const })) }, industryExperiences: { create: { industry: opts.industry, years: 2 } }, videos: { create: { storageKey: "agents/x/video/a.mp4", status: "APPROVED", isCurrent: true } } } });
    return { u, p };
  };
  const a1 = await mk("jose@t.example", "Jose R.", { role: "Cold Caller", skills: [cc.id, as.id], level: "SENIOR", availability: "AVAILABLE", industry: "Real Estate", phone: "+63 917 000 0000" });
  const a2 = await mk("ana@t.example", "Ana L.", { role: "Cold Caller", skills: [cc.id], level: "MID", availability: "AVAILABLE_SOON", industry: "Solar" });
  await mk("ea@t.example", "Eva E.", { role: "Executive Assistant", skills: [as.id], level: "MID", availability: "AVAILABLE", industry: "SaaS" });
  ids.agentUser = a1.u.id; ids.agent = a1.p.id; ids.agent2User = a2.u.id; ids.agent2 = a2.p.id;
  ids.requirement = (await db.clientRequirement.create({ data: { clientId: ids.clientA, title: "Solar setter", role: "Cold Caller", skills: [cc.id, as.id], industry: "Real Estate", experienceLevel: "MID", timezone: "America/Los_Angeles", agentsRequired: 1, budgetMax: 200_000, currency: "USD" } })).id;
  await db.notificationPreference.create({ data: { userId: ids.agentUser, type: "INTERVIEW_REMINDER", sms: true } });
});

afterAll(async () => {
  setEmailChannelForTests(null);
  setPaymentProviderForTests(null);
  setMeetingProviderForTests(null);
  setSmsChannelForTests(null);
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales, salesAssignedClientIds: [ids.clientA] });
const ops = () => makeActor("OPERATIONS", { userId: ids.ops });
const clientA = () => makeActor("CLIENT", { userId: ids.clientUserA, clientId: ids.clientA });
const clientB = () => makeActor("CLIENT", { userId: ids.clientUserB, clientId: ids.clientB });
const agent = () => makeActor("AGENT", { userId: ids.agentUser, agentProfileId: ids.agent });

describe("matching with explanations", () => {
  it("ranks deterministically, explains each reason, applies hard rules, and scopes to the owner", async () => {
    const a = await matchCandidates(db, clientA(), ids.requirement);
    const b = await matchCandidates(db, clientA(), ids.requirement);
    expect(a.matches.map((m) => m.candidate.id)).toEqual(b.matches.map((m) => m.candidate.id));
    expect(a.matches.map((m) => m.candidate.displayName)).toEqual(["Jose R.", "Ana L."]);
    expect(a.matches[0].reasons.find((r) => r.rule === "skills")?.text).toBe("Matched 2/2 required skills");
    expect(a.matches[1].reasons.find((r) => r.rule === "skills")?.text).toContain("missing appointment setting");
    expect(a.nearMisses.map((m) => m.candidate.displayName)).toEqual(["Eva E."]);
    expect(a.consideredCount).toBe(3);
    const strict = await matchCandidates(db, clientA(), ids.requirement, { includeSoon: false });
    expect(strict.matches.map((m) => m.candidate.displayName)).toEqual(["Jose R."]);
    await expect(matchCandidates(db, clientB(), ids.requirement)).rejects.toThrow(NotFoundError);
    expect((await matchCandidates(db, sales(), ids.requirement)).matches).toHaveLength(2);
    await expect(matchCandidates(db, makeActor("COACH"), ids.requirement)).rejects.toThrow(ForbiddenError);
  });
});

describe("saved searches", () => {
  it("clients save, list, and delete their own searches only", async () => {
    const id = await saveSearch(db, clientA(), "Solar setters", { q: "solar", skills: ["x"], verification: "PROFILE_VERIFIED" });
    expect((await listSavedSearches(db, clientA())).map((s) => s.query)).toEqual(["q=solar&skills=x&verification=PROFILE_VERIFIED"]);
    expect(await listSavedSearches(db, clientB())).toEqual([]);
    await expect(deleteSavedSearch(db, clientB(), id)).rejects.toThrow(NotFoundError);
    await expect(saveSearch(db, agent(), "x", {})).rejects.toThrow(ForbiddenError);
    await deleteSavedSearch(db, clientA(), id);
    expect(await listSavedSearches(db, clientA())).toEqual([]);
  });
});

describe("Section 8.8 flags", () => {
  it("profile-view bursts, shortlist churn, and contact details in profile text raise flags", async () => {
    for (let i = 0; i < 3; i++) await getCandidateForClient(db, clientA(), ids.agent);
    expect(await db.activityFlag.count({ where: { rule: "PROFILE_VIEW_BURST", userId: ids.clientUserA } })).toBe(1);
    await getCandidateForClient(db, clientA(), ids.agent);
    expect(await db.activityFlag.count({ where: { rule: "PROFILE_VIEW_BURST", userId: ids.clientUserA } })).toBe(1); // one per hour
    await addToShortlist(db, clientA(), ids.agent);
    await removeFromShortlist(db, clientA(), ids.agent);
    await addToShortlist(db, clientA(), ids.agent);
    await removeFromShortlist(db, clientA(), ids.agent);
    expect(await db.activityFlag.count({ where: { rule: "SHORTLIST_CHURN", userId: ids.clientUserA } })).toBe(1);
    await updateProfessional(db, agent(), { headline: "Setter", primaryRole: "Cold Caller", summary: "Reach me at jose@gmail.com or +63 917 123 4567 for a direct deal", yearsExperience: 5, experienceLevel: "SENIOR", industries: [] });
    expect(await db.activityFlag.count({ where: { rule: "CONTACT_INFO_IN_PROFILE", userId: ids.agentUser } })).toBe(1);
  });
});

describe("incidents and suspension", () => {
  let incidentId = "";
  it("Sales creates and sees only their own; Admin sees all and resolves; the agent cannot", async () => {
    incidentId = await createIncident(db, sales(), { subjectUserId: ids.agentUser, type: "OFF_PLATFORM_CONTACT", severity: "HIGH", description: "Posted a personal email in the profile summary." });
    const byAdmin = await createIncident(db, admin(), { subjectUserId: ids.agent2User, type: "POLICY_VIOLATION", severity: "LOW", description: "Minor policy issue noted during review." });
    await expect(createIncident(db, agent(), { subjectUserId: ids.agentUser, type: "OTHER", severity: "LOW", description: "self report attempt here" })).rejects.toThrow(ForbiddenError);
    await expect(createIncident(db, clientA(), { subjectUserId: ids.agentUser, type: "OTHER", severity: "LOW", description: "client report attempt here" })).rejects.toThrow(ForbiddenError);
    expect((await listIncidents(db, sales())).map((i) => i.id)).toEqual([incidentId]);
    expect((await listIncidents(db, admin())).length).toBe(2);
    await expect(getIncident(db, sales(), byAdmin)).rejects.toThrow(NotFoundError);
    await expect(transitionIncident(db, sales(), incidentId, "RESOLVED", "x")).rejects.toThrow(ForbiddenError);
    await transitionIncident(db, admin(), incidentId, "UNDER_REVIEW");
    await expect(transitionIncident(db, admin(), incidentId, "RESOLVED")).rejects.toThrow(/resolution/);
    const r = await runWorkerOnce(db);
    expect(r.failures).toBe(0);
    expect(await db.notification.count({ where: { userId: ids.admin, type: "INCIDENT_CREATED" } })).toBe(2);
  });

  it("suspension needs user.manage and a reason; sessions are dropped; the profile leaves the marketplace; reinstatement restores it", async () => {
    await db.session.create({ data: { userId: ids.agentUser, tokenHash: "h", mfaPassed: true, expiresAt: new Date(Date.now() + 86_400_000) } });
    await expect(suspendUser(db, sales(), ids.agentUser, "x")).rejects.toThrow(ForbiddenError);
    await expect(suspendUser(db, admin(), ids.agentUser, " ")).rejects.toThrow(/reason/);
    await suspendUser(db, admin(), ids.agentUser, "Off-platform contact confirmed", incidentId);
    const u = await db.user.findUniqueOrThrow({ where: { id: ids.agentUser }, include: { agentProfile: true, sessions: true } });
    expect([u.status, u.agentProfile?.status, u.sessions.length]).toEqual(["SUSPENDED", "SUSPENDED", 0]);
    await expect(getCandidateForClient(db, clientA(), ids.agent)).rejects.toThrow(NotFoundError);
    expect((await incidentsForUser(db, admin(), ids.agentUser)).length).toBe(1);
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.agentUser, type: "USER_SUSPENDED" } })).toBe(1);
    await reinstateUser(db, admin(), ids.agentUser, "Warning issued");
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: ids.agent } })).status).toBe("APPROVED");
    await transitionIncident(db, admin(), incidentId, "RESOLVED", "Warned and reinstated.");
    expect((await getIncident(db, admin(), incidentId)).status).toBe("RESOLVED");
  });
});

describe("bulk actions and broadcast", () => {
  it("bulk hide goes through the single-item guard per agent and reports failures individually", async () => {
    const r = await bulkAgentAction(db, admin(), { agentProfileIds: [ids.agent, ids.agent2, "missing"], op: "HIDE", reason: "Campaign paused" });
    expect(r.done).toBe(2);
    expect(r.failed).toHaveLength(1);
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: ids.agent } })).status).toBe("HIDDEN");
    await expect(bulkAgentAction(db, makeActor("RECRUITER"), { agentProfileIds: [ids.agent], op: "HIDE" })).resolves.toMatchObject({ done: 0 });
    await bulkAgentAction(db, admin(), { agentProfileIds: [ids.agent, ids.agent2], op: "UNHIDE", reason: "Campaign resumed" });
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: ids.agent } })).status).toBe("APPROVED");
    expect(await db.auditLog.count({ where: { action: "PROFILE_HIDDEN" } })).toBe(2);
  });

  it("broadcast needs notification.broadcast and reaches every active user in the roles", async () => {
    await expect(broadcastNotification(db, sales(), { roles: ["AGENT"], title: "Hello talent", body: "A message for everyone here.", email: false })).rejects.toThrow(ForbiddenError);
    const n = await broadcastNotification(db, admin(), { roles: ["AGENT"], title: "Hello talent", body: "A message for everyone here.", email: false });
    expect(n).toBe(3);
    expect(await db.notification.count({ where: { type: "BROADCAST" } })).toBe(3);
  });
});

describe("online payments, meetings, SMS, calendar", () => {
  it("client checkout via the fake provider records the payment and settles the deposit; other clients cannot pay", async () => {
    await db.clientBillingRate.create({ data: { agentProfileId: ids.agent, amount: 900, currency: "USD", unit: "HOURLY", status: "PUBLISHED", proposedById: ids.sales, approvedById: ids.admin } });
    await db.depositPolicy.create({ data: { name: "One month", type: "ONE_MONTH", isDefault: true } });
    ids.placement = (await db.placement.create({ data: { clientId: ids.clientA, agentProfileId: ids.agent, positionTitle: "Cold Caller", status: "SELECTED" } })).id;
    const { approvePlacement, acceptServiceAgreement } = await import("@/server/services/placement.service");
    await db.agreement.create({ data: { type: "PLACEMENT_SERVICE_AGREEMENT", version: 1, title: "PSA", bodyMarkdown: "{{companyName}}", bodyChecksum: "x", effectiveFrom: new Date("2026-01-01"), isActive: true } });
    await approvePlacement(db, admin(), ids.placement);
    await acceptServiceAgreement(db, clientA(), ids.placement, {});
    const inv = await db.invoice.findFirstOrThrow({ where: { placementId: ids.placement } });
    ids.invoice = inv.id;
    await expect(createCheckout(db, clientB(), inv.id)).rejects.toThrow(NotFoundError);
    const c = await createCheckout(db, clientA(), inv.id);
    expect(c?.url).toContain(`/api/payments/fake/${inv.id}`);
    const r = await recordProviderPayment(db, { invoiceId: inv.id, amount: inv.amount, currency: "USD", reference: "fake_1", payload: { fake: true } });
    expect(r).toMatchObject({ invoicePaid: true, depositSettled: true });
    expect(await recordProviderPayment(db, { invoiceId: inv.id, amount: inv.amount, currency: "USD", reference: "fake_1", payload: {} })).toEqual({ duplicate: true });
    const p = await db.placement.findUniqueOrThrow({ where: { id: ids.placement } });
    expect(p.status).toBe("DEPLOYMENT_PREP");
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { type: "PAYMENT_RECEIVED" } })).toBe(2);
  });

  it("scheduling without a pasted link creates a meeting through the provider; reminders reach SMS when opted in; calendar is scoped", async () => {
    await db.agentProfile.update({ where: { id: ids.agent }, data: { availabilityStatus: "AVAILABLE" } });
    await addToShortlist(db, clientA(), ids.agent);
    const reqId = await createInterviewRequest(db, clientA(), { candidateIds: [ids.agent], role: "Cold Caller", timezone: "America/Los_Angeles", schedule: "", preferredDate: "", preferredTime: "", notes: "", targetStartDate: "", requirementId: "" });
    await db.interviewRequest.update({ where: { id: reqId }, data: { status: "CANDIDATE_CONFIRMATION", assignedSalesUserId: ids.sales } });
    await db.interviewRequestCandidate.updateMany({ where: { interviewRequestId: reqId }, data: { status: "CONFIRMED" } });
    const at = new Date(Date.now() + 2 * 3_600_000).toISOString();
    await scheduleInterviews(db, sales(), reqId, { items: [{ agentProfileId: ids.agent, scheduledAt: at, durationMin: 30, meetingLink: "" }], timezone: "America/Los_Angeles" });
    const iv = await db.interview.findFirstOrThrow({ where: { interviewRequestId: reqId } });
    expect(iv.meetingLink).toMatch(/^https:\/\/meet\.hirewise\.example\//);
    expect(iv.meetingProvider).toBe("fake");
    // Run the 1h reminder now
    await db.job.updateMany({ where: { type: "INTERVIEW_REMINDER" }, data: { runAt: new Date(Date.now() - 1000) } });
    await runWorkerOnce(db);
    await runWorkerOnce(db); // SEND_SMS job enqueued by the reminder
    expect(sms.sent.some((m) => m.to === "+639170000000")).toBe(true);
    const cal = await interviewCalendar(db, agent(), iv.id);
    expect(cal.ics).toContain("Interview with Acme Solar");
    expect((await interviewCalendar(db, clientA(), iv.id)).ics).toContain("Jose R.");
    await expect(interviewCalendar(db, clientB(), iv.id)).rejects.toThrow(NotFoundError);
    await expect(interviewCalendar(db, makeActor("AGENT", { agentProfileId: ids.agent2 }), iv.id)).rejects.toThrow(NotFoundError);
  });
});

describe("export, analytics, anonymisation, retention", () => {
  it("client export contains own data only and is audited", async () => {
    const data = await exportClientData(db, clientA());
    expect(data.client.companyName).toBe("Acme Solar");
    expect(data.invoices).toHaveLength(1);
    expect(data.placements[0].clientBillingRate?.amount).toBe(900);
    expect(JSON.stringify(data)).not.toContain("positioningNotes");
    expect(JSON.stringify(data)).not.toContain("Beta");
    await expect(exportClientData(db, agent())).rejects.toThrow(ForbiddenError);
    expect(await db.auditLog.count({ where: { action: "DATA_EXPORTED" } })).toBe(1);
  });

  it("analytics blocks follow the role list; coaches see only their courses", async () => {
    const a = await analyticsDashboard(db, admin());
    expect(a.talent?.registrations).toBe(3);
    expect(a.funnel?.steps.map((s) => s.label)).toContain("Activated");
    // Jose is interviewing and Ana was anonymised, so Eva is the one available agent left.
    expect(a.available?.byRole.map((b) => b.label)).toContain("Executive Assistant");
    const s = await analyticsDashboard(db, sales());
    expect(s.talent).toBeNull();
    expect(s.funnel).not.toBeNull();
    const o = await analyticsDashboard(db, ops());
    expect(o.clients).not.toBeNull();
    expect(o.academy).toBeNull();
    await expect(analyticsDashboard(db, agent())).rejects.toThrow(ForbiddenError);
  });

  it("anonymisation scrubs personal data, blocks on open placements, and the retention job picks up stale accounts", async () => {
    await expect(anonymiseUser(db, admin(), ids.agentUser, "Deletion request #1")).rejects.toThrow(/open placement/);
    await expect(anonymiseUser(db, sales(), ids.agent2User, "x")).rejects.toThrow(ForbiddenError);
    await anonymiseUser(db, admin(), ids.agent2User, "Deletion request #2");
    const u = await db.user.findUniqueOrThrow({ where: { id: ids.agent2User }, include: { agentProfile: { include: { privateContact: true } } } });
    expect(u.email).toMatch(/@anonymised\.invalid$/);
    expect(u.status).toBe("DEACTIVATED");
    expect(u.agentProfile?.displayName).toBe("Former talent");
    expect(u.agentProfile?.privateContact?.phone).toBeNull();
    expect(u.agentProfile?.privateContact?.fullLegalName).toBe("Anonymised");
    expect(await db.auditLog.count({ where: { action: "USER_ANONYMISED" } })).toBe(1);

    const stale = await db.user.create({ data: { email: "old@t.example", roleId: (await db.role.findUniqueOrThrow({ where: { key: "AGENT" } })).id, status: "DEACTIVATED" } });
    await db.$executeRawUnsafe(`UPDATE "User" SET "updatedAt" = now() - interval '60 days' WHERE id = $1`, stale.id);
    const c = await retentionCandidates(db, admin());
    expect(c.candidates.map((x) => x.id)).toEqual([stale.id]);
    const r = await runRetention(db, admin());
    expect(r).toMatchObject({ considered: 1, done: 1 });
    expect((await db.user.findUniqueOrThrow({ where: { id: stale.id } })).email).toMatch(/anonymised/);
    await expect(runRetention(db, ops())).rejects.toThrow(ForbiddenError);
  });
});
