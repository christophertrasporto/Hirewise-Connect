import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { seedTerms } from "../setup/terms";
import { computeTotals, seatTotals, adminChangeSeats, assignPlan, requestSeats, decideSeatRequest, purchasePackage, recordSeatPurchase, listSeatRequests, listSeatPurchases, seatSummary, agencyMembers, savePlan, savePackage, listPlansForAdmin, expireUnverifiedJoins, activatePendingMemberships, SeatCapacityError } from "@/server/services/seat.service";
import { inviteLinkForAgency, rotateInviteLink, sendEmailInvites, revokeEmailInvite, joinPageInfo, joinAsExistingUser, registerViaInvite, listEmailInvites } from "@/server/services/invite.service";
import { createAgencyDirect, setAgentAgency, getAgencyForStaff } from "@/server/services/agency.service";
import { registerAgent } from "@/server/services/agent.service";
import { verifyEmail } from "@/server/services/auth.service";
import { setSetting } from "@/server/services/setting.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { DuplicateDetectedError } from "@/server/services/identity.service";
import { ROLE_NAMES, ROLE_PERMISSIONS, type RoleKey } from "@/server/policies/permissions";
import { FORBIDDEN_FOR_AGENCY, collectKeys } from "@/server/views/forbidden-keys";
import { runWorkerOnce } from "@/server/jobs/worker";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";
import { sha256 } from "@/server/auth/crypto";

const db = testDb();
const email = new ConsoleEmailChannel();
const meta = { ipAddress: "198.51.100.9", userAgent: "vitest" };
const PASSWORD = "Str0ngPassw0rd!";
const ids = { super: "su_seat", admin: "admin_seat", sales: "sales_seat", ownerUser: "", agencyA: "", agencyB: "", ownerB: "", directUser: "", directProfile: "" };

const talent = (over: Record<string, unknown> = {}) => ({ termsAccepted: true, fullName: "Test Talent", displayName: "Test T.", email: "t@talent.example", password: PASSWORD, phone: "", locationCity: "Cebu", locationCountry: "Philippines", timezone: "Asia/Manila", primaryRole: "Cold Caller", yearsExperience: 2, ...over });
const superAdmin = () => makeActor("SUPER_ADMIN", { userId: ids.super });
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const owner = () => resolveActor(db, ids.ownerUser);

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
  // Plans and packages exactly as the data migration seeds them.
  await db.plan.createMany({ data: [
    { id: "plan_starter", key: "STARTER", name: "Starter", baseAgentSeats: 5, sortOrder: 1 },
    { id: "plan_growth", key: "GROWTH", name: "Growth", baseAgentSeats: 20, sortOrder: 2 },
    { id: "plan_enterprise", key: "ENTERPRISE", name: "Enterprise", baseAgentSeats: null, sortOrder: 4 },
  ] });
  await db.seatPackage.createMany({ data: [{ id: "pkg_5", name: "5 additional agent seats", seatCount: 5, priceMinor: 9900, sortOrder: 1 }] });
  // Agency owners: an applicant-type account (no talent profile) owns agency A; agency B has an owner too.
  const applicantRole = await role("APPLICANT");
  const o = await db.user.create({ data: { email: "owner-a@agency.example", roleId: applicantRole, emailVerifiedAt: new Date() } });
  ids.ownerUser = o.id;
  const ob = await db.user.create({ data: { email: "owner-b@agency.example", roleId: applicantRole, emailVerifiedAt: new Date() } });
  ids.ownerB = ob.id;
});

afterAll(async () => {
  setEmailChannelForTests(null);
  await db.$disconnect();
});

describe("ledger totals", () => {
  it("computes base, additional, promo, adjustments, used, and available from entry sums only", () => {
    const t = computeTotals({ PLAN_BASE: 5, PURCHASE: 10, PROMO_GRANT: 2, ADMIN_ADD: 3, ADMIN_REMOVE: 4, OVERRIDE: 1, CONSUMED: 9, RELEASED: 2 }, 1);
    expect(t).toEqual({ base: 5, additional: 10, promo: 2, adjustments: 0, total: 17, used: 7, pendingRelease: 1, available: 10 });
    expect(computeTotals({ PLAN_BASE: 2, CONSUMED: 3 }).available).toBe(0);
  });
});

