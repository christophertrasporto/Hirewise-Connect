import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { seedTerms } from "../setup/terms";
import { requestLeave, cancelLeave, requestRemoval, agencyDecide, adminDecide, myMembership, exitRequestsForAgency, exitRequestsForStaff, escalateStaleExitRequests, completeDueExits, releaseDueSeats, archiveFormerProfiles, nextBillingBoundary } from "@/server/services/exit.service";
import { seatTotals, agencyMembers, adminChangeSeats } from "@/server/services/seat.service";
import { inviteLinkForAgency, registerViaInvite, joinAsExistingUser } from "@/server/services/invite.service";
import { createAgencyDirect, setAgentAgency, agencyAgents } from "@/server/services/agency.service";
import { setSetting } from "@/server/services/setting.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { IllegalTransitionError } from "@/server/state/agent-profile";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { FORBIDDEN_FOR_AGENCY, collectKeys } from "@/server/views/forbidden-keys";
import { runWorkerOnce } from "@/server/jobs/worker";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";

const db = testDb();
const email = new ConsoleEmailChannel();
const meta = { ipAddress: "198.51.100.11", userAgent: "vitest" };
const PASSWORD = "Str0ngPassw0rd!";
const ids = { super: "su_exit", admin: "admin_exit", sales: "sales_exit", ownerUser: "", agencyA: "", agencyB: "", ownerB: "", clientId: "", link: "" };
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
  await db.plan.createMany({ data: [{ id: "plan_starter", key: "STARTER", name: "Starter", baseAgentSeats: 5, sortOrder: 1 }, { id: "plan_growth", key: "GROWTH", name: "Growth", baseAgentSeats: 20, billingPeriod: "MONTHLY", sortOrder: 2 }] });
  const applicantRole = await role("APPLICANT");
  const o = await db.user.create({ data: { email: "owner-a@agency.example", roleId: applicantRole, emailVerifiedAt: new Date() } });
  ids.ownerUser = o.id;
  const ob = await db.user.create({ data: { email: "owner-b@agency.example", roleId: applicantRole, emailVerifiedAt: new Date() } });
  ids.ownerB = ob.id;
  ids.agencyA = await createAgencyDirect(db, superAdmin(), { ownerEmail: "owner-a@agency.example", name: "Agency A", country: "Philippines", reason: "exit tests", planKey: "STARTER" });
  ids.agencyB = await createAgencyDirect(db, superAdmin(), { ownerEmail: "owner-b@agency.example", name: "Agency B", country: "Philippines", reason: "exit tests", planKey: "STARTER" });
  ids.link = (await inviteLinkForAgency(db, await owner())).url.split("/join/")[1];
  const client = await db.client.create({ data: { companyName: "Acme", status: "ACTIVE", timezone: "America/Los_Angeles" } });
  ids.clientId = client.id;
  await joinNew("Ana", "ana@talent.example");
  await joinNew("Ben", "ben@talent.example");
  await joinNew("Cara", "cara@talent.example");
  await joinNew("Dan", "dan@talent.example");
});

afterAll(async () => {
  setEmailChannelForTests(null);
  await db.$disconnect();
});

describe("billing boundaries", () => {
  it("finds the next period boundary from the plan start", () => {
    const start = new Date("2026-01-15T00:00:00Z");
    expect(nextBillingBoundary(start, "MONTHLY", new Date("2026-03-20T00:00:00Z")).toISOString()).toBe("2026-04-15T00:00:00.000Z");
    expect(nextBillingBoundary(start, "ANNUAL", new Date("2026-03-20T00:00:00Z")).toISOString()).toBe("2027-01-15T00:00:00.000Z");
  });
});

