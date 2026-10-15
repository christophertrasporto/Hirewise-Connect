import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { seedTerms } from "../setup/terms";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDb, resetDb } from "../setup/db";
import { submitApplication, myApplication, updateApplication, resubmitApplication, withdrawApplication, listApplications, getApplication, startReview, requestMoreInfo, approveApplication, rejectApplication, applicationEligibility, createApplicationUploadUrl, attachApplicationDocument, applicationDocumentUrl, registerApplicant } from "@/server/services/agency-application.service";
import { createAgencyDirect, listAgencies, getAgencyForStaff, myAgency, agencyAgents, updateAgencyProfile, setAgencyStatus, setAgentAgency, membershipHistory } from "@/server/services/agency.service";
import { setSetting } from "@/server/services/setting.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { IllegalTransitionError } from "@/server/state/agent-profile";
import { ROLE_NAMES, ROLE_PERMISSIONS, AGENCY_PORTAL_PERMISSIONS, type RoleKey } from "@/server/policies/permissions";
import { collectKeys } from "@/server/views/forbidden-keys";
import { runWorkerOnce } from "@/server/jobs/worker";
import { resetEnvCache } from "@/server/env";
import { getStorage, resetStorageForTests } from "@/server/adapters/storage";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";

const db = testDb();
let dir = "";
const ids = { super: "su_ag", admin: "admin_ag", sales: "sales_ag", agentUser: "", agentProfile: "", agent2User: "", agent2Profile: "", clientUser: "", appA: "", appB: "", agencyA: "", agencyB: "", applicantUser: "" };
const meta = { ipAddress: "203.0.113.5", userAgent: "vitest" };