describe("plans and direct creation", () => {
  it("direct creation with a plan writes the base seats; the owner without a profile takes no seat", async () => {
    resetRateLimits();
    ids.agencyA = await createAgencyDirect(db, superAdmin(), { ownerEmail: "owner-a@agency.example", name: "Agency A", country: "Philippines", reason: "seat tests", planKey: "STARTER" });
    const t = await seatTotals(db, ids.agencyA);
    expect(t).toMatchObject({ base: 5, total: 5, used: 0, available: 5 });
    const a = await getAgencyForStaff(db, admin(), ids.agencyA);
    expect(a.id).toBe(ids.agencyA);
    ids.agencyB = await createAgencyDirect(db, superAdmin(), { ownerEmail: "owner-b@agency.example", name: "Agency B", country: "Philippines", reason: "seat tests" });
    expect((await seatTotals(db, ids.agencyB)).total).toBe(0);
  });

  it("the ledger is append-only at the database", async () => {
    const entry = await db.agencySeatLedger.findFirstOrThrow({ where: { agencyId: ids.agencyA } });
    await expect(db.agencySeatLedger.update({ where: { id: entry.id }, data: { quantity: 99 } })).rejects.toThrow(/append-only/);
    await expect(db.agencySeatLedger.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
  });

  it("plans and packages are managed by Admins with agency.plans.manage; prices are data", async () => {
    await expect(savePlan(db, sales(), { key: "STARTER", name: "Starter", baseAgentSeats: 5, priceMinor: 4900 })).rejects.toThrow(ForbiddenError);
    const p = await savePlan(db, admin(), { key: "STARTER", name: "Starter", baseAgentSeats: 5, priceMinor: 4900, features: ["Up to 5 agent seats"] });
    expect(p.priceLabel).toBe("$49.00 / month");
    const pk = await savePackage(db, admin(), { name: "10 additional agent seats", seatCount: 10, priceMinor: 19900 });
    expect(pk.seatCount).toBe(10);
    expect((await listPlansForAdmin(db, admin())).map((x) => x.key)).toEqual(["STARTER", "GROWTH", "ENTERPRISE"]);
    expect(ROLE_PERMISSIONS.ADMIN).toEqual(expect.arrayContaining(["agency.plans.manage", "agency.seats.manage"]));
    expect(ROLE_PERMISSIONS.SALES).not.toContain("agency.seats.manage");
  });
});

describe("invitation link and joining", () => {
  let link = "";
  it("the owner gets a link; the public page shows only the agency name; sales cannot invite", async () => {
    const l = await inviteLinkForAgency(db, await owner());
    expect(l.url).toMatch(/\/join\//);
    link = l.url.split("/join/")[1];
    const info = await joinPageInfo(db, link);
    expect(info).toMatchObject({ kind: "LINK", agencyName: "Agency A", accepting: true });
    const keys = collectKeys(info);
    for (const k of ["contactEmail", "contactPhone", "website", "ownerUserId", "planId"]) expect(keys.has(k)).toBe(false);
    await expect(inviteLinkForAgency(db, sales())).rejects.toThrow(ForbiddenError);
    expect(await joinPageInfo(db, "nope")).toBeNull();
  });

  it("a new talent account from the link joins pending verification and takes exactly one seat", async () => {
    resetRateLimits();
    const r = await registerViaInvite(db, talent({ email: "lina@talent.example", displayName: "Lina V." }), link, meta);
    const m = await db.agencyMembership.findFirstOrThrow({ where: { agentProfileId: r.agentProfileId }, include: { agentProfile: true } });
    expect(m).toMatchObject({ agencyId: ids.agencyA, status: "PENDING_VERIFICATION", invitationSource: "UNIQUE_LINK", isPrimary: true });
    expect(m.platformIdentityId).toBeTruthy();
    expect(m.seatLedgerEntryId).toBeTruthy();
    expect(m.agentProfile.primaryAgencyId).toBe(ids.agencyA);
    expect(m.agentProfile.talentType).toBe("AGENCY_AGENT");
    const t = await seatTotals(db, ids.agencyA);
    expect(t).toMatchObject({ used: 1, available: 4 });
    expect(await db.agencySeatLedger.count({ where: { agencyId: ids.agencyA, changeType: "CONSUMED" } })).toBe(1);
    expect((await db.agencyInviteLink.findFirstOrThrow({ where: { agencyId: ids.agencyA, active: true } })).uses).toBe(1);
    // Verifying the email activates the membership.
    const token = await db.authToken.findFirstOrThrow({ where: { kind: "EMAIL_VERIFY", userId: r.userId, usedAt: null } });
    const sent = email.sent.find((x) => x.to === "lina@talent.example" && /verify/i.test(x.subject));
    expect(sent).toBeTruthy();
    const raw = sent!.text.match(/verify-email\/([A-Za-z0-9_-]+)/)![1];
    expect(sha256(raw)).toBe(token.tokenHash);
    await verifyEmail(db, raw);
    expect((await db.agencyMembership.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("ACTIVE");
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.ownerUser, type: "AGENCY_MEMBER_JOINED" } })).toBe(1);
  });

  it("duplicate sign-ups from the link are flagged with kind INVITE_JOIN and take no seat", async () => {
    resetRateLimits();
    await expect(registerViaInvite(db, talent({ email: "LINA@talent.example" }), link, meta)).rejects.toBeInstanceOf(DuplicateDetectedError);
    expect((await db.duplicateFlag.findFirstOrThrow({ where: { attemptedEmail: "lina@talent.example" } })).kind).toBe("INVITE_JOIN");
    expect((await seatTotals(db, ids.agencyA)).used).toBe(1);
  });

  it("existing Hirewise Direct talent joins with one click; a member of another agency cannot", async () => {
    resetRateLimits();
    const r = await registerAgent(db, talent({ email: "direct@talent.example", displayName: "Direct D." }), meta);
    ids.directUser = r.userId;
    ids.directProfile = r.agentProfileId;
    await db.user.update({ where: { id: r.userId }, data: { emailVerifiedAt: new Date() } });
    const direct = await resolveActor(db, r.userId);
    const member = await joinAsExistingUser(db, direct, link, meta);
    expect(member.membershipStatus).toBe("ACTIVE");
    expect((await seatTotals(db, ids.agencyA)).used).toBe(2);
    // Second join anywhere is refused by the service and by the database.
    await expect(joinAsExistingUser(db, await resolveActor(db, r.userId), link, meta)).rejects.toThrow(/already/);
    const identity = await db.platformIdentity.findUniqueOrThrow({ where: { userId: r.userId } });
    await expect(db.agencyMembership.create({ data: { agentProfileId: r.agentProfileId, agencyId: ids.agencyB, platformIdentityId: identity.id, status: "ACTIVE" } })).rejects.toThrow();
    // Staff and clients cannot join.
    await expect(joinAsExistingUser(db, admin(), link, meta)).rejects.toThrow(ForbiddenError);
  });

  it("rotating the link invalidates the old one", async () => {
    const fresh = await rotateInviteLink(db, await owner());
    expect(await joinPageInfo(db, link)).toMatchObject({ accepting: false, reason: expect.stringMatching(/replaced/) });
    link = fresh.url.split("/join/")[1];
    expect((await joinPageInfo(db, link))!.accepting).toBe(true);
  });

  it("capacity is enforced at join and at invite; the page explains it", async () => {
    resetRateLimits();
    // 2 used of 5: fill the rest, then one more is refused.
    for (const n of [1, 2, 3]) await registerViaInvite(db, talent({ email: `fill${n}@talent.example`, displayName: `Fill ${n}` }), link, meta);
    expect((await seatTotals(db, ids.agencyA)).available).toBe(0);
    await expect(registerViaInvite(db, talent({ email: "toomany@talent.example" }), link, meta)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.user.count({ where: { email: "toomany@talent.example" } })).toBe(0);
    expect((await joinPageInfo(db, link))!.reason).toMatch(/No Available Agent Seats/);
    await expect(sendEmailInvites(db, await owner(), { emails: ["x@talent.example"] })).rejects.toBeInstanceOf(SeatCapacityError);
  });
});

