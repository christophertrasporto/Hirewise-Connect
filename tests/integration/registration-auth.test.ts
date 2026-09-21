import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { registerClient, activateClient, getOwnClient, listClientsForStaff, RegistrationError } from "@/server/services/client.service";
import { registerAgent, updateSkills, submitForReview, reviewTransition, getOwnProfile, getAgentForStaff, computeCompletion, SubmissionBlockedError } from "@/server/services/agent.service";
import { loginWithPassword, requestMagicLink, consumeMagicLink, verifyEmail, AuthError, beginMfaEnrollment, completeMfaEnrollment } from "@/server/services/auth.service";
import { agreementsFor, missingAgreementsFor, acceptAgreement } from "@/server/services/agreement.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { runWorkerOnce } from "@/server/jobs/worker";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";
import { sha256 } from "@/server/auth/crypto";
import { verifyTotp } from "@/server/auth/mfa";
import { decryptSecret } from "@/server/auth/crypto";
import { TOTP, Secret } from "otpauth";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { createHash } from "node:crypto";

const db = testDb();
const email = new ConsoleEmailChannel();
const meta = { ipAddress: "127.0.0.1", userAgent: "vitest" };
const PASSWORD = "Str0ngPassw0rd!";

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16";
  process.env.APP_URL = "http://localhost:3000";
  await resetDb(db);
  setEmailChannelForTests(email);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const body = "# Terms\n\nLEGAL_PLACEHOLDER";
  const sum = createHash("sha256").update(body).digest("hex");
  await db.agreement.createMany({
    data: [
      { type: "CLIENT_TOS", version: 1, title: "Client TOS", bodyMarkdown: body, bodyChecksum: sum, effectiveFrom: new Date(), requiredForRole: "CLIENT" },
      { type: "CLIENT_NON_CIRCUMVENTION", version: 1, title: "Client NC", bodyMarkdown: body, bodyChecksum: sum, effectiveFrom: new Date(), requiredForRole: "CLIENT" },
      { type: "AGENT_PLATFORM_TERMS", version: 1, title: "Agent terms", bodyMarkdown: body, bodyChecksum: sum, effectiveFrom: new Date(), requiredForRole: "AGENT" },
    ],
  });
  await db.skill.createMany({ data: [{ name: "Cold Calling", category: "Sales" }, { name: "Appointment Setting", category: "Sales" }, { name: "CRM Management", category: "Tools" }] });
  const staffRole = await db.role.findUniqueOrThrow({ where: { key: "SALES" } });
  await db.user.create({ data: { id: "sales_1", email: "sales@hirewise.example", roleId: staffRole.id } });
  const recRole = await db.role.findUniqueOrThrow({ where: { key: "RECRUITER" } });
  await db.user.create({ data: { id: "rec_1", email: "recruiter@hirewise.example", roleId: recRole.id } });
  const adminRole = await db.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
  await db.user.create({ data: { id: "admin_1", email: "admin-reviewer@hirewise.example", roleId: adminRole.id } });
});

afterAll(async () => {
  setEmailChannelForTests(null);
  await db.$disconnect();
});

const clientInput = {
  companyName: "Acme Solar",
  contactName: "Jordan Lee",
  position: "Head of Sales",
  email: "jordan@acme-solar.example",
  password: PASSWORD,
  phone: "+1 555 0100",
  industry: "Solar / Energy",
  website: "https://acme-solar.example",
  country: "United States",
  timezone: "America/Los_Angeles",
  servicesNeeded: ["Cold Calling"],
  agentsRequired: 2,
  preferredSchedule: "",
  expectedStartDate: "",
  notes: "",
};

