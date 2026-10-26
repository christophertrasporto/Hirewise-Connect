import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { testDb, resetDb } from "../setup/db";
import { seedTerms } from "../setup/terms";
import { registerAgent } from "@/server/services/agent.service";
import { registerClient } from "@/server/services/client.service";
import { registerApplicant } from "@/server/services/agency-application.service";
import { createAgencyDirect } from "@/server/services/agency.service";
import { recordCoursePayment, recordCourseRefund } from "@/server/services/academy.service";
import { recordCoursePurchase, recordCoursePurchaseRefund } from "@/server/services/training.service";
import { ensureReferralCode, recordClick, attachReferrer, referralOverview, myCommissions, hashIp, REFERRAL_COOKIE } from "@/server/services/referral.service";
import { recordCommissionForPayment, releaseCommissionHolds, reverseCommissionManually, adjustReferrerBalance, balanceFor } from "@/server/services/commission.service";
import { savePayoutDetails, myPayoutDetails, requestPayout, listPayoutQueue, approvePayout, markPayoutPaid, rejectPayout, myPayouts } from "@/server/services/payout.service";
import { getReferralSettings, updateReferralSettings, listAffiliates, affiliateDetail, reviewReferralFlag } from "@/server/services/referral-admin.service";
import { runWorkerOnce, runMaintenance } from "@/server/jobs/worker";
import { setSetting } from "@/server/services/setting.service";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { collectKeys } from "@/server/views/forbidden-keys";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";

const db = testDb();
const PASSWORD = "Str0ngPassw0rd!";
const DAY = 86_400_000;
const ids = { admin: "admin_rf", sales: "sales_rf", coach: "coach_rf", maria: "", mariaProfile: "", mariaCode: "", ben: "", benCode: "", course: "", course2: "" };
let seq = 0;

const talent = (over: Record<string, unknown> = {}) => {
  seq++;
  return { termsAccepted: true, fullName: `Test Talent${seq}`, displayName: `Tess${seq} T.`, email: `t${seq}@talent.example`, password: PASSWORD, phone: "", locationCity: "Cebu", locationCountry: "Philippines", timezone: "Asia/Manila", primaryRole: "Cold Caller", yearsExperience: 3, ...over };
};
const clientInput = (over: Record<string, unknown> = {}) => {
  seq++;
  return { termsAccepted: true, companyName: `Acme ${seq}`, contactName: "Jordan Lee", position: "Head of Sales", email: `c${seq}@acme-${seq}.example`, password: PASSWORD, phone: "", industry: "Solar / Energy", website: "https://acme.example", country: "United States", timezone: "America/Los_Angeles", servicesNeeded: ["Cold Calling"], agentsRequired: 2, preferredSchedule: "", expectedStartDate: "", notes: "", ...over };
};
const meta = (ip = "198.51.100.1") => ({ ipAddress: ip, userAgent: "vitest" });
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const member = (userId: string, role: "AGENT" | "AGENCY_OWNER" = "AGENT") => makeActor(role, { userId });

async function drain() {
  for (let i = 0; i < 10; i++) if (!(await runWorkerOnce(db)).events) break;
}

/** A referred buyer with a pending paid enrolment, created through the real sign-up path. */
async function referredBuyer(code: string | null, priceCents = 4900, courseId = ids.course) {
  resetRateLimits();
  const r = await registerAgent(db, talent(), meta(`203.0.113.${(seq % 200) + 1}`), undefined, { referralCode: code });
  await db.user.update({ where: { id: r.userId }, data: { emailVerifiedAt: new Date() } });
  const profile = await db.agentProfile.findFirstOrThrow({ where: { userId: r.userId } });
  const enrollment = await db.courseEnrollment.create({ data: { courseId, agentProfileId: profile.id, priceCents, paymentStatus: "PENDING", credentialSource: "INDEPENDENT_PURCHASE" } });
  return { userId: r.userId, profileId: profile.id, enrollmentId: enrollment.id };
}
const pay = (enrollmentId: string, usd = "49.00") => recordCoursePayment(db, sales(), enrollmentId, { paidUsd: usd, reference: `GCASH-${Math.random().toString(36).slice(2, 8)}`, waived: false });
const commissionOf = (sourceId: string) => db.commission.findFirst({ where: { sourceId } });

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16";
  process.env.APP_URL = "http://localhost:3000";
  await resetDb(db);
  resetRateLimits();
  setEmailChannelForTests(new ConsoleEmailChannel());
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  await seedTerms(db);
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN"), emailVerifiedAt: new Date() } });
  await db.user.create({ data: { id: ids.sales, email: "sales@hirewise.example", roleId: await role("SALES"), emailVerifiedAt: new Date() } });
  await db.user.create({ data: { id: ids.coach, email: "coach@hirewise.example", roleId: await role("COACH"), emailVerifiedAt: new Date() } });
  const mk = async (title: string, priceCents: number) => (await db.academyCourse.create({ data: { code: title.replace(/\s/g, "-").toUpperCase(), title, category: "Sales", description: "A course description long enough to satisfy validation rules.", status: "PUBLISHED", priceCents, ownerCoachUserId: ids.coach } })).id;
  ids.course = await mk("Cold Calling Masterclass", 4900);
  ids.course2 = await mk("Closing Mastery", 9900);
  // The referrers, created through the real sign-up.
  const maria = await registerAgent(db, talent({ displayName: "Maria S.", fullName: "Maria Santos", email: "maria@talent.example", phone: "+63 917 555 0100" }), meta("198.51.100.200"));
  ids.maria = maria.userId;
  ids.mariaProfile = maria.agentProfileId;
  ids.mariaCode = await ensureReferralCode(db, ids.maria);
  resetRateLimits();
  const ben = await registerAgent(db, talent({ displayName: "Ben R.", fullName: "Ben Reyes", email: "ben@talent.example" }), meta("198.51.100.201"));
  ids.ben = ben.userId;
  ids.benCode = await ensureReferralCode(db, ids.ben);
  // These tests use USD courses and a 10.00 minimum payout. The shipped defaults are PHP and 500.00 (see maya-payments.test.ts).
  await setSetting(db, makeActor("SUPER_ADMIN", { userId: "su_rf_settings" }), "referrals", { commissionRateBps: 1500, holdDays: 30, cookieDays: 30, minimumPayoutMinor: 1000, payoutCurrency: "USD" }).catch(async () => {
    await db.user.create({ data: { id: "su_rf_settings", email: "su-settings@hirewise.example", roleId: await role("SUPER_ADMIN") } });
    await setSetting(db, makeActor("SUPER_ADMIN", { userId: "su_rf_settings" }), "referrals", { commissionRateBps: 1500, holdDays: 30, cookieDays: 30, minimumPayoutMinor: 1000, payoutCurrency: "USD" });
  });
});