describe("email invites", () => {
  it("open invites reserve capacity; accepting consumes the seat; revoke frees the reservation", async () => {
    await adminChangeSeats(db, admin(), { agencyId: ids.agencyA, changeType: "ADMIN_ADD", quantity: 2, reason: "Room for email invites" });
    const r = await sendEmailInvites(db, await owner(), { emails: ["invitee@talent.example", "INVITEE@talent.example", "second@talent.example"] });
    expect(r.sent.sort()).toEqual(["invitee@talent.example", "second@talent.example"]);
    const summary = await seatSummary(db, await owner());
    expect(summary).toMatchObject({ openInvites: 2, invitable: 0 });
    await expect(sendEmailInvites(db, await owner(), { emails: ["third@talent.example"] })).rejects.toBeInstanceOf(SeatCapacityError);
    const invites = await listEmailInvites(db, await owner());
    const second = invites.find((i) => i.email === "second@talent.example")!;
    await revokeEmailInvite(db, await owner(), second.id);
    expect((await seatSummary(db, await owner())).invitable).toBe(1);
    const mail = email.sent.find((m) => m.to === "invitee@talent.example")!;
    const token = mail.text.match(/\/join\/([A-Za-z0-9_-]+)/)![1];
    expect(await joinPageInfo(db, token)).toMatchObject({ kind: "EMAIL", email: "invitee@talent.example", accepting: true });
    resetRateLimits();
    await expect(registerViaInvite(db, talent({ email: "other@talent.example" }), token, meta)).rejects.toThrow(/sent to invitee@talent.example/);
    const reg = await registerViaInvite(db, talent({ email: "invitee@talent.example", displayName: "Invitee I." }), token, meta);
    const m = await db.agencyMembership.findFirstOrThrow({ where: { agentProfileId: reg.agentProfileId } });
    expect(m.invitationSource).toBe("EMAIL_INVITE");
    expect((await db.agencyEmailInvite.findFirstOrThrow({ where: { email: "invitee@talent.example" } })).status).toBe("ACCEPTED");
    expect((await joinPageInfo(db, token))!.reason).toMatch(/already used/);
    expect((await seatSummary(db, await owner())).totals).toMatchObject({ total: 7, used: 6, available: 1 });
  });

  it("joins never verified give their seat back after the configured window", async () => {
    await setSetting(db, superAdmin(), "agencySeats", { seatReleaseRule: "IMMEDIATE", inviteLinkTtlDays: 0, emailInviteTtlDays: 14, unverifiedJoinTtlDays: 1 });
    const pending = await db.agencyMembership.findFirst({ where: { agencyId: ids.agencyA, status: "PENDING_VERIFICATION" } });
    expect(pending).toBeTruthy();
    await db.agencyMembership.update({ where: { id: pending!.id }, data: { joinedAt: new Date(Date.now() - 3 * 24 * 60 * 60_000) } });
    const before = (await seatTotals(db, ids.agencyA)).used;
    expect(await expireUnverifiedJoins(db)).toBe(1);
    const after = await seatTotals(db, ids.agencyA);
    expect(after.used).toBe(before - 1);
    const ended = await db.agencyMembership.findUniqueOrThrow({ where: { id: pending!.id }, include: { agentProfile: true } });
    expect(ended.status).toBe("ENDED");
    expect(ended.agentProfile.primaryAgencyId).toBeNull();
    expect(ended.agentProfile.talentType).toBe("HIREWISE_DIRECT");
    expect(await activatePendingMemberships(db, ended.agentProfile.userId)).toBe(0);
  });
});

