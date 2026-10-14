import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { testDb, resetDb } from "../setup/db";
import { seedTerms } from "../setup/terms";
import { registerAgent } from "@/server/services/agent.service";
import { registerClient } from "@/server/services/client.service";
import { registerApplicant, submitApplication } from "@/server/services/agency-application.service";
import { detectDuplicates, normalizePhone, normalizeEmail, DuplicateDetectedError, listDuplicateFlags, decideDuplicateFlag, identityForStaff, listIdentities, syncIdentityContact } from "@/server/services/identity.service";
import { termsStatusFor, acceptCurrentTerms, publishTermsVersion, listTermsVersions, acceptanceReport, acceptanceReportCsv, termsForRole } from "@/server/services/terms.service";
import { setSetting } from "@/server/services/setting.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError } from "@/server/policies/authorize";
import { IllegalTransitionError } from "@/server/state/agent-profile";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { FORBIDDEN_FOR_CLIENT, FORBIDDEN_FOR_AGENCY, collectKeys } from "@/server/views/forbidden-keys";
import { toCandidateClientView } from "@/server/views/agent.views";
import { agentRepository } from "@/server/repositories/agent.repository";
import { runWorkerOnce } from "@/server/jobs/worker";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";
import { PLATFORM_TERMS_SECTIONS, PRIVACY_POLICY_SECTIONS, PLATFORM_TERMS_TITLE, PRIVACY_POLICY_TITLE, renderTermsBody } from "@/server/terms/placeholder-terms";

const db = testDb();
const email = new ConsoleEmailChannel();
const meta = { ipAddress: "198.51.100.7", userAgent: "vitest" };
const PASSWORD = "Str0ngPassw0rd!";
const ids = { super: "su_id", admin: "admin_id", sales: "sales_id", recruiter: "rec_id", anaUser: "", anaProfile: "", clientUser: "" };

const agentInput = (over: Record<string, unknown> = {}) => ({ termsAccepted: true, fullName: "Ana Lim", displayName: "Ana L.", email: "ana@talent.example", password: PASSWORD, phone: "+63 917 000 1111", locationCity: "Cebu", locationCountry: "Philippines", timezone: "Asia/Manila", primaryRole: "Cold Caller", yearsExperience: 3, ...over });
const clientInput = (over: Record<string, unknown> = {}) => ({ termsAccepted: true, companyName: "Acme Solar", contactName: "Chris Doe", position: "COO", email: "chris@acme-solar.example", password: PASSWORD, phone: "", industry: "Solar", website: "", country: "United States", timezone: "America/Los_Angeles", servicesNeeded: ["Cold Calling"], agentsRequired: 2, preferredSchedule: "", expectedStartDate: "", notes: "", ...over });
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const superAdmin = () => makeActor("SUPER_ADMIN", { userId: ids.super });
const sales = () => makeActor("SALES", { userId: ids.sales });

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
  await db.user.create({ data: { id: ids.recruiter, email: "recruiter@hirewise.example", roleId: await role("RECRUITER"), emailVerifiedAt: new Date() } });
});

afterAll(async () => {
  setEmailChannelForTests(null);
  await db.$disconnect();
});

describe("terms seed and migration agree", () => {
  it("embeds the same bodies and checksums in the data migration", () => {
    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261014090001_identity_terms_data/migration.sql"), "utf8");
    for (const [title, sections] of [[PLATFORM_TERMS_TITLE, PLATFORM_TERMS_SECTIONS], [PRIVACY_POLICY_TITLE, PRIVACY_POLICY_SECTIONS]] as const) {
      const body = renderTermsBody(title, sections);
      expect(sql).toContain(createHash("sha256").update(body).digest("hex"));
    }
    expect(sql).toContain(`'AGENT_PLATFORM_TERMS'`);
  });
});