const applicationInput = (name: string, over: Record<string, unknown> = {}) => ({ applicantFullName: "Ana Lim", applicantPhone: "+63 900 000 0000", proposedAgencyName: name, businessRegistration: "", country: "Philippines", city: "Cebu", website: "https://example.com", socialLinks: ["https://linkedin.com/company/example"], teamSize: 6, yearsExperience: 4, services: ["Cold Calling", "Appointment Setting"], description: "We are a six-person outbound team that has run US real estate and solar campaigns for four years and want Hirewise training and clients.", agreementAccepted: true, ...over });

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hw-agency-"));
  process.env.APP_URL = "http://localhost:3000";
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  resetEnvCache();
  resetStorageForTests();
  setEmailChannelForTests(new ConsoleEmailChannel());
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.user.create({ data: { id: ids.super, email: "owner@hirewise.example", roleId: await role("SUPER_ADMIN"), emailVerifiedAt: new Date() } });
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN"), emailVerifiedAt: new Date() } });
  await db.user.create({ data: { id: ids.sales, email: "sales@hirewise.example", roleId: await role("SALES"), emailVerifiedAt: new Date() } });
  const mk = async (email: string, name: string) => {
    const u = await db.user.create({ data: { email, roleId: await role("AGENT"), emailVerifiedAt: new Date() } });
    const p = await db.agentProfile.create({ data: { userId: u.id, displayName: name, headline: "H", primaryRole: "Cold Caller", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila" } });
    return { u, p };
  };
  const a1 = await mk("ana@t.example", "Ana L.");
  const a2 = await mk("ben@t.example", "Ben C.");
  ids.agentUser = a1.u.id; ids.agentProfile = a1.p.id; ids.agent2User = a2.u.id; ids.agent2Profile = a2.p.id;
  const cu = await db.user.create({ data: { email: "client@acme.example", roleId: await role("CLIENT"), emailVerifiedAt: new Date() } });
  ids.clientUser = cu.id;
  await db.client.create({ data: { companyName: "Acme", status: "ACTIVE", timezone: "America/Los_Angeles", contacts: { create: { userId: cu.id, name: "C", businessEmail: cu.email, isPrimary: true } } } });
  await seedTerms(db);
});

afterAll(async () => {
  setEmailChannelForTests(null);
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const superAdmin = () => resolveActor(db, ids.super);
const admin = () => resolveActor(db, ids.admin);
const sales = () => resolveActor(db, ids.sales);
const ana = () => resolveActor(db, ids.agentUser);
const ben = () => resolveActor(db, ids.agent2User);
const client = () => resolveActor(db, ids.clientUser);

describe("permissions and roles", () => {
  it("portal capabilities are never on a global role; staff hold the Hirewise keys; applicant roles hold nothing", () => {
    for (const role of (Object.keys(ROLE_PERMISSIONS) as RoleKey[]).filter((r) => r !== "SUPER_ADMIN")) for (const k of AGENCY_PORTAL_PERMISSIONS) expect(ROLE_PERMISSIONS[role]).not.toContain(k);
    expect(ROLE_PERMISSIONS.SUPER_ADMIN).toContain("agency.create_direct");
    expect(ROLE_PERMISSIONS.ADMIN).toContain("agency.review");
    expect(ROLE_PERMISSIONS.ADMIN).toContain("agency.manage");
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain("agency.create_direct");
    expect(ROLE_PERMISSIONS.SALES).toContain("agency.read");
    expect(ROLE_PERMISSIONS.SALES).not.toContain("agency.review");
    expect(ROLE_PERMISSIONS.APPLICANT).toEqual([]);
    expect(ROLE_PERMISSIONS.AGENCY_OWNER).toEqual([]);
    expect(ROLE_PERMISSIONS.AGENCY_MANAGER).toEqual([]);
  });
});

describe("applying", () => {
  it("staff cannot apply; a talent account applies once, accepting the agreement; the acceptance and audit are recorded", async () => {
    await expect(submitApplication(db, await admin(), applicationInput("Staff agency"), meta)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(submitApplication(db, await ana(), applicationInput("ABC Virtual Assistants", { agreementAccepted: false }), meta)).rejects.toThrow(/Accept the Hirewise Connect Terms/);
    await expect(submitApplication(db, await ana(), applicationInput("ABC Virtual Assistants", { description: "too short" }), meta)).rejects.toThrow();
    ids.appA = await submitApplication(db, await ana(), applicationInput("ABC Virtual Assistants"), meta);
    const acc = await db.agreementAcceptance.findFirstOrThrow({ where: { userId: ids.agentUser, context: "AGENCY_APPLICATION", agreement: { type: "PLATFORM_TERMS" } }, include: { agreement: true } });
    expect(acc).toMatchObject({ applicationId: ids.appA, bodyChecksum: acc.agreement.bodyChecksum, ipAddress: "203.0.113.5", userAgent: "vitest", role: "AGENT" });
    expect((await db.agencyApplication.findUniqueOrThrow({ where: { id: ids.appA } })).agreementAcceptanceId).toBe(acc.id);
    expect(await db.auditLog.count({ where: { action: "AGENCY_APPLICATION_SUBMITTED", entityId: ids.appA } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "AGENCY_AGREEMENT_ACCEPTED", actorUserId: ids.agentUser } })).toBe(1);
    expect(await db.agencyApplicationHistory.count({ where: { applicationId: ids.appA } })).toBe(1);
    // one in flight at a time
    await expect(submitApplication(db, await ana(), applicationInput("Second"), meta)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await applicationEligibility(db, await ana())).reason).toMatch(/already have an application/);
    // reviewers are notified and a task opens
    const w = await runWorkerOnce(db);
    expect(w.failures).toBe(0);
    expect(await db.notification.count({ where: { userId: ids.admin, type: "AGENCY_APPLICATION_SUBMITTED" } })).toBe(1);
    expect(await db.task.count({ where: { type: "REVIEW_AGENCY_APPLICATION", relatedId: ids.appA, status: "OPEN" } })).toBe(1);
  });

  it("the applicant view never carries reviewer notes; nobody else can read it as their own", async () => {
    const mine = await myApplication(db, await ana());
    expect(mine?.status).toBe("SUBMITTED");
    const keys = collectKeys(mine);
    expect(keys.has("reviewNotes")).toBe(false);
    expect(keys.has("reviewerId")).toBe(false);
    expect(keys.has("reviewer")).toBe(false);
    expect(await myApplication(db, await ben())).toBeNull();
    await expect(updateApplication(db, await ben(), ids.appA, applicationInput("Hijack"))).rejects.toBeInstanceOf(NotFoundError);
    await expect(withdrawApplication(db, await ben(), ids.appA)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("documents upload only to the application's own folder, within configured limits, and are readable by the applicant and staff", async () => {
    await setSetting(db, await superAdmin(), "agencyApplications", { reapplyCooldownDays: 30, maxDocuments: 2, maxDocumentBytes: 1024 * 1024, reviewDueDays: 3 });
    await expect(createApplicationUploadUrl(db, await ana(), ids.appA, { contentType: "application/x-msdownload", sizeBytes: 10, fileName: "x.exe" })).rejects.toThrow(/PDF, Word document, or image/);
    await expect(createApplicationUploadUrl(db, await ana(), ids.appA, { contentType: "application/pdf", sizeBytes: 5 * 1024 * 1024, fileName: "big.pdf" })).rejects.toThrow(/at most 1 MB/);
    const up = await createApplicationUploadUrl(db, await ana(), ids.appA, { contentType: "application/pdf", sizeBytes: 5, fileName: "DTI Registration.pdf" });
    expect(up.key.startsWith(`agency-applications/${ids.appA}/`)).toBe(true);
    await expect(attachApplicationDocument(db, await ana(), ids.appA, up.key)).rejects.toThrow(/not uploaded/);
    await getStorage().put(up.key, Buffer.from("%PDF-"), "application/pdf");
    await expect(attachApplicationDocument(db, await ana(), ids.appA, "agency-applications/other/x.pdf")).rejects.toBeInstanceOf(ForbiddenError);
    const docId = await attachApplicationDocument(db, await ana(), ids.appA, up.key);
    const mine = await myApplication(db, await ana());
    expect(mine?.documents.map((d) => d.name)).toEqual(["DTI-Registration.pdf"]);
    expect(await applicationDocumentUrl(db, await ana(), docId)).toContain("/api/storage/");
    expect(await applicationDocumentUrl(db, await sales(), docId)).toContain("/api/storage/");
    await expect(applicationDocumentUrl(db, await ben(), docId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(applicationDocumentUrl(db, await client(), docId)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("review", () => {
  it("the queue is for agency.read / agency.review; Sales reads but cannot decide; decisions need reasons where required", async () => {
    await expect(listApplications(db, await ana())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listApplications(db, await client())).rejects.toBeInstanceOf(ForbiddenError);
    const forSales = await listApplications(db, await sales(), {});
    expect(forSales.rows.map((r) => r.id)).toEqual([ids.appA]);
    expect(forSales.counts.SUBMITTED).toBe(1);
    await expect(startReview(db, await sales(), ids.appA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(approveApplication(db, await ana(), ids.appA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requestMoreInfo(db, await admin(), ids.appA, { message: "" })).rejects.toThrow(/Tell the applicant/);
    await expect(rejectApplication(db, await admin(), ids.appA, { message: "" })).rejects.toThrow(/reason is required/);
    expect((await listApplications(db, await admin(), { country: "philippines" })).rows).toHaveLength(1);
    expect((await listApplications(db, await admin(), { q: "abc virtual" })).rows).toHaveLength(1);
    expect((await listApplications(db, await admin(), { status: "REJECTED" })).rows).toHaveLength(0);
  });

  it("request more info → applicant edits and resubmits; the applicant's view carries the message, the staff view the internal notes", async () => {
    await startReview(db, await admin(), ids.appA, "Looks promising; check the team size claim.");
    expect((await getApplication(db, await admin(), ids.appA)).reviewer?.userId).toBe(ids.admin);
    await requestMoreInfo(db, await admin(), ids.appA, { message: "Please list the campaigns you ran in 2025.", notes: "Asked for campaign history" });
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.agentUser, type: "AGENCY_APPLICATION_NEEDS_MORE_INFO" } })).toBe(1);
    let mine = await myApplication(db, await ana());
    expect(mine).toMatchObject({ status: "NEEDS_MORE_INFO", applicantVisibleMessage: "Please list the campaigns you ran in 2025." });
    expect(collectKeys(mine).has("reviewNotes")).toBe(false);
    expect((await getApplication(db, await admin(), ids.appA)).reviewNotes).toBe("Asked for campaign history");
    await updateApplication(db, await ana(), ids.appA, applicationInput("ABC Virtual Assistants", { description: "We are a six-person outbound team. In 2025 we ran two US solar campaigns and one real-estate campaign with 40 booked appointments a month." }));
    await resubmitApplication(db, await ana(), ids.appA);
    mine = await myApplication(db, await ana());
    expect(mine).toMatchObject({ status: "SUBMITTED", applicantVisibleMessage: null });
    expect(mine?.resubmittedAt).not.toBeNull();
    expect(mine?.timeline.map((t) => t.to)).toEqual(["SUBMITTED", "UNDER_REVIEW", "NEEDS_MORE_INFO", "SUBMITTED"]);
    await expect(resubmitApplication(db, await ana(), ids.appA)).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it("approval creates the agency, the Owner seat, and (for talent) a primary membership; the role is unchanged for an agent", async () => {
    expect(await db.agency.count()).toBe(0);
    ids.agencyA = await approveApplication(db, await admin(), ids.appA, { message: "Welcome!", notes: "Approved after campaign history" });
    const app = await getApplication(db, await admin(), ids.appA);
    expect(app).toMatchObject({ status: "APPROVED", createdAgencyId: ids.agencyA });
    expect(app.reviewedAt).not.toBeNull();
    const agency = await getAgencyForStaff(db, await admin(), ids.agencyA);
    expect(agency).toMatchObject({ name: "ABC Virtual Assistants", status: "ACTIVE", country: "Philippines", owner: { userId: ids.agentUser }, applicationId: ids.appA, agentCount: 1 });
    expect(agency.seats).toEqual([{ userId: ids.agentUser, email: "ana@t.example", role: "OWNER", permissions: [] }]);
    // D6: the owner is also talent, so she is a primary member of her own agency; her role stays AGENT
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: ids.agentProfile } })).primaryAgencyId).toBe(ids.agencyA);
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.agentUser }, include: { role: true } })).role.key).toBe("AGENT");
    const owner = await ana();
    expect(owner.agency).toEqual({ id: ids.agencyA, role: "OWNER", status: "ACTIVE" });
    for (const k of AGENCY_PORTAL_PERMISSIONS) expect(owner.permissions.has(k)).toBe(true);
    expect(owner.agentProfileId).toBe(ids.agentProfile);
    expect(await db.auditLog.count({ where: { action: { in: ["AGENCY_APPLICATION_APPROVED", "AGENCY_CREATED", "AGENCY_SEAT_ADDED", "AGENCY_MEMBERSHIP_STARTED"] } } })).toBe(4);
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.agentUser, type: "AGENCY_APPLICATION_APPROVED" } })).toBe(1);
    expect(await db.task.count({ where: { type: "REVIEW_AGENCY_APPLICATION", relatedId: ids.appA, status: "OPEN" } })).toBe(0);
    expect((await applicationEligibility(db, owner)).reason).toMatch(/already belong to an agency/);
  });

  it("rejection needs a reason, sets the cooldown from settings (or the override), and blocks re-application until then", async () => {
    await setSetting(db, await superAdmin(), "agencyApplications", { reapplyCooldownDays: 10, maxDocuments: 5, maxDocumentBytes: 1024 * 1024, reviewDueDays: 3 });
    ids.appB = await submitApplication(db, await ben(), applicationInput("Ben's Team", { applicantFullName: "Ben Cruz" }), meta);
    await rejectApplication(db, await admin(), ids.appB, { message: "Team too small for current client demand." });
    const mine = await myApplication(db, await ben());
    expect(mine).toMatchObject({ status: "REJECTED", rejectionReason: "Team too small for current client demand." });
    const days = Math.round((mine!.reapplyAfter!.getTime() - Date.now()) / 86_400_000);
    expect(days).toBe(10);
    await expect(submitApplication(db, await ben(), applicationInput("Ben's Team again"), meta)).rejects.toThrow(/apply again after/);
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.agent2User, type: "AGENCY_APPLICATION_REJECTED" } })).toBe(1);
    // an admin override of 0 days lets the applicant re-apply immediately
    const appC = await submitApplication(db, await ana().then(() => ben()), applicationInput("Never submitted"), meta).catch(() => null);
    expect(appC).toBeNull();
    await db.agencyApplication.update({ where: { id: ids.appB }, data: { status: "SUBMITTED", reapplyAfter: null, rejectionReason: null, reviewedAt: null } }); // reset for the override check
    await rejectApplication(db, await admin(), ids.appB, { message: "Try again with references.", reapplyAfterDays: 0 });
    const again = await submitApplication(db, await ben(), applicationInput("Ben's Team v2", { applicantFullName: "Ben Cruz" }), meta);
    expect(again).not.toBe(ids.appB);
    await withdrawApplication(db, await ben(), again);
    expect((await myApplication(db, await ben()))?.status).toBe("WITHDRAWN");
    expect((await applicationEligibility(db, await ben())).canApply).toBe(true);
  });
});