describe("client registration (Section 8.1)", () => {
  it("rejects free-mail domains by default", async () => {
    await expect(registerClient(db, { ...clientInput, email: "someone@gmail.com" }, meta)).rejects.toThrow(RegistrationError);
  });

  it("creates user, client, contact, onboarding, audit, and events; starts a session", async () => {
    resetRateLimits();
    const r = await registerClient(db, clientInput, meta);
    expect(r.token).toBeTruthy();
    const client = await db.client.findUniqueOrThrow({ where: { id: r.clientId }, include: { contacts: true, onboarding: true } });
    expect(client.status).toBe("PENDING_REVIEW");
    expect(client.contacts[0].userId).toBe(r.userId);
    expect(client.onboarding?.agentsRequired).toBe(2);
    expect(await db.auditLog.count({ where: { action: "CLIENT_REGISTERED", entityId: r.clientId } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { type: "CLIENT_REGISTERED" } })).toBe(1);
    expect(await db.authToken.count({ where: { kind: "EMAIL_VERIFY", userId: r.userId } })).toBe(1);
    expect(await db.session.count({ where: { tokenHash: sha256(r.token) } })).toBe(1);
  });

  it("rejects duplicate emails", async () => {
    resetRateLimits();
    await expect(registerClient(db, clientInput, meta)).rejects.toThrow(/already exists/);
  });

  it("worker turns CLIENT_REGISTERED into a Sales notification and a QUALIFY_CLIENT task", async () => {
    await runWorkerOnce(db);
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: "sales_1", type: "NEW_CLIENT_REGISTRATION" } })).toBe(1);
    expect(await db.task.count({ where: { type: "QUALIFY_CLIENT", queueRole: "SALES", status: "OPEN" } })).toBe(1);
  });
});

describe("login, verification, agreements gate, activation", () => {
  it("logs in with the right password and rejects the wrong one with a generic message", async () => {
    resetRateLimits();
    const ok = await loginWithPassword(db, { email: clientInput.email, password: PASSWORD, remember: false, ...meta });
    expect(ok.role).toBe("CLIENT");
    await expect(loginWithPassword(db, { email: clientInput.email, password: "wrong-password!", remember: false, ...meta })).rejects.toThrow("Incorrect email or password.");
    await expect(loginWithPassword(db, { email: "nobody@acme.example", password: PASSWORD, remember: false, ...meta })).rejects.toThrow("Incorrect email or password.");
  });

  it("rate-limits repeated failures per email", async () => {
    resetRateLimits();
    for (let i = 0; i < 8; i++) await loginWithPassword(db, { email: clientInput.email, password: "bad", remember: false, ...meta }).catch(() => {});
    await expect(loginWithPassword(db, { email: clientInput.email, password: PASSWORD, remember: false, ...meta })).rejects.toThrow(/Too many/);
    resetRateLimits();
  });

  it("email verification token works once", async () => {
    const t = await db.authToken.findFirstOrThrow({ where: { kind: "EMAIL_VERIFY", email: clientInput.email, usedAt: null } });
    // The raw token is not stored; simulate by creating a known one.
    const raw = "known-token-for-test";
    await db.authToken.update({ where: { id: t.id }, data: { tokenHash: sha256(raw) } });
    const r = await verifyEmail(db, raw);
    expect((await db.user.findUniqueOrThrow({ where: { id: r.userId } })).emailVerifiedAt).not.toBeNull();
    await expect(verifyEmail(db, raw)).rejects.toThrow(AuthError);
  });

  it("client must accept each required agreement; acceptance is audited with checksum", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email: clientInput.email } });
    const actor = await resolveActor(db, user.id);
    expect(actor.role).toBe("CLIENT");
    expect(actor.clientId).toBeTruthy();
    expect((await missingAgreementsFor(db, actor)).length).toBe(2);

    const [first] = await agreementsFor(db, actor);
    await acceptAgreement(db, actor, first.id, meta);
    expect((await missingAgreementsFor(db, actor)).length).toBe(1);
    // Accepting twice is idempotent.
    await acceptAgreement(db, actor, first.id, meta);
    expect(await db.agreementAcceptance.count({ where: { userId: user.id } })).toBe(1);
    const a = await db.auditLog.findFirst({ where: { action: "CLIENT_AGREEMENT_ACCEPTED", actorUserId: user.id } });
    expect(a?.ipAddress).toBe("127.0.0.1");
    // An agent agreement cannot be accepted by a client.
    const agentAgreement = await db.agreement.findFirstOrThrow({ where: { requiredForRole: "AGENT" } });
    await expect(acceptAgreement(db, actor, agentAgreement.id, meta)).rejects.toThrow(NotFoundError);
  });

  it("only staff with client.manage can activate; SALES becomes account manager", async () => {
    const client = await db.client.findFirstOrThrow();
    await expect(activateClient(db, makeActor("RECRUITER", { userId: "rec_1" }), client.id)).rejects.toThrow(ForbiddenError);
    await activateClient(db, makeActor("SALES", { userId: "sales_1" }), client.id, { reason: "Verified by phone" });
    const after = await db.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.accountManagerUserId).toBe("sales_1");
    expect(await db.auditLog.count({ where: { action: "CLIENT_ACTIVATED", entityId: client.id } })).toBe(1);
    await runWorkerOnce(db);
    expect(await db.task.count({ where: { type: "QUALIFY_CLIENT", status: "DONE" } })).toBe(1);
  });

  it("client sees only their own company; staff list requires client.read", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email: clientInput.email } });
    const actor = await resolveActor(db, user.id);
    expect((await getOwnClient(db, actor)).companyName).toBe("Acme Solar");
    await expect(listClientsForStaff(db, makeActor("COACH"))).rejects.toThrow(ForbiddenError);
    expect((await listClientsForStaff(db, makeActor("SALES"))).length).toBe(1);
  });

  it("magic link signs in and verifies email; second use fails", async () => {
    resetRateLimits();
    process.env.DEV_EXPOSE_LINKS = "true";
    const r = await requestMagicLink(db, { email: clientInput.email, ...meta });
    expect(r.devUrl).toMatch(/\/api\/auth\/magic\//);
    const raw = r.devUrl!.split("/").pop()!;
    const s = await consumeMagicLink(db, { token: raw, ...meta });
    expect(s.role).toBe("CLIENT");
    await expect(consumeMagicLink(db, { token: raw, ...meta })).rejects.toThrow(AuthError);
    // Unknown emails produce no token and no error.
    expect(await requestMagicLink(db, { email: "ghost@acme.example", ...meta })).toEqual({});
  });
});