describe("normalisation", () => {
  it("normalises emails and phones the way the backfill does", () => {
    expect(normalizeEmail("  Ana@Talent.Example ")).toBe("ana@talent.example");
    expect(normalizePhone("+63 (917) 000-1111")).toBe("+639170001111");
    expect(normalizePhone("0917 000 1111")).toBe("09170001111");
    expect(normalizePhone("12")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("sign-up creates a platform identity and records the single-checkbox acceptance", () => {
  it("refuses without the checkbox and creates nothing", async () => {
    resetRateLimits();
    await expect(registerAgent(db, agentInput({ termsAccepted: false }), meta)).rejects.toMatchObject({ name: "RegistrationError", field: "termsAccepted" });
    expect(await db.user.count({ where: { email: "ana@talent.example" } })).toBe(0);
  });

  it("talent: identity, normalised contacts, profile link, two acceptance rows with role, context, IP", async () => {
    resetRateLimits();
    const r = await registerAgent(db, agentInput(), meta);
    ids.anaUser = r.userId;
    ids.anaProfile = r.agentProfileId;
    const identity = await db.platformIdentity.findUniqueOrThrow({ where: { userId: r.userId }, include: { contacts: true } });
    expect(identity.primaryEmail).toBe("ana@talent.example");
    expect(identity.contacts.map((c) => [c.kind, c.valueNormalized]).sort()).toEqual([["EMAIL", "ana@talent.example"], ["PHONE", "+639170001111"]]);
    const profile = await db.agentProfile.findUniqueOrThrow({ where: { id: r.agentProfileId } });
    expect(profile.platformIdentityId).toBe(identity.id);
    expect(profile.talentType).toBe("HIREWISE_DIRECT");
    const acc = await db.agreementAcceptance.findMany({ where: { userId: r.userId }, include: { agreement: true } });
    expect(acc.map((a) => a.agreement.type).sort()).toEqual(["PLATFORM_TERMS", "PRIVACY_POLICY"]);
    for (const a of acc) {
      expect(a.role).toBe("AGENT");
      expect(a.context).toBe("SIGNUP");
      expect(a.ipAddress).toBe(meta.ipAddress);
      expect(a.bodyChecksum).toBe(a.agreement.bodyChecksum);
    }
    expect(await db.auditLog.count({ where: { action: "IDENTITY_CREATED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "TERMS_ACCEPTED", actorUserId: r.userId } })).toBe(2);
    const actor = await resolveActor(db, r.userId);
    expect(actor.agentProfileId).toBe(r.agentProfileId);
    expect(actor.identityId).toBe(identity.id);
    expect((await termsStatusFor(db, actor)).required).toBe(false);
  });

  it("client: the checkbox is required and the acceptance is recorded for the CLIENT role", async () => {
    resetRateLimits();
    await expect(registerClient(db, clientInput({ termsAccepted: false }), meta)).rejects.toMatchObject({ field: "termsAccepted" });
    const r = await registerClient(db, clientInput(), meta);
    ids.clientUser = r.userId;
    const acc = await db.agreementAcceptance.findMany({ where: { userId: r.userId } });
    expect(acc).toHaveLength(2);
    expect(acc.every((a) => a.role === "CLIENT" && a.context === "SIGNUP")).toBe(true);
    await expect(registerClient(db, clientInput(), meta)).rejects.toThrow(/already exists/);
  });
});

describe("duplicate detection", () => {
  it("matches an email variant and a phone variant against the identity contacts", async () => {
    resetRateLimits();
    const byEmail = await detectDuplicates(db, { email: " Ana@Talent.Example " });
    expect(byEmail.matched).toBe(true);
    expect(byEmail.reasons).toEqual(expect.arrayContaining(["EMAIL", "IDENTITY"]));
    const byPhone = await detectDuplicates(db, { email: "other@talent.example", phone: "+63 (917) 000-1111" });
    expect(byPhone.matched).toBe(true);
    expect(byPhone.reasons).toEqual(expect.arrayContaining(["PHONE", "IDENTITY"]));
    expect(byPhone.reasons).not.toContain("EMAIL");
    expect(byPhone.userId).toBe(ids.anaUser);
    expect((await detectDuplicates(db, { email: "fresh@talent.example", phone: "+63 999 000 0000" })).matched).toBe(false);
  });

  it("a matching sign-up raises one flag, creates no account, and notifies Admins with a task", async () => {
    resetRateLimits();
    await expect(registerAgent(db, agentInput({ email: "ANA@talent.example", displayName: "Ana again" }), meta)).rejects.toBeInstanceOf(DuplicateDetectedError);
    await expect(registerAgent(db, agentInput({ email: "ANA@talent.example" }), meta)).rejects.toThrow(/Existing Hirewise Connect membership detected/);
    expect(await db.user.count({ where: { email: { contains: "talent.example" } } })).toBe(1);
    const flags = await db.duplicateFlag.findMany({ where: { attemptedEmail: "ana@talent.example" } });
    expect(flags).toHaveLength(1);
    expect(flags[0].status).toBe("OPEN");
    expect(flags[0].kind).toBe("SIGNUP");
    expect(flags[0].matchReasons).toEqual(expect.arrayContaining(["EMAIL", "IDENTITY"]));
    expect(flags[0].matchedUserId).toBe(ids.anaUser);
    expect(JSON.stringify(flags[0].attemptedData)).not.toContain(PASSWORD);
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.admin, type: "DUPLICATE_FLAG_RAISED" } })).toBe(1);
    expect(await db.task.count({ where: { type: "REVIEW_DUPLICATE_FLAG", relatedId: flags[0].id, status: "OPEN" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: ids.anaUser, type: "DUPLICATE_SIGNUP_ATTEMPT" } })).toBe(1);
  });

  it("phone-only matches and applicant sign-ups are flagged with their kind", async () => {
    resetRateLimits();
    await expect(registerAgent(db, agentInput({ email: "twin@talent.example", phone: "0063 917 000 1111" }), meta)).rejects.toBeInstanceOf(DuplicateDetectedError);
    const byPhone = await db.duplicateFlag.findFirstOrThrow({ where: { attemptedEmail: "twin@talent.example" } });
    expect(byPhone.matchReasons).toContain("PHONE");
    expect(byPhone.attemptedPhone).toBe("+639170001111");
    await expect(registerApplicant(db, { termsAccepted: true, fullName: "Ana Lim", email: "ana@talent.example", password: PASSWORD }, meta)).rejects.toBeInstanceOf(DuplicateDetectedError);
    // Same email within the window reuses the open flag instead of piling up.
    expect(await db.duplicateFlag.count({ where: { attemptedEmail: "ana@talent.example" } })).toBe(1);
  });

  it("phone matching can be switched off", async () => {
    resetRateLimits();
    await setSetting(db, superAdmin(), "identity", { rejoinCreatesFreshProfile: true, duplicateCheckPhone: false, notifyExistingOnDuplicate: true, continuationLinkHours: 72 });
    expect((await detectDuplicates(db, { email: "x@talent.example", phone: "+63 917 000 1111" })).matched).toBe(false);
    await setSetting(db, superAdmin(), "identity", { rejoinCreatesFreshProfile: true, duplicateCheckPhone: true, notifyExistingOnDuplicate: true, continuationLinkHours: 72 });
  });
});

describe("duplicate flag decisions", () => {
  it("needs identity.review; reject closes; decisions are final", async () => {
    resetRateLimits();
    await expect(listDuplicateFlags(db, sales())).rejects.toThrow(ForbiddenError);
    const open = await listDuplicateFlags(db, admin(), "OPEN");
    expect(open.rows.length).toBeGreaterThanOrEqual(2);
    const ana = open.rows.find((f) => f.attemptedEmail === "ana@talent.example")!;
    await expect(decideDuplicateFlag(db, sales(), ana.id, "REJECTED", null, meta)).rejects.toThrow(ForbiddenError);
    await decideDuplicateFlag(db, admin(), ana.id, "REJECTED", "Same person, second attempt", meta);
    await expect(decideDuplicateFlag(db, admin(), ana.id, "LINKED", null, meta)).rejects.toThrow(IllegalTransitionError);
    await runWorkerOnce(db);
    expect(await db.task.count({ where: { type: "REVIEW_DUPLICATE_FLAG", relatedId: ana.id, status: "OPEN" } })).toBe(0);
  });

  it("approving a new profile emails a continuation link that lets the same sign-up through once", async () => {
    resetRateLimits();
    const twin = (await listDuplicateFlags(db, admin(), "OPEN")).rows.find((f) => f.attemptedEmail === "twin@talent.example")!;
    const before = email.sent.length;
    await decideDuplicateFlag(db, admin(), twin.id, "APPROVED_NEW_PROFILE", "Different person, shared household phone", meta);
    const mail = email.sent.slice(before).find((m) => m.to === "twin@talent.example")!;
    expect(mail).toBeTruthy();
    const token = mail.text.match(/\/register\/continue\/([A-Za-z0-9_-]+)/)![1];
    await expect(registerAgent(db, agentInput({ email: "other@talent.example", phone: "0063 917 000 1111", continuationToken: token }), meta)).rejects.toThrow(/different email/);
    const r = await registerAgent(db, agentInput({ email: "twin@talent.example", displayName: "Twin T.", phone: "0063 917 000 1111", continuationToken: token }), meta);
    expect(r.userId).toBeTruthy();
    await expect(registerAgent(db, agentInput({ email: "twin@talent.example", continuationToken: token }), meta)).rejects.toThrow(/already used|invalid/);
    expect(await db.duplicateFlag.count({ where: { attemptedEmail: "twin@talent.example", status: "APPROVED_NEW_PROFILE" } })).toBe(1);
  });

  it("linking emails the existing address a sign-in reminder", async () => {
    resetRateLimits();
    await expect(registerApplicant(db, { termsAccepted: true, fullName: "Ana Lim", email: "ana.lim+agency@talent.example", password: PASSWORD }, meta)).resolves.toBeTruthy();
    await expect(registerAgent(db, agentInput({ email: "another@talent.example", phone: "+63 917 000 1111" }), meta)).rejects.toBeInstanceOf(DuplicateDetectedError);
    const flag = (await listDuplicateFlags(db, admin(), "OPEN")).rows.find((f) => f.attemptedEmail === "another@talent.example")!;
    await decideDuplicateFlag(db, admin(), flag.id, "LINKED", null, meta);
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.anaUser, type: "DUPLICATE_SIGNUP_LINKED" } })).toBe(1);
  });
});

describe("identity records for Hirewise only", () => {
  it("staff read the full history; sales cannot; projections never carry identity keys", async () => {
    resetRateLimits();
    const identity = await db.platformIdentity.findUniqueOrThrow({ where: { userId: ids.anaUser } });
    await expect(identityForStaff(db, sales(), identity.id)).rejects.toThrow(ForbiddenError);
    const view = await identityForStaff(db, makeActor("RECRUITER", { userId: ids.recruiter }), identity.id);
    expect(view.profiles[0].id).toBe(ids.anaProfile);
    expect(view.duplicateFlags.length).toBeGreaterThanOrEqual(1);
    expect((await listIdentities(db, admin(), "ana@")).some((i) => i.id === identity.id)).toBe(true);
    const record = await agentRepository.findSelf(db, ids.anaProfile);
    const keys = collectKeys(toCandidateClientView(record!));
    for (const k of ["platformIdentityId", "platformIdentity", "identityContacts"]) expect(keys.has(k)).toBe(false);
    expect(FORBIDDEN_FOR_CLIENT).toEqual(expect.arrayContaining(["platformIdentityId", "idVerificationRefs"]));
    expect(FORBIDDEN_FOR_AGENCY).toEqual(expect.arrayContaining(["platformIdentityId", "privateContact", "agentCompensation"]));
  });

  it("profile edits keep the identity contacts in step", async () => {
    resetRateLimits();
    const actor = await resolveActor(db, ids.anaUser);
    await db.$transaction(async (tx) => {
      await syncIdentityContact(tx, actor, ids.anaUser, { kind: "PHONE", value: "+63 918 222 3333", source: "PRIVATE_CONTACT" });
    });
    expect((await detectDuplicates(db, { email: "nobody@talent.example", phone: "+639182223333" })).reasons).toContain("PHONE");
  });

  it("the database allows one non-archived profile per user and per identity", async () => {
    resetRateLimits();
    const identity = await db.platformIdentity.findUniqueOrThrow({ where: { userId: ids.anaUser } });
    await expect(db.agentProfile.create({ data: { userId: ids.anaUser, platformIdentityId: identity.id, displayName: "Second" } })).rejects.toThrow();
    const archived = await db.agentProfile.create({ data: { userId: ids.anaUser, platformIdentityId: identity.id, displayName: "Old", archivedAt: new Date(), status: "ARCHIVED" } });
    expect(archived.id).toBeTruthy();
    const otherRole = await db.role.findUniqueOrThrow({ where: { key: "AGENT" } });
    const other = await db.user.create({ data: { email: "someone-else@talent.example", roleId: otherRole.id } });
    await expect(db.agentProfile.create({ data: { userId: other.id, platformIdentityId: identity.id, displayName: "Clash" } })).rejects.toThrow();
    const actor = await resolveActor(db, ids.anaUser);
    expect(actor.agentProfileId).toBe(ids.anaProfile);
  });
});

describe("unified terms: gate, versions, re-acceptance, report", () => {
  it("a talent account that never accepted is gated; staff are not unless configured", async () => {
    resetRateLimits();
    const role = await db.role.findUniqueOrThrow({ where: { key: "AGENT" } });
    const legacy = await db.user.create({ data: { email: "legacy@talent.example", roleId: role.id, emailVerifiedAt: new Date() } });
    const actor = makeActor("AGENT", { userId: legacy.id });
    const status = await termsStatusFor(db, actor);
    expect(status).toMatchObject({ required: true, missing: ["PLATFORM_TERMS", "PRIVACY_POLICY"], reason: "NEW", termsVersion: 1 });
    const after = await acceptCurrentTerms(db, actor, meta);
    expect(after.required).toBe(false);
    expect(await db.agreementAcceptance.count({ where: { userId: legacy.id, context: "GENERAL" } })).toBe(2);
    expect((await termsStatusFor(db, admin())).required).toBe(false);
    await setSetting(db, superAdmin(), "terms", { gateStaff: true });
    expect((await termsStatusFor(db, admin())).required).toBe(true);
    await setSetting(db, superAdmin(), "terms", { gateStaff: false });
  });

  it("sections are marked per role and the public bundle carries no user data", async () => {
    resetRateLimits();
    const agent = await termsForRole(db, "AGENT");
    const client = await termsForRole(db, "CLIENT");
    expect(agent.terms!.sections.find((s) => s.key === "agent.exclusivity")!.relevant).toBe(true);
    expect(client.terms!.sections.find((s) => s.key === "agent.exclusivity")!.relevant).toBe(false);
    expect(client.terms!.sections.find((s) => s.key === "general.law")!.relevant).toBe(true);
    expect(agent.checkboxLabel).toMatch(/agree to the Hirewise Connect Terms & Platform Agreement and Privacy Policy/);
    const keys = collectKeys(agent);
    for (const k of ["userId", "email", "acceptances"]) expect(keys.has(k)).toBe(false);
  });

  it("non-material versions do not re-gate; material versions do, once, and notify the roles", async () => {
    resetRateLimits();
    const ana = await resolveActor(db, ids.anaUser);
    const v1 = (await termsForRole(db, "AGENT")).terms!;
    const sections = v1.sections.map(({ key, title, audiences, bodyMarkdown }) => ({ key, title, audiences, bodyMarkdown }));
    await expect(publishTermsVersion(db, sales(), { type: "PLATFORM_TERMS", title: v1.title, sections, effectiveFrom: "2026-11-01", isMaterialChange: false, requiresReacceptance: false })).rejects.toThrow(ForbiddenError);
    await expect(publishTermsVersion(db, admin(), { type: "PLATFORM_TERMS", title: v1.title, sections, effectiveFrom: "2026-11-01" })).rejects.toThrow(ForbiddenError);
    const v2 = await publishTermsVersion(db, superAdmin(), { type: "PLATFORM_TERMS", title: v1.title, sections: sections.map((s) => (s.key === "general.law" ? { ...s, bodyMarkdown: "Typo fixed. LEGAL_PLACEHOLDER" } : s)), effectiveFrom: "2026-11-01", isMaterialChange: false, requiresReacceptance: false, changeNote: "Typo" });
    expect(v2.version).toBe(2);
    expect((await termsStatusFor(db, ana)).required).toBe(false);
    const v3 = await publishTermsVersion(db, superAdmin(), { type: "PLATFORM_TERMS", title: v1.title, sections: sections.map((s) => (s.key === "agency.seats" ? { ...s, bodyMarkdown: "Seat usage rules. LEGAL_PLACEHOLDER" } : s)), effectiveFrom: "2026-12-01", isMaterialChange: true, requiresReacceptance: true, changeNote: "Seat usage clause" });
    expect(v3.version).toBe(3);
    expect(await db.agreement.count({ where: { type: "PLATFORM_TERMS", isActive: true } })).toBe(1);
    const status = await termsStatusFor(db, ana);
    expect(status).toMatchObject({ required: true, missing: ["PLATFORM_TERMS"], reason: "MATERIAL_CHANGE", termsVersion: 3, acceptedTermsVersion: 1 });
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.anaUser, type: "TERMS_UPDATED" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: ids.admin, type: "TERMS_UPDATED" } })).toBe(0);
    const after = await acceptCurrentTerms(db, ana, meta);
    expect(after.required).toBe(false);
    const re = await db.agreementAcceptance.findFirstOrThrow({ where: { userId: ids.anaUser, context: "REACCEPTANCE" }, include: { agreement: true } });
    expect(re.agreement.version).toBe(3);
    // Accepting again is a no-op, not a duplicate row.
    await acceptCurrentTerms(db, ana, meta);
    expect(await db.agreementAcceptance.count({ where: { userId: ids.anaUser, agreementId: re.agreementId } })).toBe(1);
    const versions = await listTermsVersions(db, admin());
    expect(versions.terms.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(versions.terms[0].placeholder).toBe(true);
    await expect(listTermsVersions(db, sales())).rejects.toThrow(ForbiddenError);
  });

  it("the acceptance report shows current, outdated, and none, and exports CSV", async () => {
    resetRateLimits();
    await expect(acceptanceReport(db, sales())).rejects.toThrow(ForbiddenError);
    const r = await acceptanceReport(db, admin());
    const byEmail = Object.fromEntries(r.rows.map((x) => [x.email, x.status]));
    expect(byEmail["ana@talent.example"]).toBe("CURRENT");
    expect(byEmail["legacy@talent.example"]).toBe("OUTDATED");
    expect(byEmail["someone-else@talent.example"]).toBe("NONE");
    expect(byEmail["chris@acme-solar.example"]).toBe("OUTDATED");
    const csv = acceptanceReportCsv(r.rows);
    expect(csv.split("\n")[0]).toContain("termsVersion");
    expect(csv).toContain("legacy@talent.example");
    const onlyNone = await acceptanceReport(db, admin(), { status: "NONE" });
    expect(onlyNone.rows.every((x) => x.status === "NONE")).toBe(true);
  });

  it("an agency application records a contextual acceptance of the same document", async () => {
    resetRateLimits();
    const ana = await resolveActor(db, ids.anaUser);
    const appId = await submitApplication(db, ana, { applicantFullName: "Ana Lim", applicantPhone: "+63 917 000 1111", proposedAgencyName: "Ana Virtual Teams", businessRegistration: "", country: "Philippines", city: "Cebu", website: "", socialLinks: [], teamSize: 5, yearsExperience: 3, services: ["Cold Calling"], description: "Five-person outbound team with three years of US solar campaign experience looking for Hirewise training and clients.", agreementAccepted: true }, meta);
    const acc = await db.agreementAcceptance.findMany({ where: { userId: ids.anaUser, context: "AGENCY_APPLICATION" }, include: { agreement: true } });
    expect(acc.map((a) => a.agreement.type).sort()).toEqual(["PLATFORM_TERMS", "PRIVACY_POLICY"]);
    expect(acc.every((a) => a.applicationId === appId)).toBe(true);
    const app = await db.agencyApplication.findUniqueOrThrow({ where: { id: appId } });
    expect(app.agreementAcceptanceId).toBe(acc.find((a) => a.agreement.type === "PLATFORM_TERMS")!.id);
  });
});