describe("Request to Leave", () => {
  it("the agent asks with a reason; the owner is notified; the agent can withdraw before a decision", async () => {
    const a = await agent("Ana");
    await expect(requestLeave(db, a, { reason: "short" }, meta)).rejects.toThrow();
    await expect(requestLeave(db, admin(), { reason: "Staff cannot ask to leave anything" }, meta)).rejects.toThrow(ForbiddenError);
    const r = await requestLeave(db, a, { reason: "Moving to a different schedule next month", effectiveOption: "END_OF_BILLING_PERIOD" }, meta);
    expect(r).toMatchObject({ type: "AGENT_REQUESTED_LEAVE", status: "PENDING_AGENCY", adminRequired: false });
    expect((await myMembership(db, a))).toMatchObject({ kind: "MEMBER", status: "EXIT_REQUESTED" });
    await expect(requestLeave(db, a, { reason: "A second request while one is open" }, meta)).rejects.toThrow(ForbiddenError);
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.ownerUser, type: "EXIT_REQUESTED" } })).toBe(1);
    await cancelLeave(db, a, meta);
    expect((await myMembership(db, a))).toMatchObject({ kind: "MEMBER", status: "ACTIVE", exit: null });
    expect((await db.exitRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CANCELLED");
  });

  it("owner approval with immediate effect ends the membership, releases the seat, and marks the profile former", async () => {
    const a = await agent("Ana");
    const r = await requestLeave(db, a, { reason: "Moving to a different schedule next month" }, meta);
    await expect(agencyDecide(db, sales(), r.id, { decision: "APPROVE" })).rejects.toThrow(ForbiddenError);
    await expect(agencyDecide(db, await resolveActor(db, ids.ownerB), r.id, { decision: "APPROVE" })).rejects.toThrow(NotFoundError);
    const before = await seatTotals(db, ids.agencyA);
    const decided = await agencyDecide(db, await owner(), r.id, { decision: "APPROVE", effectiveOption: "IMMEDIATE", note: "Best of luck" });
    expect(decided.status).toBe("COMPLETED");
    const after = await seatTotals(db, ids.agencyA);
    expect(after.used).toBe(before.used - 1);
    expect(after.pendingRelease).toBe(0);
    const m = await db.agencyMembership.findFirstOrThrow({ where: { agentProfileId: people.Ana.profileId }, include: { agentProfile: true } });
    expect(m).toMatchObject({ status: "ENDED", seatReleaseRule: "IMMEDIATE" });
    expect(m.seatReleasedAt).toBeTruthy();
    expect(m.endReason).toMatch(/Left at own request/);
    expect(m.agentProfile).toMatchObject({ status: "FORMER_AGENCY_AGENT", primaryAgencyId: null, formerAgencyId: ids.agencyA, availabilityStatus: "UNAVAILABLE" });
    expect(m.agentProfile.hiddenAt).toBeTruthy();
    expect(await db.agentProfile.count({ where: { id: people.Ana.profileId, deletedAt: null } })).toBe(1);
    const mine = await myMembership(db, await resolveActor(db, people.Ana.userId));
    expect(mine).toMatchObject({ kind: "FORMER", agencyName: "Agency A" });
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: people.Ana.userId, type: "AGENCY_EXIT_COMPLETED" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: people.Ana.userId, type: "EXIT_DECIDED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "EXIT_COMPLETED", entityId: r.id } })).toBe(1);
  });

  it("a decline returns the membership to active", async () => {
    const b = await agent("Ben");
    const r = await requestLeave(db, b, { reason: "Thinking about going independent" }, meta);
    const decided = await agencyDecide(db, await owner(), r.id, { decision: "DECLINE", note: "Let us talk first" });
    expect(decided.status).toBe("DECLINED");
    expect((await myMembership(db, b))).toMatchObject({ kind: "MEMBER", status: "ACTIVE", exit: null });
    await expect(agencyDecide(db, await owner(), r.id, { decision: "APPROVE" })).rejects.toThrow(ForbiddenError);
  });
});

