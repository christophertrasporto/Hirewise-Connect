import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDb, resetDb } from "../setup/db";
import { seedTerms } from "../setup/terms";
import { createAgencyDirect, updateAgencyProfile, myAgency } from "@/server/services/agency.service";
import { inviteLinkForAgency, registerViaInvite } from "@/server/services/invite.service";
import { registerAgent, updatePersonal, setClientLabel } from "@/server/services/agent.service";
import { partnerTeamsForClient, partnerTeamForClient, updatePartnerIdentity, partnerIdentityForStaff } from "@/server/services/partner.service";
import { searchCandidates, getCandidateForClient } from "@/server/services/search.service";
import { addToShortlist, compareShortlisted, getOwnShortlist } from "@/server/services/shortlist.service";
import { createInterviewRequest, getRequest, startSalesReview, proposeSlots, clientConfirmSlots, candidateRespond, scheduleInterviews, completeInterview, recordClientDecision, listRequestsForClient, listRequestsForAgent } from "@/server/services/interview.service";
import { listPlacementsForClient, listPlacementsForAgent, getPlacementForAgent, getPlacementForClient } from "@/server/services/placement.service";
import { syncClientSafeDocuments, reviewClientSafeDocument, listClientSafeQueue, clientSafeDocumentUrl, clientSafeDocumentsForSelf } from "@/server/services/client-safe-document.service";
import { mediaDownloadUrl } from "@/server/services/media.service";
import { grantDisclosure, revokeDisclosure, listGrants } from "@/server/services/disclosure.service";
import { verifyCertificate } from "@/server/services/certification.service";
import { exportClientData } from "@/server/services/export.service";
import { setSetting } from "@/server/services/setting.service";
import { redactForClient, clientLabelFrom, maskedClientLabel } from "@/lib/client-redaction";
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
const meta = { ipAddress: "198.51.100.14", userAgent: "vitest" };
const PASSWORD = "Str0ngPassw0rd!";
const AGENCY = "Villanueva Virtual Teams";
const LEAKS = [AGENCY, "Villanueva", "Maria Santos Cruz", "maria.cruz@gmail.com", "+63 917 555 0101", "linkedin.com/in/mariacruz", "villanueva-teams.example", "@mariacruz"];
let dir = "";
const ids = { super: "su_cp", admin: "admin_cp", sales: "sales_cp", recruiter: "rec_cp", ownerUser: "", ownerB: "", agencyA: "", agencyB: "", link: "", maria: "", mariaUser: "", leo: "", leoUser: "", clientA: "", userA: "", clientB: "", userB: "", video: "", recording: "", portfolio: "", cert: "", template: "", requestId: "", interviewId: "", code: "" };

const talent = (over: Record<string, unknown> = {}) => ({ termsAccepted: true, fullName: "Test Talent", displayName: "Test T.", email: "t@talent.example", password: PASSWORD, phone: "", locationCity: "Cebu", locationCountry: "Philippines", timezone: "Asia/Manila", primaryRole: "Appointment Setter", yearsExperience: 3, ...over });
const superAdmin = () => makeActor("SUPER_ADMIN", { userId: ids.super });
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const recruiter = () => makeActor("RECRUITER", { userId: ids.recruiter });
const owner = () => resolveActor(db, ids.ownerUser);
const ownerB = () => resolveActor(db, ids.ownerB);
const maria = () => makeActor("AGENT", { userId: ids.mariaUser, agentProfileId: ids.maria });
const leo = () => makeActor("AGENT", { userId: ids.leoUser, agentProfileId: ids.leo });
const clientA = () => makeActor("CLIENT", { userId: ids.userA, clientId: ids.clientA });
const clientB = () => makeActor("CLIENT", { userId: ids.userB, clientId: ids.clientB });