afterAll(async () => {
  setEmailChannelForTests(null);
  await db.$disconnect();
});

describe("referral codes and clicks", () => {
  it("gives every member one stable, unique, unguessable code built from their name", async () => {
    expect(ids.mariaCode).toMatch(/^MARIA-[A-HJ-KM-NP-Z2-9]{6}$/);
    expect(ids.benCode).toMatch(/^BEN-[A-HJ-KM-NP-Z2-9]{6}$/);
    expect(await ensureReferralCode(db, ids.maria)).toBe(ids.mariaCode);
    expect(ids.mariaCode).not.toBe(ids.benCode);
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.maria } })).referralCode).toBe(ids.mariaCode);
  });

  it("logs a click with a hashed IP, and ignores unknown, malformed, and inactive codes", async () => {
    const ok = await recordClick(db, ids.mariaCode, { ip: "198.51.100.50", userAgent: "Mozilla/5.0", landingUrl: `/join?ref=${ids.mariaCode}` });
    expect(ok.ok).toBe(true);
    const click = await db.referralClick.findFirstOrThrow({ where: { referrerId: ids.maria } });
    expect(click.ipHash).toBe(hashIp("198.51.100.50"));
    expect(JSON.stringify(click).includes("198.51.100.50")).toBe(false);
    expect(click.landingUrl).toContain("/join?ref=");
    for (const bad of ["MARIA-ZZZZZZ", "not-a-code", "", null]) expect((await recordClick(db, bad, { ip: null, userAgent: null, landingUrl: "/join" })).ok).toBe(false);
    await db.user.update({ where: { id: ids.ben }, data: { status: "SUSPENDED" } });
    expect((await recordClick(db, ids.benCode, { ip: null, userAgent: null, landingUrl: "/join" })).ok).toBe(false);
    await db.user.update({ where: { id: ids.ben }, data: { status: "ACTIVE" } });
    expect(await db.referralClick.count({ where: { referrerId: ids.maria } })).toBe(1);
  });

  it("the /join route sets a 30-day first-party cookie, and the last link clicked wins", async () => {
    const { GET } = await import("@/app/(auth)/join/route");
    resetRateLimits();
    const visit = (code: string) => GET(new NextRequest(`http://localhost:3000/join?ref=${code}`, { headers: { "x-forwarded-for": "198.51.100.77", "user-agent": "vitest" } }));
    const first = await visit(ids.mariaCode);
    expect(first.status).toBe(307);
    expect(new URL(first.headers.get("location")!).pathname).toBe("/register");
    const c1 = first.cookies.get(REFERRAL_COOKIE)!;
    expect(c1.value).toBe(ids.mariaCode);
    expect(c1.maxAge).toBe(30 * 86_400);
    expect(c1.httpOnly).toBe(true);
    expect(c1.sameSite).toBe("lax");
    // A later link overwrites the cookie: the browser keeps only the last value.
    const second = await visit(ids.benCode);
    expect(second.cookies.get(REFERRAL_COOKIE)!.value).toBe(ids.benCode);
    // Unknown codes still reach sign-up, with no cookie.
    const bad = await visit("MARIA-ZZZZZZ");
    expect(new URL(bad.headers.get("location")!).pathname).toBe("/register");
    expect(bad.cookies.get(REFERRAL_COOKIE)).toBeUndefined();
    expect((await GET(new NextRequest("http://localhost:3000/join"))).cookies.get(REFERRAL_COOKIE)).toBeUndefined();
    // The cookie length follows the setting.
    await updateReferralSettings(db, admin(), { ...(await getReferralSettings(db, admin())), cookieDays: 7 });
    resetRateLimits();
    expect((await visit(ids.mariaCode)).cookies.get(REFERRAL_COOKIE)!.maxAge).toBe(7 * 86_400);
    await updateReferralSettings(db, admin(), { ...(await getReferralSettings(db, admin())), cookieDays: 30 });
  });
});

describe("attribution", () => {
  it("attaches the referrer when someone signs up with the cookie code, for every sign-up type", async () => {
    resetRateLimits();
    const agent = await registerAgent(db, talent(), meta("203.0.113.10"), undefined, { referralCode: ids.mariaCode });
    resetRateLimits();
    const client = await registerClient(db, clientInput(), meta("203.0.113.11"), { referralCode: ids.mariaCode });
    resetRateLimits();
    seq++;
    const applicant = await registerApplicant(db, { termsAccepted: true, fullName: "Alma Cruz", email: `alma${seq}@agency.example`, password: PASSWORD, continuationToken: "" }, meta("203.0.113.12"), { referralCode: ids.mariaCode });
    for (const userId of [agent.userId, client.userId, applicant.userId]) {
      const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
      expect(u.referredByUserId).toBe(ids.maria);
      expect(u.referredAt).not.toBeNull();
    }
    await drain();
    expect(await db.notification.count({ where: { userId: ids.maria, type: "REFERRAL_SIGNUP" } })).toBe(3);
    expect(await db.auditLog.count({ where: { action: "REFERRAL_ATTACHED" } })).toBeGreaterThanOrEqual(3);
  });

  it("ignores no code, a malformed code, an unknown code, and an unusable referrer; the sign-up still works", async () => {
    resetRateLimits();
    const none = await registerAgent(db, talent(), meta("203.0.113.20"));
    resetRateLimits();
    const junk = await registerAgent(db, talent(), meta("203.0.113.21"), undefined, { referralCode: "nonsense" });
    resetRateLimits();
    const unknown = await registerAgent(db, talent(), meta("203.0.113.22"), undefined, { referralCode: "MARIA-ZZZZZZ" });
    await db.user.update({ where: { id: ids.ben }, data: { status: "SUSPENDED" } });
    resetRateLimits();
    const suspended = await registerAgent(db, talent(), meta("203.0.113.23"), undefined, { referralCode: ids.benCode });
    await db.user.update({ where: { id: ids.ben }, data: { status: "ACTIVE" } });
    for (const r of [none, junk, unknown, suspended]) expect((await db.user.findUniqueOrThrow({ where: { id: r.userId } })).referredByUserId).toBeNull();
  });

  it("is set once and never changes: a second attach is refused and the database rejects any rewrite", async () => {
    resetRateLimits();
    const r = await registerAgent(db, talent(), meta("203.0.113.30"), undefined, { referralCode: ids.mariaCode });
    const again = await db.$transaction((tx) => attachReferrer(tx, { userId: r.userId, email: "x@talent.example", code: ids.benCode, meta: meta() }));
    expect(again.attached).toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: r.userId } })).referredByUserId).toBe(ids.maria);
    // Even a direct write cannot move or clear it.
    await expect(db.$executeRawUnsafe(`UPDATE "User" SET "referredByUserId" = '${ids.ben}' WHERE id = '${r.userId}'`)).rejects.toThrow(/write-once/);
    await expect(db.$executeRawUnsafe(`UPDATE "User" SET "referredByUserId" = NULL WHERE id = '${r.userId}'`)).rejects.toThrow(/write-once/);
    await expect(db.$executeRawUnsafe(`UPDATE "User" SET "referredAt" = now() + interval '1 day' WHERE id = '${r.userId}'`)).rejects.toThrow(/write-once/);
    expect((await db.user.findUniqueOrThrow({ where: { id: r.userId } })).referredByUserId).toBe(ids.maria);
  });

  it("blocks self-referral: nobody signs up through their own link or refers themselves", async () => {
    resetRateLimits();
    const r = await registerAgent(db, talent(), meta("203.0.113.40"));
    const ownCode = await ensureReferralCode(db, r.userId);
    // The code exists only after the account does, and using it on that account attaches nothing.
    expect((await db.$transaction((tx) => attachReferrer(tx, { userId: r.userId, email: "self@talent.example", code: ownCode, meta: meta() }))).attached).toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: r.userId } })).referredByUserId).toBeNull();
    await expect(db.$executeRawUnsafe(`UPDATE "User" SET "referredByUserId" = id WHERE id = '${r.userId}'`)).rejects.toThrow(/User_referral_not_self/);
  });
});