describe("Hirewise review", () => {
  it("an active client assignment sends an approved leave to Hirewise; Hirewise approves with a billing-period end", async () => {
    await db.placement.create({ data: { clientId: ids.clientId, agentProfileId: people.Ben.profileId, positionTitle: "Setter", status: "ACTIVE" } });
    const b = await agent("Ben");
    const r = await requestLeave(db, b, { reason: "Family reasons, need to stop soon", effectiveOption: "IMMEDIATE" }, meta);
    expect(r.adminRequired).toBe(true);
    const owned = await agencyDecide(db, await owner(), r.id, { decision: "APPROVE", effectiveOption: "END_OF_BILLING_PERIOD" });
    expect(owned.status).toBe("PENDING_ADMIN");
    await runWorkerOnce(db);
    expect(await db.task.count({ where: { type: "REVIEW_EXIT_REQUEST", relatedId: r.id, status: "OPEN" } })).toBe(1);
    await expect(adminDecide(db, sales(), r.id, { decision: "APPROVE" })).rejects.toThrow(ForbiddenError);
    const queue = await exitRequestsForStaff(db, admin(), "PENDING_ADMIN");
    expect(queue.rows.some((x) => x.id === r.id)).toBe(true);
    const done = await adminDecide(db, admin(), r.id, { decision: "APPROVE", note: "Agreed with the client" });
    expect(done.status).toBe("APPROVED");
    expect(done.effectiveAt).toBeTruthy();
    const m = await db.agencyMembership.findFirstOrThrow({ where: { agentProfileId: people.Ben.profileId } });
    expect(m.status).toBe("ENDING");
    expect((await seatTotals(db, ids.agencyA)).pendingRelease).toBe(1);
    expect((await myMembership(db, b))).toMatchObject({ kind: "MEMBER", status: "ENDING" });
    // The worker completes it once the date passes.
    expect(await completeDueExits(db, new Date())).toBe(0);
    expect(await completeDueExits(db, new Date(done.effectiveAt!.getTime() + 1000))).toBe(1);
    expect((await db.agencyMembership.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("ENDED");
    expect((await db.exitRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("COMPLETED");
    await runWorkerOnce(db);
    expect(await db.task.count({ where: { type: "REVIEW_EXIT_REQUEST", relatedId: r.id, status: "OPEN" } })).toBe(0);
  });

  it("owner silence escalates to Hirewise after the configured window", async () => {
    await setSetting(db, superAdmin(), "agencyExit", { ownerResponseDays: 2, adminReviewAlways: false, archiveAfterDays: 30 });
    const c = await agent("Cara");
    const r = await requestLeave(db, c, { reason: "Relocating abroad for a year" }, meta);
    expect(await escalateStaleExitRequests(db, new Date())).toBe(0);
    expect(await escalateStaleExitRequests(db, new Date(Date.now() + 3 * 24 * 60 * 60_000))).toBe(1);
    const row = await db.exitRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe("PENDING_ADMIN");
    expect(row.escalatedAt).toBeTruthy();
    await expect(agencyDecide(db, await owner(), r.id, { decision: "APPROVE" })).rejects.toThrow(ForbiddenError);
    const declined = await adminDecide(db, admin(), r.id, { decision: "DECLINE", note: "Please discuss with your agency first" });
    expect(declined.status).toBe("DECLINED");
    expect((await myMembership(db, c))).toMatchObject({ kind: "MEMBER", status: "ACTIVE" });
  });
});

describe("Remove Agent", () => {
  it("the agency removes an agent immediately when no assignment is open; the seat is released per the rule", async () => {
    await setSetting(db, superAdmin(), "agencySeats", { seatReleaseRule: "AFTER_BILLING_PERIOD", inviteLinkTtlDays: 0, emailInviteTtlDays: 14, unverifiedJoinTtlDays: 14 });
    const members = await agencyMembers(db, await owner());
    const cara = members.find((m) => m.agentProfileId === people.Cara.profileId)!;
    await expect(requestRemoval(db, sales(), { membershipId: cara.membershipId, reason: "Staff cannot remove through the portal" }, meta)).rejects.toThrow(ForbiddenError);
    await expect(requestRemoval(db, await resolveActor(db, ids.ownerB), { membershipId: cara.membershipId, reason: "Another agency cannot remove our agent" }, meta)).rejects.toThrow(NotFoundError);
    const before = await seatTotals(db, ids.agencyA);
    const r = await requestRemoval(db, await owner(), { membershipId: cara.membershipId, reason: "Campaign ended; no further work available", effectiveOption: "IMMEDIATE" }, meta);
    expect(r.status).toBe("COMPLETED");
    const m = await db.agencyMembership.findUniqueOrThrow({ where: { id: cara.membershipId } });
    expect(m).toMatchObject({ status: "ENDED", seatReleaseRule: "AFTER_BILLING_PERIOD" });
    expect(m.seatReleasedAt).toBeNull();
    const after = await seatTotals(db, ids.agencyA);
    expect(after.used).toBe(before.used);
    expect(after.pendingRelease).toBeGreaterThanOrEqual(1);
    expect(await db.agencySeatLedger.count({ where: { relatedMembershipId: m.id, changeType: "PENDING_RELEASE" } })).toBe(1);
    // The worker releases it after the billing period.
    expect(await releaseDueSeats(db, new Date())).toBe(0);
    const far = new Date(Date.now() + 40 * 24 * 60 * 60_000);
    expect(await releaseDueSeats(db, far)).toBeGreaterThanOrEqual(1);
    expect((await db.agencyMembership.findUniqueOrThrow({ where: { id: cara.membershipId } })).seatReleasedAt).toBeTruthy();
    expect((await seatTotals(db, ids.agencyA)).used).toBe(before.used - 1);
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: people.Cara.userId, type: "EXIT_REQUESTED" } })).toBe(1);
    await setSetting(db, superAdmin(), "agencySeats", { seatReleaseRule: "IMMEDIATE", inviteLinkTtlDays: 0, emailInviteTtlDays: 14, unverifiedJoinTtlDays: 14 });
  });

  it("a removal with an open assignment waits for Hirewise; end-of-assignment completes when the placement closes", async () => {
    const pl = await db.placement.create({ data: { clientId: ids.clientId, agentProfileId: people.Dan.profileId, positionTitle: "CSR", status: "DEPLOYMENT_PREP" } });
    const members = await agencyMembers(db, await owner());
    const dan = members.find((m) => m.agentProfileId === people.Dan.profileId)!;
    const r = await requestRemoval(db, await owner(), { membershipId: dan.membershipId, reason: "Performance concerns raised by the client", effectiveOption: "END_OF_ASSIGNMENT" }, meta);
    expect(r).toMatchObject({ status: "PENDING_ADMIN", adminRequired: true });
    expect((await db.agencyMembership.findUniqueOrThrow({ where: { id: dan.membershipId } })).status).toBe("REMOVAL_REQUESTED");
    const approved = await adminDecide(db, admin(), r.id, { decision: "APPROVE" });
    expect(approved).toMatchObject({ status: "APPROVED", effectiveAt: null });
    expect(await completeDueExits(db)).toBe(0);
    await db.placement.update({ where: { id: pl.id }, data: { status: "COMPLETED" } });
    expect(await completeDueExits(db)).toBe(1);
    expect((await db.agencyMembership.findUniqueOrThrow({ where: { id: dan.membershipId } })).status).toBe("ENDED");
    const views = await exitRequestsForAgency(db, await owner());
    const keys = collectKeys(views);
    for (const k of FORBIDDEN_FOR_AGENCY) expect(keys.has(k), `forbidden key present: ${k}`).toBe(false);
    await expect(exitRequestsForAgency(db, await resolveActor(db, ids.ownerB), ids.agencyA)).rejects.toThrow(NotFoundError);
  });
});