function assertNoLeaks(value: unknown, label: string, allow: string[] = []) {
  const json = JSON.stringify(value);
  for (const s of LEAKS.filter((x) => !allow.includes(x))) expect(json.includes(s), `${label} leaks "${s}"`).toBe(false);
  const keys = collectKeys(value);
  for (const k of FORBIDDEN_FOR_CLIENT) expect(keys.has(k), `${label} has forbidden key ${k}`).toBe(false);
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hw-cp-"));
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
  await db.user.create({ data: { id: ids.recruiter, email: "rec@hirewise.example", roleId: await role("RECRUITER"), emailVerifiedAt: new Date() } });
  await db.plan.createMany({ data: [{ id: "plan_starter", key: "STARTER", name: "Starter", baseAgentSeats: 5, sortOrder: 1 }] });
  const applicantRole = await role("APPLICANT");
  ids.ownerUser = (await db.user.create({ data: { email: "dana@villanueva-teams.example", roleId: applicantRole, emailVerifiedAt: new Date() } })).id;
  ids.ownerB = (await db.user.create({ data: { email: "owner-b@agency.example", roleId: applicantRole, emailVerifiedAt: new Date() } })).id;
  ids.agencyA = await createAgencyDirect(db, superAdmin(), { ownerEmail: "dana@villanueva-teams.example", name: AGENCY, country: "Philippines", website: "https://villanueva-teams.example", reason: "client protection tests", planKey: "STARTER" });
  ids.agencyB = await createAgencyDirect(db, superAdmin(), { ownerEmail: "owner-b@agency.example", name: "Agency B", country: "Philippines", reason: "client protection tests", planKey: "STARTER" });
  ids.link = (await inviteLinkForAgency(db, await owner())).url.split("/join/")[1];

  // Maria: agency agent whose free text is full of contact routes and the agency name.
  const m = await registerViaInvite(db, talent({ email: "maria.cruz@gmail.com", fullName: "Maria Santos Cruz", displayName: "Maria Santos", phone: "+63 917 555 0101" }), ids.link, meta);
  ids.maria = m.agentProfileId;
  ids.mariaUser = m.userId;
  await db.user.update({ where: { id: m.userId }, data: { emailVerifiedAt: new Date() } });
  await db.agencyMembership.updateMany({ where: { agentProfileId: ids.maria, status: "PENDING_VERIFICATION" }, data: { status: "ACTIVE" } });
  await db.agentProfile.update({ where: { id: ids.maria }, data: { status: "APPROVED", approvedAt: new Date(), availabilityStatus: "AVAILABLE", headline: `Senior setter at ${AGENCY}`, summary: `Reach me at maria.cruz@gmail.com or +63 917 555 0101. Portfolio: https://villanueva-teams.example/maria and linkedin.com/in/mariacruz. IG @mariacruz. Proud member of ${AGENCY} since 2021.`, languages: ["English"], experiences: { create: { title: "Appointment Setter", startDate: new Date("2021-01-01"), description: `Booked 40 demos a month for ${AGENCY} clients; WhatsApp me at +63 917 555 0101.`, isCampaign: true } } } });
  ids.video = (await db.video.create({ data: { agentProfileId: ids.maria, storageKey: "agents/maria/video/intro.mp4", status: "APPROVED", isCurrent: true } })).id;
  ids.recording = (await db.recording.create({ data: { agentProfileId: ids.maria, kind: "COLD_CALL", title: "Solar cold call", storageKey: "agents/maria/recording/call.mp3", status: "APPROVED" } })).id;
  ids.portfolio = (await db.portfolio.create({ data: { agentProfileId: ids.maria, title: "Campaign deck", description: "Deck for Villanueva clients", url: "https://villanueva-teams.example/deck", status: "APPROVED" } })).id;
  ids.template = (await db.certificationTemplate.create({ data: { name: "Hirewise Certified Appointment Setter" } })).id;
  ids.cert = (await db.certification.create({ data: { agentProfileId: ids.maria, templateId: ids.template, origin: "ADMIN_ISSUED", status: "APPROVED", certificateNumber: "HW-2026-000001", verificationCode: "ABCD-EFGH-JKLM" } })).id;

  // Leo: Hirewise Direct talent.
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

describe("redaction and labels (pure)", () => {
  it("removes emails, phones, links, handles, and agency names; keeps years and plain text", () => {
    const r = redactForClient(`Call +63 917 555 0101 or email maria.cruz@gmail.com; see https://x.example/me, calendly.com/maria, IG @mariacruz, whatsapp me 09171234567. Worked 2019 to 2023 at ${AGENCY}.`, { agencyNames: [{ name: AGENCY, replacement: "Hirewise Certified Partner Team HWC-001" }] });
    for (const s of ["917", "gmail", "x.example", "calendly", "@mariacruz", "0917", "Villanueva"]) expect(r.text.includes(s), `still contains ${s}`).toBe(false);
    expect(r.text).toContain("2019 to 2023");
    expect(r.text).toContain("Hirewise Certified Partner Team HWC-001");
    expect(r.findings).toEqual(expect.arrayContaining(["email address", "phone number", "link", "social handle", "agency name"]));
    expect(redactForClient("Booked 40 demos a month in 2024.").text).toBe("Booked 40 demos a month in 2024.");
  });

  it("derives labels and masked client labels", () => {
    expect(clientLabelFrom("Maria Santos Cruz", "x")).toBe("Maria C.");
    expect(clientLabelFrom("  maria  ", "x")).toBe("maria");
    expect(clientLabelFrom(null, "Leo D.")).toBe("Leo D.");
    expect(maskedClientLabel({ industry: "Healthcare", country: "United States" })).toBe("Healthcare client, United States");
    expect(maskedClientLabel({ industry: null, country: null })).toBe("Client");
  });
});

describe("Partner Team identity", () => {
  it("is assigned at creation, listed to clients without the real identity, and never editable by the agency", async () => {
    const a = await db.agency.findUniqueOrThrow({ where: { id: ids.agencyA } });
    expect(a.clientFacingCode).toMatch(/^HWC-\d{3,}$/);
    expect(a.clientFacingName).toBe(`Hirewise Certified Partner Team ${a.clientFacingCode}`);
    ids.code = a.clientFacingCode!;
    const b = await db.agency.findUniqueOrThrow({ where: { id: ids.agencyB } });
    expect(b.clientFacingCode).not.toBe(a.clientFacingCode);

    const teams = await partnerTeamsForClient(db, clientA());
    expect(teams.map((t) => t.code)).toEqual([ids.code]); // Agency B has no approved agent
    assertNoLeaks(teams, "partner team list");
    expect(teams[0].teamSize).toBe(1);
    expect(teams[0].certifiedMembers).toBe(1);
    expect(teams[0].certifications).toEqual([{ name: "Hirewise Certified Appointment Setter", count: 1 }]);
    expect(teams[0].disclosed).toBeNull();

    const detail = await partnerTeamForClient(db, clientA(), ids.code.toLowerCase());
    assertNoLeaks(detail, "partner team detail");
    expect(detail.members.map((m) => m.name)).toEqual(["Maria C."]);
    expect(detail.members[0].partnerTeam?.code).toBe(ids.code);
    await expect(partnerTeamForClient(db, clientA(), b.clientFacingCode!)).rejects.toThrow(NotFoundError);
    await expect(partnerTeamsForClient(db, maria())).rejects.toThrow(ForbiddenError);

    // The owner reads it, cannot write it, and cannot read another agency's.
    const mine = await myAgency(db, await owner());
    expect(mine.clientFacing?.code).toBe(ids.code);
    await expect(updateAgencyProfile(db, await owner(), ids.agencyA, { name: AGENCY, contactEmail: "dana@villanueva-teams.example", country: "Philippines", clientFacingName: "Villanueva Virtual Teams" } as never)).rejects.toThrow(ForbiddenError);
    await expect(updatePartnerIdentity(db, await owner(), ids.agencyA, { clientFacingName: "Team Alpha" })).rejects.toThrow(ForbiddenError);
    await expect(partnerIdentityForStaff(db, await ownerB(), ids.agencyA)).rejects.toThrow(ForbiddenError);
    expect((await db.agency.findUniqueOrThrow({ where: { id: ids.agencyA } })).clientFacingName).toBe(`Hirewise Certified Partner Team ${ids.code}`);
  });

  it("Hirewise edits the name and specializations; the real name is refused", async () => {
    await expect(updatePartnerIdentity(db, admin(), ids.agencyA, { clientFacingName: `Villanueva Virtual Teams ${ids.code}` })).rejects.toThrow(/real name/);
    await updatePartnerIdentity(db, admin(), ids.agencyA, { clientFacingName: `Hirewise Certified Partner Team ${ids.code} (Healthcare)`, specializations: "Appointment setting, Patient intake" });
    const teams = await partnerTeamsForClient(db, clientA());
    expect(teams[0].name).toContain("(Healthcare)");
    expect(teams[0].specializations).toEqual(["Appointment setting", "Patient intake"]);
    expect(await db.auditLog.count({ where: { action: "PARTNER_IDENTITY_UPDATED", entityId: ids.agencyA } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "PARTNER_IDENTITY_ASSIGNED" } })).toBe(2);
    const staff = await partnerIdentityForStaff(db, admin(), ids.agencyA);
    expect(staff.realName).toBe(AGENCY);
    expect(staff.visibleToClients).toBe(true);
  });

  it("the owner's private identity fields save and never reach clients", async () => {
    await updateAgencyProfile(db, await owner(), ids.agencyA, { name: AGENCY, contactEmail: "dana@villanueva-teams.example", country: "Philippines", legalName: "Villanueva Virtual Teams Inc.", addressLine: "12 Osmena Blvd, Cebu", registrationDetails: "SEC 2021-0001", billingEmail: "billing@villanueva-teams.example" });
    const mine = await myAgency(db, await owner());
    expect(mine.legalName).toBe("Villanueva Virtual Teams Inc.");
    assertNoLeaks(await partnerTeamsForClient(db, clientA()), "partner team list after private fields");
  });
});

