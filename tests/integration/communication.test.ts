import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDb, resetDb } from "../setup/db";
import { seedTerms } from "../setup/terms";
import { createAgencyDirect } from "@/server/services/agency.service";
import { inviteLinkForAgency, registerViaInvite } from "@/server/services/invite.service";
import { registerAgent } from "@/server/services/agent.service";
import { addToShortlist } from "@/server/services/shortlist.service";
import { createInterviewRequest, getRequest, startSalesReview, proposeSlots, clientConfirmSlots, candidateRespond, scheduleInterviews } from "@/server/services/interview.service";
import { postMessage, listMessages, listHeldMessages, reviewHeldMessage } from "@/server/services/message.service";
import { openEnquiryThread, openSupportThread, postToThread, listThreadMessages, listMyThreads, closeThread, listMaskedMessages } from "@/server/services/thread.service";
import { aliasFor, contactAliasFor, allocateMissingAliases, handleInboundEmail } from "@/server/services/alias.service";
import { reportBypass, listBypassReports, getBypassReport, decideBypass, myBypassReports } from "@/server/services/bypass.service";
import { getCandidateForClient } from "@/server/services/search.service";
import { partnerTeamsForClient } from "@/server/services/partner.service";
import { setSetting } from "@/server/services/setting.service";
import { isAllowedMeetingHost, DEFAULT_ALLOWED_MEETING_HOSTS } from "@/lib/meeting-link";
import { scanMessage } from "@/lib/message-filter";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { FORBIDDEN_FOR_CLIENT, collectKeys } from "@/server/views/forbidden-keys";
import { runWorkerOnce } from "@/server/jobs/worker";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { resetEnvCache } from "@/server/env";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";

const db = testDb();
/** Earlier tests leave events behind; drain the outbox fully so notifications are deterministic. */
async function drain() {
  for (let i = 0; i < 10; i++) if (!(await runWorkerOnce(db)).events) break;
}
const meta = { ipAddress: "198.51.100.15", userAgent: "vitest" };
const PASSWORD = "Str0ngPassw0rd!";
const AGENCY = "Villanueva Virtual Teams";
let dir = "";
const ids = { super: "su_cm", admin: "admin_cm", sales: "sales_cm", ownerUser: "", agencyA: "", link: "", maria: "", mariaUser: "", leo: "", leoUser: "", clientA: "", userA: "", clientB: "", userB: "", requestId: "", code: "", reportId: "" };