describe("fraud flags (flag, never block)", () => {
  it("flags the same mailbox, the same IP, and the same phone but still attributes the sign-up", async () => {
    await db.session.create({ data: { userId: ids.maria, tokenHash: "rf-session-1", expiresAt: new Date(Date.now() + DAY), ipAddress: "192.0.2.55" } });
    resetRateLimits();
    // Same mailbox: maria+promo@talent.example normalizes to maria@talent.example.
    const alias = await registerClient(db, clientInput({ email: "maria+promo@talent.example" }), meta("203.0.113.50"), { referralCode: ids.mariaCode });
    resetRateLimits();
    const sameIp = await registerClient(db, clientInput(), meta("192.0.2.55"), { referralCode: ids.mariaCode });
    resetRateLimits();
    const samePhone = await registerClient(db, clientInput({ phone: "0917 555 0100" }), meta("203.0.113.51"), { referralCode: ids.mariaCode });
    resetRateLimits();
    const clean = await registerClient(db, clientInput(), meta("203.0.113.52"), { referralCode: ids.mariaCode });
    const kinds = async (userId: string) => (await db.referralFlag.findMany({ where: { referredUserId: userId } })).map((f) => f.kind);
    expect(await kinds(alias.userId)).toEqual(["EMAIL_ALIAS"]);
    expect(await kinds(sameIp.userId)).toEqual(["SAME_IP"]);
    expect(await kinds(samePhone.userId)).toEqual(["SAME_PHONE"]);
    expect(await kinds(clean.userId)).toEqual([]);
    for (const r of [alias, sameIp, samePhone]) expect((await db.user.findUniqueOrThrow({ where: { id: r.userId } })).referredByUserId).toBe(ids.maria);
    // No raw IP or phone is stored as evidence.
    const evidence = JSON.stringify(await db.referralFlag.findMany({ where: { referrerId: ids.maria } }));
    expect(evidence.includes("192.0.2.55")).toBe(false);
    expect(evidence.includes("555 0100")).toBe(false);
    await drain();
    expect(await db.notification.count({ where: { type: "REFERRAL_FLAGGED" } })).toBeGreaterThanOrEqual(3);
  });

  it("staff list flags per affiliate and mark them reviewed; others cannot", async () => {
    const detail = await affiliateDetail(db, admin(), ids.maria);
    expect(detail.flags.filter((f) => !f.reviewed).length).toBe(3);
    const rows = await listAffiliates(db, admin());
    expect(rows.rows.find((r) => r.userId === ids.maria)!.openFlags).toBe(3);
    await expect(reviewReferralFlag(db, sales(), detail.flags[0].id)).rejects.toThrow(ForbiddenError);
    await expect(reviewReferralFlag(db, member(ids.maria), detail.flags[0].id)).rejects.toThrow(ForbiddenError);
    await reviewReferralFlag(db, admin(), detail.flags[0].id);
    expect((await affiliateDetail(db, admin(), ids.maria)).flags.filter((f) => !f.reviewed).length).toBe(2);
    await expect(reviewReferralFlag(db, admin(), "missing")).rejects.toThrow(NotFoundError);
  });
});