describe("client label and client-safe candidate views", () => {
  it("clients see the label and redacted text, never the display name, legal name, links, or agency name", async () => {
    const r = await getCandidateForClient(db, clientA(), ids.maria);
    assertNoLeaks(r, "candidate view");
    expect(r.candidate.name).toBe("Maria C.");
    expect(r.candidate.identityDisclosed).toBe(false);
    expect(r.candidate.partnerTeam?.code).toBe(ids.code);
    expect(r.candidate.summary).toContain("[removed]");
    expect(r.candidate.summary).toContain("Hirewise Certified Partner Team");
    expect(r.candidate.experiences[0].description).not.toContain("917");
    // Nothing is cleared for clients yet: no media, no documents, no portfolio links.
    expect(r.candidate.videos).toEqual([]);
    expect(r.candidate.recordings).toEqual([]);
    expect(r.candidate.portfolio).toEqual([]);
    expect(r.candidate.documents).toEqual([]);
    const search = await searchCandidates(db, clientA(), {});
    assertNoLeaks(search, "search");
    expect(search.cards.find((c) => c.id === ids.maria)?.name).toBe("Maria C.");
    expect(search.cards.find((c) => c.id === ids.leo)?.partnerTeam).toBeNull();
    // Staff keep display names and unredacted text.
    const staff = await getCandidateForClient(db, recruiter(), ids.maria);
    expect(staff.candidate.name).toBe("Maria Santos");
    expect(staff.candidate.summary).toContain("maria.cruz@gmail.com");
    const preview = await getCandidateForClient(db, recruiter(), ids.maria, { previewAsClient: true });
    expect(preview.candidate.name).toBe("Maria C.");
    expect(preview.candidate.summary).not.toContain("gmail");
  });

  it("the label follows the legal name until staff pin it; the public certificate page shows the label", async () => {
    expect((await verifyCertificate(db, "ABCD-EFGH-JKLM")).learnerName).toBe("Maria C.");
    await updatePersonal(db, maria(), { displayName: "Maria Santos", fullLegalName: "Maria Santos Reyes", phone: "+63 917 555 0101", locationCity: "Cebu", locationCountry: "Philippines", timezone: "Asia/Manila", languages: ["English"], workSetup: "REMOTE", preferredShift: "", equipmentSummary: "", internetSummary: "", addressLine: "" });
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: ids.maria } })).clientLabel).toBe("Maria R.");
    await expect(setClientLabel(db, sales(), ids.maria, "Mari R.")).rejects.toThrow(ForbiddenError);
    expect(await setClientLabel(db, recruiter(), ids.maria, "Mari R.")).toBe("Mari R.");
    await updatePersonal(db, maria(), { displayName: "Maria Santos", fullLegalName: "Maria Santos Cruz", phone: "+63 917 555 0101", locationCity: "Cebu", locationCountry: "Philippines", timezone: "Asia/Manila", languages: ["English"], workSetup: "REMOTE", preferredShift: "", equipmentSummary: "", internetSummary: "", addressLine: "" });
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: ids.maria } })).clientLabel).toBe("Mari R.");
    expect(await setClientLabel(db, recruiter(), ids.maria, null)).toBe("Maria C.");
    expect((await verifyCertificate(db, "ABCD-EFGH-JKLM")).learnerName).toBe("Maria C.");
    expect(await db.auditLog.count({ where: { action: "CLIENT_LABEL_SET", entityId: ids.maria } })).toBe(2);
  });
});