const talent = (over: Record<string, unknown> = {}) => ({ termsAccepted: true, fullName: "Test Talent", displayName: "Test T.", email: "t@talent.example", password: PASSWORD, phone: "", locationCity: "Cebu", locationCountry: "Philippines", timezone: "Asia/Manila", primaryRole: "Appointment Setter", yearsExperience: 3, ...over });
const superAdmin = () => makeActor("SUPER_ADMIN", { userId: ids.super });
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const owner = () => resolveActor(db, ids.ownerUser);
const maria = () => makeActor("AGENT", { userId: ids.mariaUser, agentProfileId: ids.maria });
const leo = () => makeActor("AGENT", { userId: ids.leoUser, agentProfileId: ids.leo });
const clientA = () => makeActor("CLIENT", { userId: ids.userA, clientId: ids.clientA });
const clientB = () => makeActor("CLIENT", { userId: ids.userB, clientId: ids.clientB });

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hw-cm-"));
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16";
  process.env.APP_URL = "http://localhost:3000";
  resetEnvCache();
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
  ids.ownerUser = (await db.user.create({ data: { email: "dana@villanueva-teams.example", roleId: await role("APPLICANT"), emailVerifiedAt: new Date() } })).id;
  ids.agencyA = await createAgencyDirect(db, superAdmin(), { ownerEmail: "dana@villanueva-teams.example", name: AGENCY, country: "Philippines", reason: "communication tests", planKey: "STARTER" });
  ids.code = (await db.agency.findUniqueOrThrow({ where: { id: ids.agencyA } })).clientFacingCode!;
  ids.link = (await inviteLinkForAgency(db, await owner())).url.split("/join/")[1];
  const m = await registerViaInvite(db, talent({ email: "maria.cruz@gmail.com", fullName: "Maria Santos Cruz", displayName: "Maria Santos", phone: "+63 917 555 0101" }), ids.link, meta);
  ids.maria = m.agentProfileId;
  ids.mariaUser = m.userId;
  await db.user.update({ where: { id: m.userId }, data: { emailVerifiedAt: new Date() } });
  await db.agencyMembership.updateMany({ where: { agentProfileId: ids.maria, status: "PENDING_VERIFICATION" }, data: { status: "ACTIVE" } });
  await db.agentProfile.update({ where: { id: ids.maria }, data: { status: "APPROVED", approvedAt: new Date(), availabilityStatus: "AVAILABLE", languages: ["English"] } });
  resetRateLimits();
  const l = await registerAgent(db, talent({ email: "leo@talent.example", fullName: "Leo Dela Cruz", displayName: "Leo D." }), meta);
  ids.leo = l.agentProfileId;
  ids.leoUser = l.userId;
  await db.user.update({ where: { id: l.userId }, data: { emailVerifiedAt: new Date() } });
  await db.agentProfile.update({ where: { id: ids.leo }, data: { status: "APPROVED", approvedAt: new Date(), availabilityStatus: "AVAILABLE", languages: ["English"] } });
  const clientRole = await role("CLIENT");
  const uA = await db.user.create({ data: { email: "jordan@acme-solar.example", roleId: clientRole, emailVerifiedAt: new Date() } });
  const uB = await db.user.create({ data: { email: "sam@beta.example", roleId: clientRole, emailVerifiedAt: new Date() } });
  ids.userA = uA.id;
  ids.userB = uB.id;
  ids.clientA = (await db.client.create({ data: { companyName: "Acme Solar", industry: "Healthcare", country: "United States", status: "ACTIVE", timezone: "America/Los_Angeles", accountManagerUserId: ids.sales, contacts: { create: { userId: uA.id, name: "Jordan", businessEmail: uA.email, isPrimary: true } } } })).id;
  ids.clientB = (await db.client.create({ data: { companyName: "Beta", status: "ACTIVE", timezone: "Australia/Sydney", contacts: { create: { userId: uB.id, name: "Sam", businessEmail: uB.email, isPrimary: true } } } })).id;
});

afterAll(async () => {
  setEmailChannelForTests(null);
  rmSync(dir, { recursive: true, force: true });
  await db.$disconnect();
});

describe("detection helpers (pure)", () => {
  it("links of any kind count as contact routes; years do not", () => {
    expect(scanMessage("See my portfolio at https://maria.example/work").reasons).toContain("link");
    expect(scanMessage("my site is mariacruz.com").reasons).toContain("link");
    expect(scanMessage("Worked there 2019 to 2023.").contactInfo).toBe(false);
  });

  it("meeting links are allowed only on approved hosts", () => {
    expect(isAllowedMeetingHost("https://us02web.zoom.us/j/123", DEFAULT_ALLOWED_MEETING_HOSTS)).toBe(true);
    expect(isAllowedMeetingHost("https://meet.google.com/abc-defg", DEFAULT_ALLOWED_MEETING_HOSTS)).toBe(true);
    expect(isAllowedMeetingHost("https://calendly.com/villanueva/intro", DEFAULT_ALLOWED_MEETING_HOSTS)).toBe(false);
    expect(isAllowedMeetingHost("http://zoom.us/j/1", DEFAULT_ALLOWED_MEETING_HOSTS)).toBe(false);
    expect(isAllowedMeetingHost("https://zoom.us.evil.example/j/1", DEFAULT_ALLOWED_MEETING_HOSTS)).toBe(false);
  });
});