describe("agent registration → profile → submission → review", () => {
  const agentInput = { fullName: "Maria Santos", displayName: "Maria S.", email: "maria@talent.example", password: PASSWORD, phone: "", locationCity: "Cebu City", locationCountry: "Philippines", timezone: "Asia/Manila", primaryRole: "Appointment Setter", yearsExperience: 4 };
  let agentUserId = "";
  let agentProfileId = "";

  it("registers with a private contact record and DRAFT profile", async () => {
    resetRateLimits();
    const r = await registerAgent(db, agentInput, meta);
    agentUserId = r.userId;
    agentProfileId = r.agentProfileId;
    const p = await db.agentProfile.findUniqueOrThrow({ where: { id: r.agentProfileId }, include: { privateContact: true } });
    expect(p.status).toBe("DRAFT");
    expect(p.privateContact?.fullLegalName).toBe("Maria Santos");
    expect(await db.outboxEvent.count({ where: { type: "AGENT_REGISTERED" } })).toBe(1);
  });

  it("agent can only edit their own profile; skills outside the taxonomy are ignored", async () => {
    const actor = await resolveActor(db, agentUserId);
    expect(actor.agentProfileId).toBe(agentProfileId);
    const skills = await db.skill.findMany();
    await updateSkills(db, actor, { skills: [...skills.map((s) => ({ skillId: s.id, level: "ADVANCED" as const, yearsUsed: 2 })), { skillId: "not-a-skill", level: "EXPERT" as const }], software: [] });
    const view = await getOwnProfile(db, actor);
    expect(view.skills.length).toBe(3);
    const other = makeActor("AGENT", { userId: "x", agentProfileId: "someone-else" });
    await expect(getOwnProfile(db, other)).rejects.toThrow(NotFoundError);
  });

  it("submission is blocked until completion, résumé, and video are present", async () => {
    const actor = await resolveActor(db, agentUserId);
    const view = await getOwnProfile(db, actor);
    expect(computeCompletion(view).total).toBeLessThan(80);
    await expect(submitForReview(db, actor)).rejects.toThrow(SubmissionBlockedError);
  });

  it("with the guard satisfied, submit → recruiter reviews → admin approves, with audit and notifications", async () => {
    // Satisfy the guard directly: résumé key, a submitted video, a voice sample, and text sections.
    await db.agentPrivateContact.update({ where: { agentProfileId }, data: { resumeKey: `agents/${agentProfileId}/resume/x.pdf` } });
    await db.video.create({ data: { agentProfileId, storageKey: `agents/${agentProfileId}/video/x.mp4`, status: "SUBMITTED", isCurrent: true } });
    await db.recording.create({ data: { agentProfileId, kind: "COLD_CALL", title: "Solar", storageKey: `agents/${agentProfileId}/recording/x.mp3`, status: "SUBMITTED" } });
    await db.agentProfile.update({ where: { id: agentProfileId }, data: { headline: "Appointment setter with four years of US solar experience", summary: "x".repeat(120), experienceLevel: "MID", languages: ["English"], workSetup: "REMOTE" } });
    await db.experience.create({ data: { agentProfileId, title: "Setter", startDate: new Date("2024-01-01") } });

    const actor = await resolveActor(db, agentUserId);
    expect(computeCompletion(await getOwnProfile(db, actor)).total).toBeGreaterThanOrEqual(80);
    await submitForReview(db, actor);
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: agentProfileId } })).status).toBe("SUBMITTED");
    expect(await db.auditLog.count({ where: { action: "PROFILE_SUBMITTED", entityId: agentProfileId } })).toBe(1);

    await runWorkerOnce(db);
    expect(await db.task.count({ where: { type: "REVIEW_PROFILE", relatedId: agentProfileId, status: "OPEN" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: "rec_1", type: "PROFILE_SUBMITTED" } })).toBe(1);

    const recruiter = makeActor("RECRUITER", { userId: "rec_1" });
    await reviewTransition(db, recruiter, agentProfileId, "UNDER_REVIEW");
    await expect(reviewTransition(db, recruiter, agentProfileId, "APPROVED")).rejects.toThrow(ForbiddenError);
    await expect(reviewTransition(db, makeActor("SALES"), agentProfileId, "APPROVED")).rejects.toThrow(ForbiddenError);

    const admin = makeActor("ADMIN", { userId: "admin_1" });
    await reviewTransition(db, admin, agentProfileId, "APPROVED");
    const p = await db.agentProfile.findUniqueOrThrow({ where: { id: agentProfileId } });
    expect(p.status).toBe("APPROVED");
    expect(p.availabilityStatus).toBe("AVAILABLE");
    expect(p.approvedById).toBe("admin_1");
    expect(await db.agentAvailability.count({ where: { agentProfileId, status: "AVAILABLE" } })).toBe(1);

    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: agentUserId, type: "PROFILE_APPROVED" } })).toBe(1);
    expect(await db.task.count({ where: { type: "REVIEW_PROFILE", relatedId: agentProfileId, status: "DONE" } })).toBe(1);
  });

  it("pipeline list shows login email only with agent.read_private_contact", async () => {
    const { listAgentsForStaff } = await import("@/server/services/agent.service");
    const sales = await listAgentsForStaff(db, makeActor("SALES"));
    expect(sales.length).toBe(1);
    expect(sales[0].email).toBeNull();
    const recruiter = await listAgentsForStaff(db, makeActor("RECRUITER"));
    expect(recruiter[0].email).toBe("maria@talent.example");
  });

  it("staff detail hides private contact without agent.read_private_contact", async () => {
    const sales = await getAgentForStaff(db, makeActor("SALES"), agentProfileId);
    expect(sales.privateContact).toBeNull();
    expect(sales.email).toBeNull();
    const recruiter = await getAgentForStaff(db, makeActor("RECRUITER"), agentProfileId);
    expect(recruiter.privateContact?.fullLegalName).toBe("Maria Santos");
    await expect(getAgentForStaff(db, makeActor("CLIENT", { clientId: "c" }), agentProfileId)).rejects.toThrow(ForbiddenError);
  });
});