describe("commissions from confirmed payments", () => {
  it("creates one on-hold commission at the locked rate when staff confirm the payment, and notifies the referrer", async () => {
    const b = await referredBuyer(ids.benCode);
    expect(await commissionOf(b.enrollmentId)).toBeNull(); // nothing at sign-up or enrolment
    const before = Date.now();
    await pay(b.enrollmentId);
    const c = (await commissionOf(b.enrollmentId))!;
    expect(c.referrerId).toBe(ids.ben);
    expect(c.buyerId).toBe(b.userId);
    expect(c.sourceType).toBe("ENROLLMENT");
    expect(c.saleAmount).toBe(4900);
    expect(c.rateBps).toBe(1500);
    expect(c.commissionAmount).toBe(735);
    expect(c.currency).toBe("USD");
    expect(c.status).toBe("ON_HOLD");
    expect(c.availableAt.getTime()).toBeGreaterThanOrEqual(before + 30 * DAY - 5000);
    expect(c.availableAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * DAY + 5000);
    await drain();
    expect(await db.notification.count({ where: { userId: ids.ben, type: "COMMISSION_CREATED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "COMMISSION_CREATED", entityId: c.id } })).toBe(1);
  });

  it("earns nothing on waived payments, unreferred buyers, or free courses", async () => {
    const waived = await referredBuyer(ids.benCode);
    await recordCoursePayment(db, sales(), waived.enrollmentId, { waived: true, reason: "Scholarship" });
    expect(await commissionOf(waived.enrollmentId)).toBeNull();
    const plain = await referredBuyer(null);
    await pay(plain.enrollmentId);
    expect(await commissionOf(plain.enrollmentId)).toBeNull();
    // A zero-amount sale cannot create a commission row.
    const b = await referredBuyer(ids.benCode);
    expect(await db.$transaction((tx) => recordCommissionForPayment(tx, { sourceType: "ENROLLMENT", sourceId: b.enrollmentId, buyerUserId: b.userId, courseId: ids.course, courseTitle: "x", paidMinor: 0, currency: "USD", paidAt: new Date() }))).toBeNull();
  });

  it("calculates on the amount actually paid after discounts, minus taxes and fees, never above the price", async () => {
    const b = await referredBuyer(ids.benCode, 10_000, ids.course2);
    const sale = (over: Record<string, unknown>) => db.$transaction((tx) => recordCommissionForPayment(tx, { sourceType: "ENROLLMENT", sourceId: b.enrollmentId, buyerUserId: b.userId, courseId: ids.course2, courseTitle: "Closing Mastery", paidMinor: 8000, listMinor: 10_000, currency: "USD", paidAt: new Date(), ...over }));
    // A 20% coupon (paid 8000 of 10000), 500 tax, 200 processing fee: 15% of 7300.
    const r = (await sale({ taxesMinor: 500, feesMinor: 200 }))!;
    const c = await db.commission.findUniqueOrThrow({ where: { id: r.commissionId } });
    expect([c.saleAmount, c.commissionAmount]).toEqual([7300, 1095]);
    // Overpaying earns on the list price.
    const b2 = await referredBuyer(ids.benCode, 10_000, ids.course2);
    const r2 = (await db.$transaction((tx) => recordCommissionForPayment(tx, { sourceType: "ENROLLMENT", sourceId: b2.enrollmentId, buyerUserId: b2.userId, courseId: ids.course2, courseTitle: "x", paidMinor: 12_000, listMinor: 10_000, currency: "USD", paidAt: new Date() })))!;
    expect((await db.commission.findUniqueOrThrow({ where: { id: r2.commissionId } })).saleAmount).toBe(10_000);
  });

  it("locks the rate at the time of sale: changing the global rate only affects later sales", async () => {
    const early = await referredBuyer(ids.benCode);
    await pay(early.enrollmentId);
    const settings = await getReferralSettings(db, admin());
    await updateReferralSettings(db, admin(), { ...settings, commissionRateBps: 2000 }, "Promotion");
    const late = await referredBuyer(ids.benCode);
    await pay(late.enrollmentId);
    await updateReferralSettings(db, admin(), { ...settings, commissionRateBps: 1000 });
    const e = (await commissionOf(early.enrollmentId))!;
    const l = (await commissionOf(late.enrollmentId))!;
    expect([e.rateBps, e.commissionAmount]).toEqual([1500, 735]);
    expect([l.rateBps, l.commissionAmount]).toEqual([2000, 980]);
    // The earlier commissions did not move when the rate changed to 10%.
    expect((await commissionOf(early.enrollmentId))!.commissionAmount).toBe(735);
    await updateReferralSettings(db, admin(), settings);
    const audits = await db.auditLog.findMany({ where: { action: "REFERRAL_SETTINGS_SET" }, orderBy: { createdAt: "asc" } });
    const promo = audits.find((a) => JSON.stringify(a.newValue).includes("2000"))!;
    expect(promo.reason).toBe("Promotion");
    expect(JSON.stringify(promo.previousValue)).toContain("1500");
  });

  it("is idempotent: repeating the payment event never creates a second commission", async () => {
    const b = await referredBuyer(ids.benCode);
    await pay(b.enrollmentId);
    const facts = { sourceType: "ENROLLMENT" as const, sourceId: b.enrollmentId, buyerUserId: b.userId, courseId: ids.course, courseTitle: "Cold Calling Masterclass", paidMinor: 4900, listMinor: 4900, currency: "USD", paidAt: new Date() };
    const first = (await commissionOf(b.enrollmentId))!;
    const again = await db.$transaction((tx) => recordCommissionForPayment(tx, facts));
    const concurrent = await Promise.all([db.$transaction((tx) => recordCommissionForPayment(tx, facts)), db.$transaction((tx) => recordCommissionForPayment(tx, facts))]);
    expect(again).toEqual({ commissionId: first.id, created: false });
    for (const r of concurrent) expect(r).toEqual({ commissionId: first.id, created: false });
    expect(await db.commission.count({ where: { sourceId: b.enrollmentId } })).toBe(1);
    // Staff pressing Record twice is refused before it gets that far.
    await expect(pay(b.enrollmentId)).rejects.toThrow(/does not have a pending payment/);
    await drain();
    expect(await db.notification.count({ where: { userId: ids.ben, type: "COMMISSION_CREATED", title: { contains: "7.35" } } })).toBeGreaterThanOrEqual(1);
    const notified = await db.notification.count({ where: { userId: ids.ben, type: "COMMISSION_CREATED" } });
    await db.$transaction((tx) => recordCommissionForPayment(tx, facts));
    await drain();
    expect(await db.notification.count({ where: { userId: ids.ben, type: "COMMISSION_CREATED" } })).toBe(notified);
  });

  it("the database refuses a commission where buyer and referrer are the same person", async () => {
    await expect(db.commission.create({ data: { referrerId: ids.ben, buyerId: ids.ben, sourceType: "ENROLLMENT", sourceId: "self-sale", courseId: ids.course, courseTitle: "x", saleAmount: 100, rateBps: 1500, commissionAmount: 15, currency: "USD", availableAt: new Date() } })).rejects.toThrow();
    expect(await db.commission.count({ where: { sourceId: "self-sale" } })).toBe(0);
  });
});

describe("agency Course Seat purchases", () => {
  it("earn a commission for whoever referred the agency owner, and a refund reverses it and ends the seats", async () => {
    const roleId = (await db.role.findUniqueOrThrow({ where: { key: "APPLICANT" } })).id;
    await db.plan.create({ data: { id: "plan_rf", key: "STARTER_RF", name: "Starter", baseAgentSeats: 5, sortOrder: 1 } });
    const owner = await db.user.create({ data: { email: "owner@villanueva-rf.example", roleId, emailVerifiedAt: new Date(), referredByUserId: ids.maria, referredAt: new Date() } });
    const agencyId = await createAgencyDirect(db, makeActor("SUPER_ADMIN", { userId: "su_rf" }), { ownerEmail: owner.email, name: "Villanueva Virtual Teams", country: "Philippines", reason: "referral tests", planKey: "STARTER_RF" }).catch(async () => {
      await db.user.create({ data: { id: "su_rf", email: "su@hirewise.example", roleId: (await db.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } })).id } });
      return createAgencyDirect(db, makeActor("SUPER_ADMIN", { userId: "su_rf" }), { ownerEmail: owner.email, name: "Villanueva Virtual Teams", country: "Philippines", reason: "referral tests", planKey: "STARTER_RF" });
    });
    const purchase = await db.coursePurchase.create({ data: { agencyId, courseId: ids.course, seatCount: 2, amountMinor: 9800, currency: "USD", requestedById: owner.id } });
    await recordCoursePurchase(db, admin(), purchase.id, { outcome: "PAID", reference: "BANK-1" });
    const c = (await commissionOf(purchase.id))!;
    expect(c).toMatchObject({ referrerId: ids.maria, buyerId: owner.id, sourceType: "COURSE_PURCHASE", saleAmount: 9800, commissionAmount: 1470, status: "ON_HOLD" });
    // A seat assigned from the purchase has an enrolment that the refund must end.
    const assignment = await db.courseSeatAssignment.create({ data: { coursePurchaseId: purchase.id, agencyId, courseId: ids.course, agentProfileId: ids.mariaProfile, assignedById: owner.id } });
    const enrollment = await db.courseEnrollment.create({ data: { courseId: ids.course, agentProfileId: ids.mariaProfile, priceCents: 4900, paymentStatus: "WAIVED", credentialSource: "AGENCY_SPONSORED", sponsoringAgencyId: agencyId, courseSeatAssignmentId: assignment.id } });
    await db.courseSeatAssignment.update({ where: { id: assignment.id }, data: { enrollmentId: enrollment.id } });
    await expect(recordCoursePurchaseRefund(db, sales(), purchase.id, { kind: "REFUND", reason: "x" })).rejects.toThrow(ForbiddenError);
    await expect(recordCoursePurchaseRefund(db, admin(), purchase.id, { kind: "REFUND", reason: "" })).rejects.toThrow();
    await recordCoursePurchaseRefund(db, admin(), purchase.id, { kind: "CHARGEBACK", reason: "Card dispute" });
    expect((await commissionOf(purchase.id))!.status).toBe("REVERSED");
    const p = await db.coursePurchase.findUniqueOrThrow({ where: { id: purchase.id } });
    expect([p.status, p.refundKind]).toEqual(["REFUNDED", "CHARGEBACK"]);
    expect((await db.courseSeatAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).revokedAt).not.toBeNull();
    const e = await db.courseEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
    expect([e.status, e.accessRevokedAt !== null]).toEqual(["REVOKED", true]);
    await expect(recordCoursePurchaseRefund(db, admin(), purchase.id, { kind: "REFUND", reason: "again" })).rejects.toThrow(/Only a paid purchase/);
  });
});

describe("hold to payable", () => {
  it("moves commissions to payable exactly when their hold ends, and running it again changes nothing", async () => {
    const b = await referredBuyer(ids.benCode);
    await pay(b.enrollmentId);
    const c = (await commissionOf(b.enrollmentId))!;
    const now = new Date();
    await db.commission.update({ where: { id: c.id }, data: { availableAt: new Date(now.getTime() + 1) } });
    expect(await releaseCommissionHolds(db, now)).toBe(0);
    expect((await commissionOf(b.enrollmentId))!.status).toBe("ON_HOLD");
    await db.commission.update({ where: { id: c.id }, data: { availableAt: now } });
    expect(await releaseCommissionHolds(db, now)).toBe(1);
    expect((await commissionOf(b.enrollmentId))!.status).toBe("PAYABLE");
    expect(await releaseCommissionHolds(db, now)).toBe(0);
    // Reversed and paid commissions are never touched.
    await db.commission.update({ where: { id: c.id }, data: { status: "REVERSED" } });
    await db.commission.update({ where: { id: c.id }, data: { status: "ON_HOLD" } });
    await db.commission.update({ where: { id: c.id }, data: { status: "REVERSED", availableAt: new Date(0) } });
    await releaseCommissionHolds(db, now);
    expect((await commissionOf(b.enrollmentId))!.status).toBe("REVERSED");
  });

  it("is part of the worker's maintenance pass", async () => {
    const b = await referredBuyer(ids.benCode);
    await pay(b.enrollmentId);
    await db.commission.updateMany({ where: { sourceId: b.enrollmentId }, data: { availableAt: new Date(Date.now() - 1000) } });
    await runMaintenance(db);
    expect((await commissionOf(b.enrollmentId))!.status).toBe("PAYABLE");
  });

  it("a hold of zero days makes new commissions payable straight away", async () => {
    const settings = await getReferralSettings(db, admin());
    await updateReferralSettings(db, admin(), { ...settings, holdDays: 0 });
    const b = await referredBuyer(ids.benCode);
    await pay(b.enrollmentId);
    expect((await commissionOf(b.enrollmentId))!.status).toBe("PAYABLE");
    await updateReferralSettings(db, admin(), settings);
  });
});

describe("refunds and chargebacks", () => {
  it("before payout: the commission is reversed, access ends, and the referrer is told", async () => {
    const b = await referredBuyer(ids.benCode);
    await pay(b.enrollmentId);
    await expect(recordCourseRefund(db, member(b.userId), b.enrollmentId, { kind: "REFUND", reason: "x" })).rejects.toThrow(ForbiddenError);
    await expect(recordCourseRefund(db, sales(), b.enrollmentId, { kind: "REFUND", reason: "" })).rejects.toThrow();
    await recordCourseRefund(db, sales(), b.enrollmentId, { kind: "REFUND", reason: "Changed their mind within 7 days" });
    const e = await db.courseEnrollment.findUniqueOrThrow({ where: { id: b.enrollmentId } });
    expect([e.paymentStatus, e.status, e.refundKind]).toEqual(["REFUNDED", "REVOKED", "REFUND"]);
    expect(e.accessRevokedAt).not.toBeNull();
    const c = (await commissionOf(b.enrollmentId))!;
    expect(c.status).toBe("REVERSED");
    expect(c.reversedReason).toContain("refund");
    expect(await db.commissionAdjustment.count({ where: { commissionId: c.id } })).toBe(0);
    await drain();
    expect(await db.notification.count({ where: { userId: ids.ben, type: "COMMISSION_REVERSED" } })).toBe(1);
    await expect(recordCourseRefund(db, sales(), b.enrollmentId, { kind: "REFUND", reason: "again" })).rejects.toThrow(/Only a paid enrolment/);
  });

  it("only paid enrolments can be refunded, and a refund with no commission is fine", async () => {
    const pending = await referredBuyer(ids.benCode);
    await expect(recordCourseRefund(db, sales(), pending.enrollmentId, { kind: "REFUND", reason: "nothing paid" })).rejects.toThrow(/Only a paid enrolment/);
    const plain = await referredBuyer(null);
    await pay(plain.enrollmentId);
    await recordCourseRefund(db, sales(), plain.enrollmentId, { kind: "CHARGEBACK", reason: "Bank reversed it" });
    expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: plain.enrollmentId } })).refundKind).toBe("CHARGEBACK");
  });

  it("after payout: the commission is reversed and a negative adjustment is recorded against the balance", async () => {
    await db.session.deleteMany({});
    const referrer = await registerAgent(db, talent({ displayName: "Cara D." }), meta("203.0.113.90"));
    resetRateLimits();
    const code = await ensureReferralCode(db, referrer.userId);
    const buyers = [await referredBuyer(code), await referredBuyer(code)];
    for (const b of buyers) await pay(b.enrollmentId);
    await db.commission.updateMany({ where: { referrerId: referrer.userId }, data: { availableAt: new Date(Date.now() - 1000) } });
    await releaseCommissionHolds(db);
    const actor = member(referrer.userId);
    await savePayoutDetails(db, actor, { method: "GCASH", accountName: "Cara D", accountNumber: "09175550111" });
    const settings = await getReferralSettings(db, admin());
    await updateReferralSettings(db, admin(), { ...settings, minimumPayoutMinor: 1000 });
    const payout = await requestPayout(db, actor);
    expect(payout.amount).toBe(1470);
    await approvePayout(db, admin(), payout.id);
    await markPayoutPaid(db, admin(), payout.id, { reference: "GCASH-REF-1" });
    expect((await balanceFor(db, referrer.userId, "USD")).paid).toBe(1470);

    await recordCourseRefund(db, sales(), buyers[0].enrollmentId, { kind: "REFUND", reason: "Refunded after payout" });
    const c = (await commissionOf(buyers[0].enrollmentId))!;
    expect(c.status).toBe("REVERSED");
    const adj = await db.commissionAdjustment.findFirstOrThrow({ where: { commissionId: c.id } });
    expect([adj.kind, adj.amount, adj.settledPayoutId]).toEqual(["REFUND_AFTER_PAYOUT", -735, null]);
    const bal = await balanceFor(db, referrer.userId, "USD");
    expect(bal.payable).toBe(-735);
    // A negative balance cannot be paid out until later earnings cover it.
    await expect(requestPayout(db, actor)).rejects.toThrow(/minimum payout/);
    await db.commission.updateMany({ where: { id: (await commissionOf(buyers[1].enrollmentId))!.id }, data: { status: "PAYABLE" } });
    await db.commission.update({ where: { sourceType_sourceId: { sourceType: "ENROLLMENT", sourceId: buyers[1].enrollmentId } }, data: { payoutId: null } });
    const more = await referredBuyer(code);
    await pay(more.enrollmentId);
    await db.commission.updateMany({ where: { sourceId: more.enrollmentId }, data: { status: "PAYABLE" } });
    expect((await balanceFor(db, referrer.userId, "USD")).payable).toBe(-735 + 735 + 735);
    await updateReferralSettings(db, admin(), settings);
  });

  it("while a payout is open: the reversed commission leaves that payout and its amount drops", async () => {
    const referrer = await registerAgent(db, talent({ displayName: "Dina E." }), meta("203.0.113.91"));
    resetRateLimits();
    const code = await ensureReferralCode(db, referrer.userId);
    const buyers = [await referredBuyer(code), await referredBuyer(code)];
    for (const b of buyers) await pay(b.enrollmentId);
    await db.commission.updateMany({ where: { referrerId: referrer.userId }, data: { availableAt: new Date(Date.now() - 1000) } });
    await releaseCommissionHolds(db);
    const actor = member(referrer.userId);
    await savePayoutDetails(db, actor, { method: "BANK_TRANSFER", accountName: "Dina E", accountNumber: "1234 5678 90", bankName: "BDO" });
    const settings = await getReferralSettings(db, admin());
    await updateReferralSettings(db, admin(), { ...settings, minimumPayoutMinor: 500 });
    const payout = await requestPayout(db, actor);
    expect(payout.amount).toBe(1470);
    await recordCourseRefund(db, sales(), buyers[0].enrollmentId, { kind: "REFUND", reason: "Refund while the payout is open" });
    const p = await db.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect([p.status, p.amount]).toEqual(["REQUESTED", 735]);
    expect((await commissionOf(buyers[0].enrollmentId))!.payoutId).toBeNull();
    await recordCourseRefund(db, sales(), buyers[1].enrollmentId, { kind: "REFUND", reason: "The other one too" });
    const closed = await db.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect([closed.status, closed.amount]).toEqual(["REJECTED", 0]);
    await updateReferralSettings(db, admin(), settings);
  });
});