describe("mediated threads", () => {
  it("interview requests get a thread; contact details are masked and flagged by default; staff see the original", async () => {
    await addToShortlist(db, clientA(), ids.maria);
    await addToShortlist(db, clientA(), ids.leo);
    ids.requestId = await createInterviewRequest(db, clientA(), { candidateIds: [ids.maria, ids.leo], timezone: "America/Los_Angeles", role: "Appointment Setter", requestedWindows: "Tue 9-11am PST\nWed 2-4pm PST" });
    const thread = await db.messageThread.findUniqueOrThrow({ where: { interviewRequestId: ids.requestId } });
    expect(thread.kind).toBe("INTERVIEW_REQUEST");
    expect(((await getRequest(db, clientA(), ids.requestId)).request as { requestedWindows: string[] }).requestedWindows).toEqual(["Tue 9-11am PST", "Wed 2-4pm PST"]);

    const r = await postMessage(db, clientA(), ids.requestId, `Can Maria text me at +1 555 010 0199 or jordan@acme-solar.example? Also see acme-solar.com/brief. Thanks from ${AGENCY}'s future client.`);
    expect(r.held).toBe(false);
    expect(r.masked).toBe(true);
    expect(r.reasons).toEqual(expect.arrayContaining(["phone number", "email address", "link"]));
    const forStaff = await listMessages(db, sales(), ids.requestId);
    expect(forStaff[0].body).not.toContain("555");
    expect(forStaff[0].body).toContain("[removed]");
    expect(forStaff[0].originalBody).toContain("+1 555 010 0199");
    expect(forStaff[0].masked).toBe(true);
    const forClient = await listMessages(db, clientA(), ids.requestId);
    expect(forClient[0].originalBody).toBeNull();
    expect(forClient[0].mine).toBe(true);
    // Agency agents never see client messages directly (CLIENT_AND_HIREWISE).
    expect(await listMessages(db, maria(), ids.requestId)).toEqual([]);
    expect(await db.activityFlag.count({ where: { userId: ids.userA, rule: "CONTACT_INFO_IN_MESSAGE" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "MESSAGE_MASKED" } })).toBe(1);
    expect(await listHeldMessages(db, sales())).toEqual([]);
    const masked = await listMaskedMessages(db, sales());
    expect(masked.length).toBe(1);
    await expect(listMaskedMessages(db, makeActor("RECRUITER"))).rejects.toThrow(ForbiddenError);
    await drain();
    expect(await db.notification.count({ where: { userId: ids.sales, type: "MESSAGE_POSTED" } })).toBe(1);
  });

  it("BLOCK mode holds the message as before; release delivers it; closed threads refuse posts", async () => {
    await setSetting(db, superAdmin(), "messaging", { contactDetails: "BLOCK", flagRateTalk: true });
    const r = await postMessage(db, maria(), ids.requestId, "WhatsApp me on 0917 123 4567 to set it up.");
    expect(r.held).toBe(true);
    expect(r.masked).toBe(false);
    const held = await listHeldMessages(db, sales());
    expect(held.length).toBe(1);
    expect(held[0].requestId).toBe(ids.requestId);
    expect((await listMessages(db, clientA(), ids.requestId)).some((m) => m.id === r.id)).toBe(false);
    await reviewHeldMessage(db, sales(), r.id, "BLOCK");
    expect((await listMessages(db, sales(), ids.requestId)).find((m) => m.id === r.id)?.blocked).toBe(true);
    await setSetting(db, superAdmin(), "messaging", { contactDetails: "MASK", flagRateTalk: true });
    const rate = await postMessage(db, leo(), ids.requestId, "What is your hourly rate for this campaign?");
    expect(rate.rateTalk).toBe(true);
    expect(rate.held).toBe(false);
    expect(await db.activityFlag.count({ where: { userId: ids.leoUser, rule: "RATE_DISCUSSION_IN_MESSAGE" } })).toBe(1);
  });

  it("Partner Team enquiries and support threads: tenant scope, participation, labels", async () => {
    const t = await openEnquiryThread(db, clientA(), ids.code.toLowerCase());
    expect((await openEnquiryThread(db, clientA(), ids.code)).id).toBe(t.id); // one open enquiry per client and team
    await postToThread(db, clientA(), t.id, "Do you have Spanish-speaking setters available in November?");
    await postToThread(db, sales(), t.id, "Yes, two; the team owner will confirm.", "ALL");
    await postToThread(db, await owner(), t.id, "Confirmed: two setters, 40 hours a week. Call me on +63 917 000 1111.");
    const clientSide = await listThreadMessages(db, clientA(), t.id);
    expect(clientSide.audience).toBe("CLIENT");
    expect(clientSide.thread.counterpart).toContain("Hirewise Certified Partner Team");
    const labels = clientSide.messages.map((m) => m.authorLabel);
    expect(labels).toContain("Hirewise");
    expect(labels.some((l) => l.includes("Villanueva"))).toBe(false);
    // The owner's message (AGENCY_AND_HIREWISE) is not visible to the client; staff see it masked with the original kept.
    expect(clientSide.messages.length).toBe(2);
    const staffSide = await listThreadMessages(db, sales(), t.id);
    const ownerMsg = staffSide.messages.find((m) => m.authorRole === "AGENCY_OWNER")!;
    expect(ownerMsg.body).toContain("[removed]");
    expect(ownerMsg.originalBody).toContain("917 000 1111");
    const ownerSide = await listThreadMessages(db, await owner(), t.id);
    expect(ownerSide.audience).toBe("AGENCY");
    expect(ownerSide.thread.counterpart).toBe("Healthcare client, United States");
    expect(ownerSide.messages.map((m) => m.authorLabel)).not.toContain("Acme Solar");
    expect(JSON.stringify(clientSide)).not.toContain("Villanueva");
    const keys = collectKeys(clientSide);
    for (const k of FORBIDDEN_FOR_CLIENT) expect(keys.has(k), `forbidden key ${k}`).toBe(false);
    await expect(listThreadMessages(db, clientB(), t.id)).rejects.toThrow(NotFoundError);
    await expect(listThreadMessages(db, maria(), t.id)).rejects.toThrow(NotFoundError);
    await expect(postToThread(db, makeActor("COACH"), t.id, "hi")).rejects.toThrow(NotFoundError);

    const mine = await listMyThreads(db, clientA());
    expect(mine.map((x) => x.kind).sort()).toEqual(["INTERVIEW_REQUEST", "PARTNER_ENQUIRY"]);
    expect((await listMyThreads(db, await owner())).map((x) => x.id)).toEqual([t.id]);
    expect((await listMyThreads(db, maria())).map((x) => x.kind)).toEqual(["INTERVIEW_REQUEST"]);
    const support = await openSupportThread(db, maria());
    expect((await openSupportThread(db, maria())).id).toBe(support.id);
    await expect(closeThread(db, makeActor("RECRUITER"), t.id, "done")).rejects.toThrow(ForbiddenError);
    await closeThread(db, sales(), t.id, "Resolved");
    await expect(postToThread(db, clientA(), t.id, "one more")).rejects.toThrow(/closed/i);
  });
});