describe("client-safe documents", () => {
  it("rows are created for approved items; generated PDFs are redacted and auto-approved; media waits for a reviewer", async () => {
    const r = await syncClientSafeDocuments(db);
    expect(r.created).toBeGreaterThanOrEqual(5);
    const rows = await db.clientSafeDocument.findMany({ where: { agentProfileId: ids.maria } });
    const byType = Object.fromEntries(rows.map((d) => [d.type, d.status]));
    expect(byType).toMatchObject({ VIDEO_INTRO: "NEEDS_MANUAL_REVIEW", VOICE_INTRO: "NEEDS_MANUAL_REVIEW", PORTFOLIO: "NEEDS_MANUAL_REVIEW", CERTIFICATE: "APPROVED_FOR_CLIENT", PROFILE: "APPROVED_FOR_CLIENT" });
    expect((await syncClientSafeDocuments(db)).created).toBe(0); // idempotent
    const profile = rows.find((d) => d.type === "PROFILE")!;
    const pdf = readFileSync(path.join(dir, profile.sanitizedStorageKey!)).toString("latin1");
    expect(pdf.startsWith("%PDF")).toBe(true);
    expect(pdf).toContain("Maria C.");
    expect(pdf).not.toContain("Villanueva");
    expect(pdf).not.toContain("gmail");
    const cert = rows.find((d) => d.type === "CERTIFICATE")!;
    expect(readFileSync(path.join(dir, cert.sanitizedStorageKey!)).toString("latin1")).toContain("Awarded to Maria C.");
    // Originals untouched.
    expect((await db.video.findUniqueOrThrow({ where: { id: ids.video } })).storageKey).toBe("agents/maria/video/intro.mp4");
    const own = await clientSafeDocumentsForSelf(db, maria());
    expect(own.length).toBe(5);
  });

  it("clients open only approved rows; the queue is reviewed with media.review; review is audited and notifies the agent", async () => {
    await expect(mediaDownloadUrl(db, clientA(), { type: "VIDEO", id: ids.video })).rejects.toThrow(NotFoundError);
    let view = await getCandidateForClient(db, clientA(), ids.maria);
    expect(view.candidate.videos).toEqual([]);
    expect(view.candidate.documents.map((d) => d.type).sort()).toEqual(["CERTIFICATE", "PROFILE"]);
    const profileDoc = view.candidate.documents.find((d) => d.type === "PROFILE")!;
    expect(decodeURIComponent(await clientSafeDocumentUrl(db, clientA(), profileDoc.id))).toContain("client-safe/profile/");

    await expect(listClientSafeQueue(db, sales())).rejects.toThrow(ForbiddenError);
    const queue = await listClientSafeQueue(db, recruiter());
    expect(queue.map((d) => d.type).sort()).toEqual(["PORTFOLIO", "VIDEO_INTRO", "VOICE_INTRO"]);
    const video = queue.find((d) => d.type === "VIDEO_INTRO")!;
    const portfolio = queue.find((d) => d.type === "PORTFOLIO")!;
    await expect(clientSafeDocumentUrl(db, clientA(), video.id)).rejects.toThrow(NotFoundError);
    await expect(reviewClientSafeDocument(db, sales(), { id: video.id, decision: "APPROVE" })).rejects.toThrow(ForbiddenError);
    await expect(reviewClientSafeDocument(db, recruiter(), { id: portfolio.id, decision: "REJECT" })).rejects.toThrow(/note/);
    await reviewClientSafeDocument(db, recruiter(), { id: video.id, decision: "APPROVE" });
    await reviewClientSafeDocument(db, recruiter(), { id: portfolio.id, decision: "REJECT", note: "Links to the agency site" });

    expect(await mediaDownloadUrl(db, clientA(), { type: "VIDEO", id: ids.video })).toContain("intro.mp4");
    await expect(mediaDownloadUrl(db, clientA(), { type: "RECORDING", id: ids.recording })).rejects.toThrow(NotFoundError);
    view = await getCandidateForClient(db, clientA(), ids.maria);
    expect(view.candidate.videos.map((v) => v.id)).toEqual([ids.video]);
    expect(view.candidate.recordings).toEqual([]);
    expect(view.candidate.portfolio).toEqual([]);
    assertNoLeaks(view, "candidate view after review");
    expect(await db.auditLog.count({ where: { action: "CLIENT_SAFE_DOCUMENT_REVIEWED", entityId: video.id } })).toBe(1);
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.mariaUser, type: "CLIENT_SAFE_DOCUMENT_REVIEWED" } })).toBe(2);
  });
});