describe("MFA enrolment (Section 3, Auth)", () => {
  it("admin login yields a session without mfaPassed; enrolment verifies a TOTP code", async () => {
    resetRateLimits();
    const adminRole = await db.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
    const { hashPassword } = await import("@/server/auth/password");
    const admin = await db.user.create({ data: { email: "admin@hirewise.example", roleId: adminRole.id, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date() } });
    const login = await loginWithPassword(db, { email: admin.email, password: PASSWORD, remember: false, ...meta });
    const session = await db.session.findFirstOrThrow({ where: { tokenHash: sha256(login.token) } });
    expect(session.mfaPassed).toBe(false);

    const actor = await resolveActor(db, admin.id);
    const enrol = await beginMfaEnrollment(db, actor, admin.email);
    expect(enrol.qrDataUrl).toMatch(/^data:image\/png/);
    await expect(completeMfaEnrollment(db, actor, session.id, "000000")).rejects.toThrow(AuthError);

    const secretEnc = (await db.user.findUniqueOrThrow({ where: { id: admin.id } })).mfaSecretEnc!;
    const code = new TOTP({ secret: Secret.fromBase32(decryptSecret(secretEnc)) }).generate();
    expect(verifyTotp(secretEnc, code)).toBe(true);
    await completeMfaEnrollment(db, actor, session.id, code);
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).mfaPassed).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).mfaEnabled).toBe(true);
    expect(await db.auditLog.count({ where: { action: "MFA_ENROLLED", entityId: admin.id } })).toBe(1);
  });
});