describe("interview links", () => {
  it("pasted links outside the allow-list are refused and flagged; approved hosts and participants are recorded", async () => {
    await startSalesReview(db, sales(), ids.requestId);
    await proposeSlots(db, sales(), ids.requestId, "Tuesday 9am PST?");
    await clientConfirmSlots(db, clientA(), ids.requestId, "Tuesday works");
    await candidateRespond(db, maria(), ids.requestId, "CONFIRMED");
    await candidateRespond(db, leo(), ids.requestId, "CONFIRMED");
    const when = new Date(Date.now() + 3 * 86_400_000).toISOString();
    await expect(scheduleInterviews(db, sales(), ids.requestId, { timezone: "America/Los_Angeles", items: [{ agentProfileId: ids.maria, scheduledAt: when, durationMin: 30, meetingLink: "https://calendly.com/villanueva-teams/intro" }] })).rejects.toThrow(/approved host/);
    expect(await db.activityFlag.count({ where: { rule: "MEETING_LINK_REFUSED" } })).toBe(1);
    expect(await db.interview.count({ where: { interviewRequestId: ids.requestId } })).toBe(0);
    await scheduleInterviews(db, sales(), ids.requestId, { timezone: "America/Los_Angeles", items: [{ agentProfileId: ids.maria, scheduledAt: when, durationMin: 30, meetingLink: "https://us02web.zoom.us/j/555", participants: "Jordan (client), Hirewise account manager" }, { agentProfileId: ids.leo, scheduledAt: when, durationMin: 30, meetingLink: "" }] });
    const iv = await db.interview.findFirstOrThrow({ where: { interviewRequestId: ids.requestId, agentProfileId: ids.maria } });
    expect(iv.linkSource).toBe("STAFF_PASTED");
    expect(iv.participants).toEqual([{ label: "Jordan (client)", role: "PARTICIPANT" }, { label: "Hirewise account manager", role: "PARTICIPANT" }]);
    await setSetting(db, superAdmin(), "meetings", { allowedHosts: DEFAULT_ALLOWED_MEETING_HOSTS, requireProvider: true });
    await expect(scheduleInterviews(db, sales(), ids.requestId, { timezone: "America/Los_Angeles", items: [{ agentProfileId: ids.leo, scheduledAt: when, durationMin: 30, meetingLink: "https://zoom.us/j/1" }] })).rejects.toThrow(/provider/);
    await setSetting(db, superAdmin(), "meetings", { allowedHosts: DEFAULT_ALLOWED_MEETING_HOSTS, requireProvider: false });
  });
});