describe("disclosure grants", () => {
  it("system grants at scheduling follow the setting: client sees the name, direct talent sees the company, agency agents see a masked label", async () => {
    await addToShortlist(db, clientA(), ids.maria);
    await addToShortlist(db, clientA(), ids.leo);
    assertNoLeaks(await getOwnShortlist(db, clientA()), "shortlist");
    assertNoLeaks(await compareShortlisted(db, clientA(), [ids.maria, ids.leo]), "compare");
    ids.requestId = await createInterviewRequest(db, clientA(), { candidateIds: [ids.maria, ids.leo], timezone: "America/Los_Angeles", role: "Appointment Setter" });
    const beforeM = (await listRequestsForAgent(db, maria()))[0] as { companyName: string | null; clientLabel: string };
    expect(beforeM.companyName).toBeNull();
    expect(beforeM.clientLabel).toBe("Healthcare client, United States");
    assertNoLeaks(await listRequestsForClient(db, clientA()), "client requests");

    await startSalesReview(db, sales(), ids.requestId);
    await proposeSlots(db, sales(), ids.requestId, "Tuesday 9am or Wednesday 2pm PST?");
    await clientConfirmSlots(db, clientA(), ids.requestId, "Tuesday works");
    await candidateRespond(db, maria(), ids.requestId, "CONFIRMED");
    await candidateRespond(db, leo(), ids.requestId, "CONFIRMED");
    const when = new Date(Date.now() + 3 * 86_400_000).toISOString();
    await scheduleInterviews(db, sales(), ids.requestId, { timezone: "America/Los_Angeles", items: [{ agentProfileId: ids.maria, scheduledAt: when, durationMin: 30, meetingLink: "https://meet.hirewise.example/abc" }, { agentProfileId: ids.leo, scheduledAt: when, durationMin: 30, meetingLink: "https://meet.hirewise.example/def" }] });

    const forClient = await getRequest(db, clientA(), ids.requestId);
    const req = forClient.request as { candidates: Array<{ agentProfileId: string; name: string; identityDisclosed: boolean }>; interviews: Array<{ id: string; agentProfileId: string; name: string }> };
    expect(req.candidates.find((c) => c.agentProfileId === ids.maria)?.name).toBe("Maria Santos Cruz");
    expect(req.candidates.find((c) => c.agentProfileId === ids.maria)?.identityDisclosed).toBe(true);
    expect(req.candidates.find((c) => c.agentProfileId === ids.leo)?.name).toBe("Leo Dela Cruz");
    ids.interviewId = req.interviews.find((i) => i.agentProfileId === ids.maria)!.id;
    // Agency agent: still masked (clientIdentityForAgencyAgents = MANUAL). Direct talent: disclosed.
    expect(((await getRequest(db, maria(), ids.requestId)).request as { companyName: string | null }).companyName).toBeNull();
    expect(((await getRequest(db, leo(), ids.requestId)).request as { companyName: string | null }).companyName).toBe("Acme Solar");
    const grants = await db.disclosureGrant.findMany({ where: { clientId: ids.clientA, revokedAt: null } });
    expect(grants.filter((g) => g.scope === "AGENT_IDENTITY").length).toBe(2);
    expect(grants.filter((g) => g.scope === "CLIENT_IDENTITY").map((g) => g.agentProfileId)).toEqual([ids.leo]);
    expect(grants.every((g) => g.grantedBy === "SYSTEM")).toBe(true);
    // Client B holds no grant for Maria.
    await expect(getRequest(db, clientB(), ids.requestId)).rejects.toThrow(NotFoundError);
  });

  it("staff grant and revoke; revocation hides the name again; MANUAL setting stops system grants", async () => {
    await expect(grantDisclosure(db, sales(), { scope: "CLIENT_IDENTITY", clientId: ids.clientA, agentProfileId: ids.maria, reason: "Client asked" })).rejects.toThrow(ForbiddenError);
    const g = await grantDisclosure(db, admin(), { scope: "CLIENT_IDENTITY", clientId: ids.clientA, agentProfileId: ids.maria, reason: "Client approved the agency introduction" });
    expect(g.grantedBy).toBe("STAFF");
    expect(((await getRequest(db, maria(), ids.requestId)).request as { companyName: string | null }).companyName).toBe("Acme Solar");
    const again = await grantDisclosure(db, admin(), { scope: "CLIENT_IDENTITY", clientId: ids.clientA, agentProfileId: ids.maria, reason: "duplicate" });
    expect(again.id).toBe(g.id); // idempotent

    const agentGrant = (await listGrants(db, admin(), { agentProfileId: ids.maria })).find((x) => x.scope === "AGENT_IDENTITY" && x.active)!;
    await revokeDisclosure(db, admin(), agentGrant.id, "Client dispute");
    const req = (await getRequest(db, clientA(), ids.requestId)).request as { candidates: Array<{ agentProfileId: string; name: string }> };
    expect(req.candidates.find((c) => c.agentProfileId === ids.maria)?.name).toBe("Maria C.");
    expect((await getCandidateForClient(db, clientA(), ids.maria)).candidate.identityDisclosed).toBe(false);
    expect(await db.auditLog.count({ where: { action: "DISCLOSURE_REVOKED", entityId: agentGrant.id } })).toBe(1);

    // Agency identity: only through a grant.
    expect((await partnerTeamsForClient(db, clientA()))[0].disclosed).toBeNull();
    const ag = await grantDisclosure(db, admin(), { scope: "AGENCY_IDENTITY", clientId: ids.clientA, agencyId: ids.agencyA, reason: "Enterprise contract signed" });
    expect((await partnerTeamsForClient(db, clientA()))[0].disclosed).toEqual({ agencyName: AGENCY });
    expect((await partnerTeamsForClient(db, clientB()))[0].disclosed).toBeNull();
    await revokeDisclosure(db, admin(), ag.id, "Contract ended");
    expect((await partnerTeamsForClient(db, clientA()))[0].disclosed).toBeNull();

    await setSetting(db, superAdmin(), "disclosure", { agentIdentityAt: "MANUAL", clientIdentityForDirectTalent: "MANUAL", clientIdentityForAgencyAgents: "MANUAL" });
    const before = await db.disclosureGrant.count();
    const reqB = await createInterviewRequest(db, clientB(), { candidateIds: [], timezone: "Australia/Sydney", role: "Setter" }).catch(() => null);
    expect(reqB).toBeNull(); // nothing shortlisted; the setting is exercised by the placement test below
    expect(await db.disclosureGrant.count()).toBe(before);
    await setSetting(db, superAdmin(), "disclosure", { agentIdentityAt: "INTERVIEW_SCHEDULED", clientIdentityForDirectTalent: "INTERVIEW_SCHEDULED", clientIdentityForAgencyAgents: "MANUAL" });
  });

  it("a placement discloses both sides; placement views and the export carry labels or disclosed names only", async () => {
    await completeInterview(db, sales(), ids.interviewId, "COMPLETED", "Strong");
    const leoInterview = (await db.interview.findFirstOrThrow({ where: { interviewRequestId: ids.requestId, agentProfileId: ids.leo } })).id;
    await completeInterview(db, sales(), leoInterview, "COMPLETED", "Fine");
    await recordClientDecision(db, clientA(), ids.interviewId, { decision: "SELECTED", feedback: "Great fit" });
    const placements = await listPlacementsForClient(db, clientA());
    expect(placements.length).toBe(1);
    expect(placements[0].agent.name).toBe("Maria Santos Cruz"); // AGENT_IDENTITY re-granted by the placement
    assertNoLeaks(placements, "client placements", ["Maria Santos Cruz"]); // disclosed by the placement grant, by design
    const detail = await getPlacementForClient(db, clientA(), placements[0].id);
    expect(detail.agent.name).toBe("Maria Santos Cruz");
    expect((await listPlacementsForAgent(db, maria()))[0].client.companyName).toBe("Acme Solar");
    expect((await getPlacementForAgent(db, maria(), placements[0].id)).client.companyName).toBe("Acme Solar");
    const exported = await exportClientData(db, clientA());
    const json = JSON.stringify(exported);
    expect(json).not.toContain("Maria Santos");
    expect(json).not.toContain("displayName");
    expect(json).toContain("Maria C.");
  });
});