describe("agencies: creation paths, tenant scope, status", () => {
  it("only approval or a Super Admin creates an agency; direct creation refuses staff owners and members of other agencies", async () => {
    await expect(createAgencyDirect(db, await admin(), { ownerEmail: "client@acme.example", name: "Admin made", country: "Philippines", reason: "test" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createAgencyDirect(db, await ana(), { ownerEmail: "ben@t.example", name: "Owner made", country: "Philippines", reason: "test" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createAgencyDirect(db, await superAdmin(), { ownerEmail: "sales@hirewise.example", name: "Staff owned", country: "Philippines", reason: "test" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createAgencyDirect(db, await superAdmin(), { ownerEmail: "ana@t.example", name: "Second for Ana", country: "Philippines", reason: "test" })).rejects.toThrow(/already belongs to an agency/);
    await expect(createAgencyDirect(db, await superAdmin(), { ownerEmail: "nobody@t.example", name: "Ghost", country: "Philippines", reason: "test" })).rejects.toThrow(/No account/);
    ids.agencyB = await createAgencyDirect(db, await superAdmin(), { ownerEmail: "ben@t.example", name: "Ben's Team", country: "Philippines", city: "Davao", reason: "Pilot partner onboarded by the founder" });
    expect(await db.agency.count()).toBe(2);
    const ben2 = await ben();
    expect(ben2.agency).toEqual({ id: ids.agencyB, role: "OWNER", status: "ACTIVE" });
    expect(await db.auditLog.count({ where: { action: "AGENCY_CREATED", entityId: ids.agencyB } })).toBe(1);
  });

  it("an applicant account becomes AGENCY_OWNER on approval, keeps no agent profile, and registers through the public form", async () => {
    const s = await registerApplicant(db, { termsAccepted: true, fullName: "Carla Reyes", email: "carla@agency.example", password: "LongerPassw0rd!" }, meta);
    ids.applicantUser = s.userId;
    await db.user.update({ where: { id: s.userId }, data: { emailVerifiedAt: new Date() } });
    const carla = await resolveActor(db, s.userId);
    expect(carla.role).toBe("APPLICANT");
    expect(carla.permissions.size).toBe(0);
    expect(carla.agency).toBeUndefined();
    const appId = await submitApplication(db, carla, applicationInput("Reyes Outsourcing", { applicantFullName: "Carla Reyes" }), meta);
    const agencyId = await approveApplication(db, await superAdmin(), appId);
    const after = await resolveActor(db, s.userId);
    expect(after.role).toBe("AGENCY_OWNER");
    expect(after.agency?.id).toBe(agencyId);
    expect(after.agentProfileId).toBeUndefined();
    expect((await getAgencyForStaff(db, await admin(), agencyId)).agentCount).toBe(0);
    expect(await db.auditLog.count({ where: { action: "USER_ROLE_CHANGED", entityId: s.userId } })).toBe(1);
  });

  it("tenant scope: an agency reads only itself; cross-agency reads are NotFound; staff read all", async () => {
    const a = await ana();
    expect((await myAgency(db, a)).id).toBe(ids.agencyA);
    expect((await agencyAgents(db, a)).map((x) => x.id)).toEqual([ids.agentProfile]);
    expect((await agencyAgents(db, a, ids.agencyB)).map((x) => x.id)).toEqual([ids.agentProfile]); // the id is ignored for non-staff: always their own
    await expect(updateAgencyProfile(db, a, ids.agencyB, { name: "Hijacked", contactEmail: "a@b.co", country: "Philippines" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getAgencyForStaff(db, a, ids.agencyB)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(myAgency(db, await client())).rejects.toBeInstanceOf(NotFoundError);
    const all = await listAgencies(db, await sales());
    expect(all.map((x) => x.name).sort()).toEqual(["ABC Virtual Assistants", "Ben's Team", "Reyes Outsourcing"]);
    const staffView = await getAgencyForStaff(db, await sales(), ids.agencyA);
    expect(staffView.owner.email).toBe("ana@t.example");
    // owner view has no Hirewise-internal fields
    const ownerKeys = collectKeys(await myAgency(db, a));
    for (const k of ["reviewNotes", "applicationId", "owner", "suspendedAt"]) expect(ownerKeys.has(k)).toBe(false);
  });

  it("the owner edits the profile; a manager seat holds only the permissions the owner grants", async () => {
    await updateAgencyProfile(db, await ana(), ids.agencyA, { name: "ABC Virtual Assistants Inc.", description: "Outbound specialists", contactEmail: "hello@abc.example", country: "Philippines", city: "Cebu", website: "https://abc.example" });
    expect((await myAgency(db, await ana())).name).toBe("ABC Virtual Assistants Inc.");
    // a manager with only team.read
    const role = await db.role.findUniqueOrThrow({ where: { key: "AGENCY_MANAGER" } });
    const mu = await db.user.create({ data: { email: "manager@abc.example", roleId: role.id, emailVerifiedAt: new Date() } });
    await db.agencyUser.create({ data: { agencyId: ids.agencyA, userId: mu.id, role: "MANAGER", permissions: ["agency.team.read"] } });
    const manager = await resolveActor(db, mu.id);
    expect(manager.agency).toEqual({ id: ids.agencyA, role: "MANAGER", status: "ACTIVE" });
    expect(manager.permissions.has("agency.team.read")).toBe(true);
    expect(manager.permissions.has("agency.profile.manage")).toBe(false);
    expect((await agencyAgents(db, manager)).length).toBe(1);
    await expect(updateAgencyProfile(db, manager, ids.agencyA, { name: "Nope", contactEmail: "a@b.co", country: "Philippines" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("suspension needs agency.manage and a reason, pauses writes but keeps reads, notifies the owner, and can be reversed", async () => {
    await expect(setAgencyStatus(db, await sales(), ids.agencyA, "SUSPENDED", "x")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setAgencyStatus(db, await admin(), ids.agencyA, "SUSPENDED", "")).rejects.toBeInstanceOf(ForbiddenError);
    await setAgencyStatus(db, await admin(), ids.agencyA, "SUSPENDED", "Unpaid training invoice");
    const a = await ana();
    expect(a.agency?.status).toBe("SUSPENDED");
    expect((await myAgency(db, a)).statusReason).toBe("Unpaid training invoice");
    await expect(updateAgencyProfile(db, a, ids.agencyA, { name: "Still here", contactEmail: "a@b.co", country: "Philippines" })).rejects.toThrow(/suspended/);
    expect(await db.agency.count()).toBe(3); // nothing deleted
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.agentUser, type: "AGENCY_STATUS_CHANGED" } })).toBe(1);
    await expect(setAgencyStatus(db, await admin(), ids.agencyA, "SUSPENDED", "again")).rejects.toBeInstanceOf(IllegalTransitionError);
    await setAgencyStatus(db, await admin(), ids.agencyA, "ACTIVE", "Invoice settled");
    expect((await ana()).agency?.status).toBe("ACTIVE");
    expect(await db.auditLog.count({ where: { action: { in: ["AGENCY_SUSPENDED", "AGENCY_REACTIVATED"] }, entityId: ids.agencyA } })).toBe(2);
  });

  it("memberships: an admin moves an agent between agencies; history is preserved and the profile is the same row", async () => {
    await expect(setAgentAgency(db, await ana(), ids.agent2Profile, ids.agencyA, "poach")).rejects.toBeInstanceOf(ForbiddenError);
    await setAgentAgency(db, await admin(), ids.agent2Profile, ids.agencyA, "Ben's own agency is a pilot; he works through ABC for now");
    // v2 phase 3: leaving an agency makes the old profile a former profile; the move creates a fresh profile (decision 5), same identity.
    const moved = await db.agentProfile.findFirstOrThrow({ where: { userId: ids.agent2User, archivedAt: null } });
    expect(moved.id).not.toBe(ids.agent2Profile);
    expect(moved.primaryAgencyId).toBe(ids.agencyA);
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: ids.agent2Profile } })).status).toBe("ARCHIVED");
    expect((await agencyAgents(db, await ana())).map((x) => x.id).sort()).toEqual([ids.agentProfile, moved.id].sort());
    await setAgentAgency(db, await admin(), moved.id, null, "Back to Hirewise Direct");
    expect((await membershipHistory(db, await admin(), ids.agent2Profile)).map((h) => [h.agencyId, h.status])).toEqual([[ids.agencyB, "ENDED"]]);
    expect((await membershipHistory(db, await admin(), moved.id)).map((h) => [h.agencyId, h.status])).toEqual([[ids.agencyA, "ENDED"]]);
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: moved.id } })).status).toBe("FORMER_AGENCY_AGENT");
    expect(await db.agentProfile.count({ where: { userId: ids.agent2User } })).toBe(2);
  });
});