describe("email aliases", () => {
  it("allocates once per owner, shows aliases to clients instead of addresses, and keeps inbound routing off", async () => {
    const a1 = await aliasFor(db, "AGENT_PROFILE", ids.maria);
    expect(a1).toMatch(/^talent\d+@hirewiseconnect\.com$/);
    expect(await aliasFor(db, "AGENT_PROFILE", ids.maria)).toBe(a1);
    const created = await allocateMissingAliases(db);
    expect(created).toBeGreaterThanOrEqual(1); // Leo and the agency
    const teamAlias = await contactAliasFor(db, "AGENCY", ids.agencyA);
    expect(teamAlias).toMatch(/^team\d+@/);
    const view = await getCandidateForClient(db, clientA(), ids.maria);
    expect(view.candidate.contactAlias).toBe(a1);
    expect(JSON.stringify(view)).not.toContain("gmail");
    expect((await partnerTeamsForClient(db, clientA()))[0].contactAlias).toBe(teamAlias);
    expect(await handleInboundEmail(db, { to: a1, from: "jordan@acme-solar.example", subject: "Hi", text: "Call me 555 010 0199" })).toMatchObject({ accepted: false, reason: "inbound routing disabled" });
    await setSetting(db, superAdmin(), "email", { aliasDomain: "hirewiseconnect.com", inboundEnabled: true });
    expect(await handleInboundEmail(db, { to: "nobody@hirewiseconnect.com", from: "jordan@acme-solar.example", subject: null, text: "x" })).toMatchObject({ accepted: false, reason: "unknown alias" });
    expect(await handleInboundEmail(db, { to: a1, from: "stranger@example.com", subject: null, text: "x" })).toMatchObject({ accepted: false, reason: "unknown sender" });
    const posted = await handleInboundEmail(db, { to: a1, from: "jordan@acme-solar.example", subject: "Availability", text: "Can you start Monday? Ring me on 555 010 0199." });
    expect(posted.accepted).toBe(true);
    const msgs = await listThreadMessages(db, sales(), posted.threadId!);
    expect(msgs.thread.kind).toBe("SUPPORT");
    expect(msgs.messages[0].body).toContain("[removed]");
    await setSetting(db, superAdmin(), "email", { aliasDomain: "hirewiseconnect.com", inboundEnabled: false });
  });
});