describe("payouts", () => {
  let referrer = "";
  let code = "";

  it("members save payout details: the account number is encrypted, masked on the way back, and kept out of the audit log", async () => {
    resetRateLimits();
    const r = await registerAgent(db, talent({ displayName: "Eli F." }), meta("203.0.113.92"));
    referrer = r.userId;
    code = await ensureReferralCode(db, referrer);
    const actor = member(referrer);
    await expect(savePayoutDetails(db, actor, { method: "BANK_TRANSFER", accountName: "Eli F", accountNumber: "1234567890" })).rejects.toThrow();
    await expect(savePayoutDetails(db, actor, { method: "GCASH", accountName: "E", accountNumber: "12" })).rejects.toThrow();
    await savePayoutDetails(db, actor, { method: "GCASH", accountName: "Eli Flores", accountNumber: "0917 555 0199" });
    const stored = await db.payoutDetails.findUniqueOrThrow({ where: { userId: referrer } });
    expect(stored.accountNumberEnc.includes("0199")).toBe(false);
    const view = await myPayoutDetails(db, actor);
    expect(view).toMatchObject({ method: "GCASH", accountName: "Eli Flores", accountMasked: "*******0199" });
    expect(JSON.stringify(view).includes("0917 555")).toBe(false);
    const audits = JSON.stringify(await db.auditLog.findMany({ where: { action: "PAYOUT_DETAILS_SET", entityId: referrer } }));
    expect(audits.includes("0199")).toBe(false);
    await expect(savePayoutDetails(db, makeActor("CLIENT", { userId: "c1" }), { method: "GCASH", accountName: "Eli Flores", accountNumber: "0917 555 0199" })).rejects.toThrow(ForbiddenError);
  });

  it("a payout request needs details, the minimum, and takes the whole payable balance once", async () => {
    const actor = member(referrer);
    const settings = await getReferralSettings(db, admin());
    await updateReferralSettings(db, admin(), { ...settings, minimumPayoutMinor: 1000 });
    await expect(requestPayout(db, actor)).rejects.toThrow(/minimum payout is 10.00 USD/);
    const b1 = await referredBuyer(code);
    const b2 = await referredBuyer(code);
    for (const b of [b1, b2]) await pay(b.enrollmentId);
    await db.commission.updateMany({ where: { referrerId: referrer }, data: { availableAt: new Date(Date.now() - 1000) } });
    await releaseCommissionHolds(db);
    await adjustReferrerBalance(db, admin(), { referrerId: referrer, amountMinor: -70, note: "Duplicate bonus correction" });
    const overview = await referralOverview(db, actor);
    expect([overview.payable, overview.canRequestPayout, overview.sales, overview.signups]).toEqual([1470 - 70, true, 2, 2]);
    // Two requests at once: exactly one wins and nothing is double counted.
    const results = await Promise.allSettled([requestPayout(db, actor), requestPayout(db, actor)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const payouts = await db.payout.findMany({ where: { referrerId: referrer } });
    expect(payouts).toHaveLength(1);
    expect(payouts[0].amount).toBe(1400);
    expect(await db.commission.count({ where: { referrerId: referrer, payoutId: payouts[0].id } })).toBe(2);
    expect((await db.commissionAdjustment.findFirstOrThrow({ where: { referrerId: referrer } })).settledPayoutId).toBe(payouts[0].id);
    await expect(requestPayout(db, actor)).rejects.toThrow(/already have a payout in progress/);
    expect((await referralOverview(db, actor)).payable).toBe(0);
    await updateReferralSettings(db, admin(), settings);
  });

  it("staff approve, mark paid with a reference, or reject with a reason; only payout.manage may", async () => {
    const payout = (await db.payout.findFirstOrThrow({ where: { referrerId: referrer } }));
    const queue = await listPayoutQueue(db, admin(), "REQUESTED");
    const row = queue.find((q) => q.id === payout.id)!;
    expect(row.account).toMatchObject({ accountName: "Eli Flores", accountNumber: "0917 555 0199" });
    for (const actor of [sales(), member(referrer)]) {
      await expect(listPayoutQueue(db, actor)).rejects.toThrow(ForbiddenError);
      await expect(approvePayout(db, actor, payout.id)).rejects.toThrow(ForbiddenError);
      await expect(markPayoutPaid(db, actor, payout.id, { reference: "REF-1" })).rejects.toThrow(ForbiddenError);
      await expect(rejectPayout(db, actor, payout.id, { reason: "no" })).rejects.toThrow(ForbiddenError);
    }
    await expect(markPayoutPaid(db, admin(), payout.id, { reference: "REF-1" })).rejects.toThrow(/Approve the payout/);
    await approvePayout(db, admin(), payout.id);
    await expect(approvePayout(db, admin(), payout.id)).rejects.toThrow(/Only a requested payout/);
    await expect(markPayoutPaid(db, admin(), payout.id, { reference: "" })).rejects.toThrow();
    await markPayoutPaid(db, admin(), payout.id, { reference: "GCASH-778899" });
    const paid = await db.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect([paid.status, paid.reference]).toEqual(["PAID", "GCASH-778899"]);
    expect(await db.commission.count({ where: { payoutId: payout.id, status: "PAID" } })).toBe(2);
    expect((await balanceFor(db, referrer, "USD")).paid).toBe(1400);
    await drain();
    expect(await db.notification.count({ where: { userId: referrer, type: "PAYOUT_PAID" } })).toBe(1);
    expect(await db.notification.count({ where: { type: "PAYOUT_REQUESTED" } })).toBeGreaterThanOrEqual(1);
    await expect(rejectPayout(db, admin(), payout.id, { reason: "too late" })).rejects.toThrow(/already closed/);
    expect((await myPayouts(db, member(referrer)))[0]).toMatchObject({ status: "PAID", reference: "GCASH-778899" });
    expect(await db.auditLog.count({ where: { action: { in: ["PAYOUT_REQUESTED", "PAYOUT_APPROVED", "PAYOUT_PAID"] } } })).toBeGreaterThanOrEqual(3);
  });

  it("a rejected payout releases its commissions and adjustments back to the member, with the reason shown", async () => {
    const settings = await getReferralSettings(db, admin());
    await updateReferralSettings(db, admin(), { ...settings, minimumPayoutMinor: 500 });
    const actor = member(referrer);
    const b = await referredBuyer(code);
    await pay(b.enrollmentId);
    await db.commission.updateMany({ where: { sourceId: b.enrollmentId }, data: { availableAt: new Date(Date.now() - 1000) } });
    await releaseCommissionHolds(db);
    const payout = await requestPayout(db, actor);
    await expect(rejectPayout(db, admin(), payout.id, { reason: "" })).rejects.toThrow();
    await rejectPayout(db, admin(), payout.id, { reason: "Account name does not match" });
    expect(await db.commission.count({ where: { payoutId: payout.id } })).toBe(0);
    expect((await balanceFor(db, referrer, "USD")).payable).toBe(735);
    expect((await myPayouts(db, actor)).find((p) => p.id === payout.id)).toMatchObject({ status: "REJECTED", rejectReason: "Account name does not match" });
    await drain();
    expect((await db.notification.findFirstOrThrow({ where: { userId: referrer, type: "PAYOUT_REJECTED" } })).body).toContain("Account name does not match");
    await updateReferralSettings(db, admin(), settings);
  });
});

describe("what members and staff can see and do", () => {
  it("members see buyers as first name and last initial only, and no ids or emails", async () => {
    const referrer = await registerAgent(db, talent({ displayName: "Fay G." }), meta("203.0.113.93"));
    resetRateLimits();
    const code = await ensureReferralCode(db, referrer.userId);
    resetRateLimits();
    const buyer = await registerAgent(db, talent({ fullName: "Joaquin Dela Cruz", displayName: "Joaquin Dela Cruz", email: "joaquin.private@talent.example" }), meta("203.0.113.94"), undefined, { referralCode: code });
    const profile = await db.agentProfile.findFirstOrThrow({ where: { userId: buyer.userId } });
    const enrollment = await db.courseEnrollment.create({ data: { courseId: ids.course, agentProfileId: profile.id, priceCents: 4900, paymentStatus: "PENDING" } });
    await pay(enrollment.id);
    const rows = await myCommissions(db, member(referrer.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ buyer: "Joaquin C.", course: "Cold Calling Masterclass", price: 4900, rateBps: 1500, commission: 735, status: "ON_HOLD" });
    const json = JSON.stringify(rows);
    for (const secret of ["joaquin.private", "Dela Cruz", buyer.userId, profile.id]) expect(json.includes(secret), `view leaks ${secret}`).toBe(false);
    const keys = collectKeys(rows);
    for (const k of ["buyerId", "buyerEmail", "referrerId", "sourceId", "payoutId", "email"]) expect(keys.has(k), `view has key ${k}`).toBe(false);
    // Each member sees only their own commissions.
    expect(await myCommissions(db, member(ids.ben))).not.toEqual(expect.arrayContaining([expect.objectContaining({ buyer: "Joaquin C." })]));
  });

  it("only talent and agency owners have a link; other roles are refused", async () => {
    for (const actor of [makeActor("CLIENT", { userId: "x" }), makeActor("COACH", { userId: ids.coach }), sales(), admin()]) {
      await expect(referralOverview(db, actor)).rejects.toThrow(ForbiddenError);
      await expect(myCommissions(db, actor)).rejects.toThrow(ForbiddenError);
      await expect(requestPayout(db, actor)).rejects.toThrow(ForbiddenError);
    }
    expect((await referralOverview(db, member(ids.maria))).link).toBe(`http://localhost:3000/join?ref=${ids.mariaCode}`);
    expect((await referralOverview(db, member(ids.maria, "AGENCY_OWNER"))).code).toBe(ids.mariaCode);
  });

  it("settings and the affiliate tools need referral.manage; changes are audited and notes are required", async () => {
    for (const actor of [sales(), member(ids.maria), makeActor("COACH", { userId: ids.coach })]) {
      await expect(getReferralSettings(db, actor)).rejects.toThrow(ForbiddenError);
      await expect(updateReferralSettings(db, actor, { commissionRateBps: 2500 })).rejects.toThrow(ForbiddenError);
      await expect(listAffiliates(db, actor)).rejects.toThrow(ForbiddenError);
      await expect(affiliateDetail(db, actor, ids.maria)).rejects.toThrow(ForbiddenError);
      await expect(adjustReferrerBalance(db, actor, { referrerId: ids.maria, amountMinor: 100, note: "no" })).rejects.toThrow(ForbiddenError);
      await expect(reverseCommissionManually(db, actor, "x", "note here")).rejects.toThrow(ForbiddenError);
    }
    await expect(updateReferralSettings(db, admin(), { commissionRateBps: 10_001 })).rejects.toThrow();
    await expect(updateReferralSettings(db, admin(), { commissionRateBps: 1500, cookieDays: 0 })).rejects.toThrow();
    await expect(adjustReferrerBalance(db, admin(), { referrerId: ids.maria, amountMinor: 0, note: "nothing" })).rejects.toThrow();
    await expect(adjustReferrerBalance(db, admin(), { referrerId: ids.maria, amountMinor: 500, note: "" })).rejects.toThrow(/note/i);
    await expect(adjustReferrerBalance(db, admin(), { referrerId: ids.coach, amountMinor: 500, note: "not a member" })).rejects.toThrow(NotFoundError);
    const a = await adjustReferrerBalance(db, admin(), { referrerId: ids.maria, amountMinor: 250, note: "Goodwill credit" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "COMMISSION_ADJUSTED", entityId: ids.maria } });
    expect(audit.reason).toBe("Goodwill credit");
    expect(JSON.stringify(audit.newValue)).toContain(a.id);
    await drain();
    expect(await db.notification.count({ where: { userId: ids.maria, type: "COMMISSION_ADJUSTED" } })).toBe(1);
  });

  it("a manual reverse needs a note, works once, and is audited", async () => {
    const b = await referredBuyer(ids.mariaCode);
    await pay(b.enrollmentId);
    const c = (await commissionOf(b.enrollmentId))!;
    await expect(reverseCommissionManually(db, admin(), c.id, "")).rejects.toThrow(/note/i);
    await expect(reverseCommissionManually(db, admin(), "missing", "A note")).rejects.toThrow(NotFoundError);
    await reverseCommissionManually(db, admin(), c.id, "Buyer was a test account");
    expect((await commissionOf(b.enrollmentId))!.status).toBe("REVERSED");
    await expect(reverseCommissionManually(db, admin(), c.id, "Again")).rejects.toThrow(/already reversed/);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "COMMISSION_REVERSED", entityId: c.id } });
    expect(audit.reason).toBe("Buyer was a test account");
  });

  it("the affiliates list totals clicks, sign-ups, sales, and balances per referrer", async () => {
    const { rows } = await listAffiliates(db, admin());
    const maria = rows.find((r) => r.userId === ids.maria)!;
    expect(maria.clicks).toBeGreaterThanOrEqual(1);
    expect(maria.signups).toBeGreaterThanOrEqual(8);
    expect(maria.code).toBe(ids.mariaCode);
    const detail = await affiliateDetail(db, admin(), ids.maria);
    expect(detail.referred.length).toBe(maria.signups);
    expect(detail.adjustments.some((a) => a.note === "Goodwill credit")).toBe(true);
    await expect(affiliateDetail(db, admin(), "missing")).rejects.toThrow(NotFoundError);
  });
});