describe("after leaving", () => {
  it("the former agent cannot act as a member, rejoins with a fresh profile (setting on), and the old profile is archived", async () => {
    const ana = await resolveActor(db, people.Ana.userId);
    await expect(requestLeave(db, ana, { reason: "No membership to leave any more" }, meta)).rejects.toThrow(NotFoundError);
    expect((await agencyAgents(db, await owner())).some((a) => a.id === people.Ana.profileId)).toBe(false);
    // Rejoin through Agency B's link: fresh profile, same identity, no credentials copied.
    const linkB = (await inviteLinkForAgency(db, await resolveActor(db, ids.ownerB))).url.split("/join/")[1];
    const member = await joinAsExistingUser(db, ana, linkB, meta);
    expect(member.agentProfileId).not.toBe(people.Ana.profileId);
    const old = await db.agentProfile.findUniqueOrThrow({ where: { id: people.Ana.profileId } });
    expect(old.status).toBe("ARCHIVED");
    expect(old.archivedAt).toBeTruthy();
    const fresh = await db.agentProfile.findUniqueOrThrow({ where: { id: member.agentProfileId }, include: { privateContact: true } });
    expect(fresh).toMatchObject({ userId: people.Ana.userId, platformIdentityId: old.platformIdentityId, talentType: "AGENCY_AGENT", status: "DRAFT", displayName: "Ana" });
    expect(fresh.privateContact?.fullLegalName).toBe("Test Talent");
    expect((await resolveActor(db, people.Ana.userId)).agentProfileId).toBe(fresh.id);
    expect(await db.auditLog.count({ where: { action: "PROFILE_FRESH_CREATED", entityId: fresh.id } })).toBe(1);
  });

  it("with the setting off, the former profile is reactivated instead", async () => {
    await setSetting(db, superAdmin(), "identity", { rejoinCreatesFreshProfile: false, duplicateCheckPhone: true, notifyExistingOnDuplicate: true, continuationLinkHours: 72 });
    const ben = await resolveActor(db, people.Ben.userId);
    expect((await myMembership(db, ben))).toMatchObject({ kind: "FORMER" });
    const member = await joinAsExistingUser(db, ben, ids.link, meta);
    expect(member.agentProfileId).toBe(people.Ben.profileId);
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: people.Ben.profileId } })).status).toBe("DRAFT");
    await setSetting(db, superAdmin(), "identity", { rejoinCreatesFreshProfile: true, duplicateCheckPhone: true, notifyExistingOnDuplicate: true, continuationLinkHours: 72 });
  });

  it("former profiles are archived after the window; an Admin override runs the same exit actions", async () => {
    await setSetting(db, superAdmin(), "agencyExit", { ownerResponseDays: 5, adminReviewAlways: false, archiveAfterDays: 1 });
    expect(await archiveFormerProfiles(db, new Date())).toBe(0);
    expect(await archiveFormerProfiles(db, new Date(Date.now() + 3 * 24 * 60 * 60_000))).toBeGreaterThanOrEqual(1);
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: people.Cara.profileId } })).status).toBe("ARCHIVED");
    expect((await resolveActor(db, people.Cara.userId)).agentProfileId).toBeUndefined();
    // Admin override on an active member of Agency B (Ana's fresh profile).
    const fresh = await db.agentProfile.findFirstOrThrow({ where: { userId: people.Ana.userId, archivedAt: null } });
    await adminChangeSeats(db, admin(), { agencyId: ids.agencyA, changeType: "ADMIN_ADD", quantity: 5, reason: "Room for the transfer" });
    await setAgentAgency(db, admin(), fresh.id, ids.agencyA, "Owners agreed to a transfer");
    const endedB = await db.agencyMembership.findFirstOrThrow({ where: { agencyId: ids.agencyB, agentProfileId: fresh.id } });
    expect(endedB.status).toBe("ENDED");
    expect(endedB.endReason).toMatch(/Admin override/);
    // Transfer: the profile that just left B is former, so the join creates yet another fresh profile in A.
    const current = await db.agentProfile.findFirstOrThrow({ where: { userId: people.Ana.userId, archivedAt: null } });
    expect(current.id).not.toBe(fresh.id);
    expect((await db.agencyMembership.findFirstOrThrow({ where: { agentProfileId: current.id } })).agencyId).toBe(ids.agencyA);
    await expect(() => { throw new IllegalTransitionError("x", "y"); }).toThrow(IllegalTransitionError);
  });
});