describe("bypass reports", () => {
  it("anyone signed in can report; staff are notified; nothing changes automatically", async () => {
    await expect(reportBypass(db, clientA(), { description: "too short" })).rejects.toThrow(/at least 10/);
    const r = await reportBypass(db, clientA(), { description: "The agent asked me to continue on WhatsApp and pay her directly.", reportedUserId: ids.mariaUser, relatedType: "InterviewRequest", relatedId: ids.requestId });
    ids.reportId = r.id;
    expect(r.status).toBe("REPORTED");
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: ids.maria } })).status).toBe("APPROVED");
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.mariaUser } })).status).toBe("ACTIVE");
    await drain();
    expect(await db.notification.count({ where: { userId: ids.sales, type: "BYPASS_REPORTED" } })).toBe(1);
    expect(await db.task.count({ where: { type: "REVIEW_BYPASS_REPORT", relatedId: r.id, status: "OPEN" } })).toBe(1);
    expect((await myBypassReports(db, clientA())).map((x) => x.id)).toEqual([r.id]);
    await expect(listBypassReports(db, clientA())).rejects.toThrow(ForbiddenError);
    await expect(getBypassReport(db, clientB(), r.id)).rejects.toThrow(NotFoundError);
    const staffView = await getBypassReport(db, sales(), r.id);
    expect((staffView as { reported: { label: string } }).reported.label).toBe("Maria Santos");
    const reporterView = await getBypassReport(db, clientA(), r.id);
    expect("reported" in reporterView).toBe(false);
    // An agent can report a client too.
    const r2 = await reportBypass(db, leo(), { description: "The client emailed me directly asking to skip Hirewise.", reportedClientId: ids.clientA });
    expect(r2.status).toBe("REPORTED");
  });

  it("the case moves through review to a decision; restrictions apply with a reason and can be lifted; suspension needs user.manage", async () => {
    await expect(decideBypass(db, sales(), ids.reportId, { to: "WARNING_ISSUED", note: "x" })).rejects.toThrow(/cannot move/);
    await decideBypass(db, sales(), ids.reportId, { to: "UNDER_REVIEW" });
    await expect(decideBypass(db, sales(), ids.reportId, { to: "WARNING_ISSUED" })).rejects.toThrow(/note/);
    await decideBypass(db, sales(), ids.reportId, { to: "WARNING_ISSUED", note: "First warning: keep communication on the platform." });
    await drain();
    expect(await db.notification.count({ where: { userId: ids.mariaUser, type: "BYPASS_DECIDED" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: ids.userA, type: "BYPASS_DECIDED" } })).toBe(1);
    const restricted = await decideBypass(db, sales(), ids.reportId, { to: "RESTRICTED", note: "Repeated after warning.", restrictionDays: 14 });
    expect(restricted.status).toBe("RESTRICTED");
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: ids.maria } })).status).toBe("HIDDEN");
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: ids.maria } })).availabilityStatus).toBe("UNAVAILABLE");
    expect((restricted as { restrictionEndsAt: Date | null }).restrictionEndsAt!.getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    await expect(decideBypass(db, sales(), ids.reportId, { to: "SUSPENDED", note: "Suspend" })).rejects.toThrow(ForbiddenError);
    const closed = await decideBypass(db, admin(), ids.reportId, { to: "CLOSED", note: "Restriction served; lifted.", liftRestriction: true });
    expect(closed.status).toBe("CLOSED");
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: ids.maria } })).status).toBe("APPROVED");
    expect(closed.history.map((h) => h.to)).toEqual(["REPORTED", "UNDER_REVIEW", "WARNING_ISSUED", "RESTRICTED", "CLOSED"]);
    expect(await db.auditLog.count({ where: { action: "BYPASS_STATUS_CHANGED", entityId: ids.reportId } })).toBe(4);
    await expect(db.bypassReportEvent.deleteMany({ where: { reportId: ids.reportId } })).rejects.toThrow(/append-only/);
    await drain();
    expect(await db.task.count({ where: { type: "REVIEW_BYPASS_REPORT", relatedId: ids.reportId, status: "OPEN" } })).toBe(0);
    expect((await listBypassReports(db, sales(), "OPEN")).map((x) => x.id)).not.toContain(ids.reportId);
  });
});