describe("seat requests, purchases, admin changes, plan changes", () => {
  it("owners request seats; Admin approves with a ledger entry; Sales cannot decide", async () => {
    await expect(requestSeats(db, sales(), { requestedSeats: 3 })).rejects.toThrow(ForbiddenError);
    const r = await requestSeats(db, await owner(), { requestedSeats: 3, note: "New campaign" });
    await runWorkerOnce(db);
    expect(await db.task.count({ where: { type: "REVIEW_SEAT_REQUEST", relatedId: r.id, status: "OPEN" } })).toBe(1);
    await expect(decideSeatRequest(db, sales(), r.id, { decision: "APPROVE" })).rejects.toThrow(ForbiddenError);
    const before = (await seatTotals(db, ids.agencyA)).total;
    const decided = await decideSeatRequest(db, admin(), r.id, { decision: "APPROVE", grantedSeats: 2, note: "Two for now" });
    expect(decided).toMatchObject({ status: "APPROVED", grantedSeats: 2 });
    expect((await seatTotals(db, ids.agencyA)).total).toBe(before + 2);
    await expect(decideSeatRequest(db, admin(), r.id, { decision: "REJECT" })).rejects.toThrow(ForbiddenError);
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.ownerUser, type: "SEAT_REQUEST_DECIDED" } })).toBe(1);
    expect((await listSeatRequests(db, admin(), "APPROVED")).rows.some((x) => x.id === r.id)).toBe(true);
    await expect(listSeatRequests(db, makeActor("AGENT", { userId: "nobody" }))).rejects.toThrow(ForbiddenError);
  });

  it("owners buy packages; seats arrive when Hirewise records the payment; cancelled adds nothing", async () => {
    const p = await purchasePackage(db, await owner(), "pkg_5", "Please invoice");
    expect(p).toMatchObject({ status: "PENDING", seatCount: 5, amountLabel: "$99.00" });
    await expect(recordSeatPurchase(db, sales(), p.id, { outcome: "PAID", reference: "x" })).rejects.toThrow(ForbiddenError);
    await expect(recordSeatPurchase(db, admin(), p.id, { outcome: "PAID" })).rejects.toMatchObject({ field: "reference" });
    const before = (await seatTotals(db, ids.agencyA)).additional;
    const paid = await recordSeatPurchase(db, admin(), p.id, { outcome: "PAID", reference: "GCASH-77" });
    expect(paid.status).toBe("PAID");
    expect((await seatTotals(db, ids.agencyA)).additional).toBe(before + 5);
    const p2 = await purchasePackage(db, await owner(), "pkg_5");
    await recordSeatPurchase(db, admin(), p2.id, { outcome: "CANCELLED", note: "Duplicate order" });
    expect((await seatTotals(db, ids.agencyA)).additional).toBe(before + 5);
    expect((await listSeatPurchases(db, admin(), "CANCELLED")).rows.some((x) => x.id === p2.id)).toBe(true);
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: ids.ownerUser, type: "SEAT_PURCHASE_RECORDED" } })).toBe(2);
  });

  it("removing below usage is refused without override and never removes agents", async () => {
    const t = await seatTotals(db, ids.agencyA);
    await expect(adminChangeSeats(db, admin(), { agencyId: ids.agencyA, changeType: "ADMIN_REMOVE", quantity: t.total, reason: "Mistake" })).rejects.toThrow(/below|in use/i);
    const after = await adminChangeSeats(db, admin(), { agencyId: ids.agencyA, changeType: "ADMIN_REMOVE", quantity: t.total, reason: "Contract ended", override: true });
    expect(after.total).toBe(0);
    expect(after.used).toBe(t.used);
    expect((await seatSummary(db, admin(), ids.agencyA)).overCapacity).toBe(true);
    expect((await agencyMembers(db, admin(), ids.agencyA)).length).toBe(t.used);
    await expect(adminChangeSeats(db, admin(), { agencyId: ids.agencyA, changeType: "ADMIN_ADD", quantity: 1, reason: "" })).rejects.toThrow();
  });

  it("changing the plan reverses the old base and seats members who had none; Enterprise has no base", async () => {
    await expect(assignPlan(db, sales(), ids.agencyB, "GROWTH", "x")).rejects.toThrow(ForbiddenError);
    const t = await assignPlan(db, admin(), ids.agencyB, "GROWTH", "Confirmed with the owner");
    expect(t).toMatchObject({ base: 20, total: 20, used: 0 });
    const t2 = await assignPlan(db, admin(), ids.agencyB, "ENTERPRISE", "Custom contract");
    expect(t2).toMatchObject({ base: 0, total: 0 });
    expect(await db.agencySeatLedger.count({ where: { agencyId: ids.agencyB, changeType: "ADMIN_REMOVE", quantity: 20 } })).toBe(1);
    // Agency A has members and 0 seats after the override; assigning Starter (5) below usage needs override.
    await expect(assignPlan(db, admin(), ids.agencyA, "STARTER", "Reset")).rejects.toThrow(/override|Tick/);
    const t3 = await assignPlan(db, admin(), ids.agencyA, "STARTER", "Reset", true);
    expect(t3.base).toBe(5);
    await expect(assignPlan(db, admin(), ids.agencyA, "NOPE", "x")).rejects.toThrow(NotFoundError);
  });

  it("an Admin moves an agent between agencies: the old seat is released, the new one taken", async () => {
    await assignPlan(db, admin(), ids.agencyB, "STARTER", "Room to move");
    const before = await seatTotals(db, ids.agencyA);
    await setAgentAgency(db, admin(), ids.directProfile, ids.agencyB, "Transferred at the owners' request");
    expect((await seatTotals(db, ids.agencyA)).used).toBe(before.used - 1);
    expect((await seatTotals(db, ids.agencyB)).used).toBe(1);
    // v2 phase 3: leaving A made the old profile a former profile, so the move created a fresh profile for the same person.
    const m = await db.agencyMembership.findFirstOrThrow({ where: { status: "ACTIVE", agentProfile: { userId: ids.directUser } } });
    expect(m).toMatchObject({ agencyId: ids.agencyB, invitationSource: "ADMIN" });
    expect(m.agentProfileId).not.toBe(ids.directProfile);
    await setAgentAgency(db, admin(), m.agentProfileId, null, "Back to Hirewise Direct");
    expect(await db.agencyMembership.count({ where: { agentProfile: { userId: ids.directUser }, status: "ACTIVE" } })).toBe(0);
    expect((await db.agentProfile.findUniqueOrThrow({ where: { id: m.agentProfileId } })).status).toBe("FORMER_AGENCY_AGENT");
    expect((await seatTotals(db, ids.agencyB)).used).toBe(0);
  });

  it("tenant scope: an owner reads only their own seats and members; nothing carries identity keys", async () => {
    const a = await owner();
    await expect(seatSummary(db, a, ids.agencyB)).rejects.toThrow(NotFoundError);
    await expect(agencyMembers(db, a, ids.agencyB)).rejects.toThrow(NotFoundError);
    const members = await agencyMembers(db, a);
    const keys = collectKeys(members);
    for (const k of FORBIDDEN_FOR_AGENCY) expect(keys.has(k), `forbidden key present: ${k}`).toBe(false);
    const keys2 = collectKeys(await seatSummary(db, a));
    for (const k of FORBIDDEN_FOR_AGENCY) expect(keys2.has(k), `forbidden key present: ${k}`).toBe(false);
    const ownerB = await resolveActor(db, ids.ownerB);
    expect(ownerB.agency?.id).toBe(ids.agencyB);
    expect((await seatSummary(db, ownerB)).agencyId).toBe(ids.agencyB);
  });
});
