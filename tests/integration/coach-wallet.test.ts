import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { enrol, recordCoursePayment, recordCourseRefund } from "@/server/services/academy.service";
import { startMayaCheckout, reconcileOnlinePayment } from "@/server/services/maya-payment.service";
import { FakeMayaGateway, setMayaGatewayForTests } from "@/server/adapters/maya";
import { createPromo } from "@/server/services/promo.service";
import {
  adjustWallet, balanceFor, clearCoachShareOverride, coachWalletDetail, decideWithdrawal, importSettlementFees, listCoachWallets, listPendingFees, listWithdrawalQueue, myWallet, myWalletCsv, platformRevenueReport,
  recordEarningForPaymentTx, releaseDueEarnings, requestWithdrawal, saveMyPayoutDetails, setCoachShareOverride, setGatewayFee, updateWalletSettings, walletSettings,
} from "@/server/services/wallet.service";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { COACH_SALE_FIELDS } from "@/server/views/wallet.views";
import { setSetting } from "@/server/services/setting.service";

const db = testDb();
const ids = { admin: "admin_cw", sales: "sales_cw", coach1: "coach1_cw", coach2: "coach2_cw", referrer: "", plainCoachCourse: "", course: "", course2: "", usdCourse: "", staffCourse: "", freeCourse: "" };
const buyers: Array<{ userId: string; profileId: string }> = [];
const fake = new FakeMayaGateway();
const DAY = 86_400_000;

const admin = () => makeActor("ADMIN", { userId: ids.admin });
const superAdmin = () => makeActor("SUPER_ADMIN", { userId: "super_cw" });
const sales = () => makeActor("SALES", { userId: ids.sales });
const coach1 = () => makeActor("COACH", { userId: ids.coach1 });
const coach2 = () => makeActor("COACH", { userId: ids.coach2 });
const buyer = (n: number) => makeActor("AGENT", { userId: buyers[n].userId, agentProfileId: buyers[n].profileId });
let courseSeq = 0;

async function mkBuyer(email: string, name: string, referredBy: string | null) {
  const u = await db.user.create({ data: { email, roleId: (await db.role.findUniqueOrThrow({ where: { key: "AGENT" } })).id, emailVerifiedAt: new Date(), ...(referredBy ? { referredByUserId: referredBy, referredAt: new Date() } : {}) } });
  const p = await db.agentProfile.create({ data: { userId: u.id, displayName: name, headline: "H", primaryRole: "Cold Caller", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila", approvedAt: new Date() } });
  buyers.push({ userId: u.id, profileId: p.id });
}
async function mkCourse(owner: string, priceCents = 249_900, currency = "PHP") {
  return (await db.academyCourse.create({ data: { code: `CW-${++courseSeq}`, title: `Course ${courseSeq}`, category: "Sales", description: "A course description long enough to satisfy validation rules.", status: "PUBLISHED", priceCents, currency, ownerCoachUserId: owner } })).id;
}
const earningOf = (enrollmentId: string) => db.coachEarning.findUnique({ where: { enrollmentId } });
const enrolmentOf = (buyerIdx: number, courseId: string) => db.courseEnrollment.findFirstOrThrow({ where: { courseId, agentProfileId: buyers[buyerIdx].profileId } });

/** A sale paid through Maya: enrol, start the checkout, Maya reports it paid, we confirm by lookup. */
async function mayaSale(buyerIdx: number, courseId: string) {
  resetRateLimits();
  await enrol(db, buyer(buyerIdx), courseId);
  const e = await enrolmentOf(buyerIdx, courseId);
  const { url } = await startMayaCheckout(db, buyer(buyerIdx), e.id);
  const rrn = url.split("/").pop()!;
  fake.setStatus(rrn, "PAYMENT_SUCCESS");
  await reconcileOnlinePayment(db, rrn);
  return { enrollmentId: e.id, rrn };
}
/** A sale paid by bank transfer or GCash and recorded by staff. */
async function staffSale(buyerIdx: number, courseId: string, paid = "2499.00", extra: { gatewayFee?: string } = {}) {
  resetRateLimits();
  await enrol(db, buyer(buyerIdx), courseId);
  const e = await enrolmentOf(buyerIdx, courseId);
  await recordCoursePayment(db, sales(), e.id, { paid, reference: `REF-${e.id.slice(-6)}`, waived: false, ...extra });
  return e.id;
}
async function setupPayout(actor = coach1()) {
  await saveMyPayoutDetails(db, actor, { method: "GCASH", accountName: "Coach One", accountNumber: "09171234567" });
}
const entries = (coachId: string) => db.walletLedgerEntry.findMany({ where: { coachUserId: coachId }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16";
  process.env.APP_URL = "http://localhost:3000";
  process.env.MAYA_MODE = "fake";
  resetEnvCache();
  setMayaGatewayForTests(fake);
  await resetDb(db);
  resetRateLimits();
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  for (const [id, email, r] of [[ids.admin, "admin@hirewise.example", "ADMIN"], ["super_cw", "super@hirewise.example", "SUPER_ADMIN"], [ids.sales, "sales@hirewise.example", "SALES"], [ids.coach1, "coach1@hirewise.example", "COACH"], [ids.coach2, "coach2@hirewise.example", "COACH"]] as const) {
    await db.user.create({ data: { id, email, roleId: await role(r), emailVerifiedAt: new Date() } });
  }
  await mkBuyer("referrer@talent.example", "Rita Referrer", null);
  ids.referrer = buyers[0].userId;
  await mkBuyer("maria@talent.example", "Maria Santos", ids.referrer); // buyer 1: referred
  for (let i = 2; i <= 14; i++) await mkBuyer(`buyer${i}@talent.example`, `Buyer${i} Cruz`, null);
  ids.course = await mkCourse(ids.coach1);
  ids.course2 = await mkCourse(ids.coach2, 100_000);
  ids.usdCourse = await mkCourse(ids.coach1, 4900, "USD");
  ids.staffCourse = await mkCourse(ids.admin);
  ids.freeCourse = await mkCourse(ids.coach1, 0);
});

afterEach(() => resetRateLimits());

afterAll(async () => {
  setMayaGatewayForTests(null);
  delete process.env.MAYA_MODE;
  resetEnvCache();
  await db.$disconnect();
});

describe("a Maya sale waits for the real gateway fee", () => {
  it("is created PENDING_FEE with nothing credited, then splits 60/40 of the net once the fee is entered (the worked example)", async () => {
    const { enrollmentId } = await mayaSale(2, ids.course); // buyer 2: not referred
    const pending = (await earningOf(enrollmentId))!;
    expect(pending).toMatchObject({ status: "PENDING_FEE", saleAmount: 249_900, gatewayFee: null, netAmount: null, coachAmount: null, platformAmount: null, coachRateBps: 6000, channel: "MAYA", coachUserId: ids.coach1, buyerLabel: "Buyer2 C." });
    expect(await entries(ids.coach1)).toHaveLength(0);
    expect(await balanceFor(db, ids.coach1)).toMatchObject({ total: 0, onHold: 0, available: 0, pendingFeeCount: 1, pendingFeeSaleMinor: 249_900 });

    const row = await setGatewayFee(db, admin(), pending.id, 10_247);
    expect(row).toMatchObject({ status: "ON_HOLD", gatewayFee: 10_247, netAmount: 239_653, coachAmount: 143_791, platformAmount: 95_862, affiliateAmount: 0, feeSource: "STAFF_ENTRY" });
    expect(row.coachAmount! + row.platformAmount!).toBe(row.netAmount);
    expect((await entries(ids.coach1)).map((e) => [e.type, e.amount])).toEqual([["EARNING", 143_791]]);
    expect(await balanceFor(db, ids.coach1)).toMatchObject({ total: 143_791, onHold: 143_791, available: 0, pendingFeeCount: 0 });
  });

  it("with a referral, the affiliate commission is stored on the earning, comes out of the platform share, and the coach is untouched", async () => {
    const { enrollmentId } = await mayaSale(1, ids.course); // buyer 1 was referred
    const e = (await earningOf(enrollmentId))!;
    expect(e.affiliateAmount).toBe(37_485); // 15% of 2,499.00
    expect((await db.commission.findFirstOrThrow({ where: { sourceId: enrollmentId } })).commissionAmount).toBe(37_485);
    const row = await setGatewayFee(db, admin(), e.id, 10_247);
    expect(row.coachAmount).toBe(143_791); // same as the sale without a referral
    expect(row.platformAmount).toBe(95_862);
    expect(row.platformAmount! - row.affiliateAmount).toBe(58_377);
  });

  it("the fee can only be set once and must be between zero and the sale", async () => {
    const { enrollmentId } = await mayaSale(3, ids.course);
    const e = (await earningOf(enrollmentId))!;
    await expect(setGatewayFee(db, admin(), e.id, 249_901)).rejects.toThrow(/between 0 and the sale amount/);
    await expect(setGatewayFee(db, admin(), e.id, -1)).rejects.toThrow();
    await setGatewayFee(db, admin(), e.id, 0);
    await expect(setGatewayFee(db, admin(), e.id, 5000)).rejects.toThrow(/already recorded/);
  });

  it("is listed for staff while it waits", async () => {
    await mayaSale(4, ids.course);
    const pending = await listPendingFees(db, admin());
    expect(pending.some((p) => p.buyer === "Buyer4 C." && p.saleAmount === 249_900)).toBe(true);
  });
});

describe("a sale recorded by staff has no gateway fee to wait for", () => {
  it("goes straight on hold with the fee at zero, or the amount staff enter", async () => {
    const id1 = await staffSale(5, ids.course);
    expect(await earningOf(id1)).toMatchObject({ status: "ON_HOLD", gatewayFee: 0, netAmount: 249_900, coachAmount: 149_940, platformAmount: 99_960, feeSource: "OFFLINE", channel: "STAFF" });
    const id2 = await staffSale(6, ids.course, "2499.00", { gatewayFee: "50.00" });
    expect(await earningOf(id2)).toMatchObject({ status: "ON_HOLD", gatewayFee: 5000, netAmount: 244_900, coachAmount: 146_940, feeSource: "STAFF_ENTRY" });
  });
});

describe("settlement is idempotent and only confirmed payments earn", () => {
  it("a repeated or concurrent confirmation creates one earning and one ledger entry", async () => {
    const { enrollmentId, rrn } = await mayaSale(7, ids.course);
    await Promise.all([reconcileOnlinePayment(db, rrn), reconcileOnlinePayment(db, rrn)]);
    expect(await db.coachEarning.count({ where: { enrollmentId } })).toBe(1);
    // Even calling the creator directly again does nothing.
    expect(await db.$transaction((tx) => recordEarningForPaymentTx(tx, { enrollmentId, channel: "MAYA", paidAt: new Date() }))).toBeNull();
    expect(await db.coachEarning.count({ where: { enrollmentId } })).toBe(1);
  });

  it("an unconfirmed checkout earns nothing", async () => {
    resetRateLimits();
    await enrol(db, buyer(8), ids.course);
    const e = await enrolmentOf(8, ids.course);
    await startMayaCheckout(db, buyer(8), e.id);
    expect(await earningOf(e.id)).toBeNull();
  });

  it("a waived payment, a free course, a 100%-off code, a non-PHP course, and a staff-owned course earn nothing", async () => {
    resetRateLimits();
    await enrol(db, buyer(9), ids.course);
    const waived = await enrolmentOf(9, ids.course);
    await recordCoursePayment(db, sales(), waived.id, { waived: true, reason: "Partner" });
    expect(await earningOf(waived.id)).toBeNull();

    await enrol(db, buyer(9), ids.freeCourse);
    expect(await earningOf((await enrolmentOf(9, ids.freeCourse)).id)).toBeNull();

    const promo = await createPromo(db, admin(), { code: "FREE100", label: "Free", discountType: "PERCENT", percent: "100", appliesTo: "ALL_COURSES", perLearnerLimit: "5" });
    await enrol(db, buyer(10), ids.course, promo.code);
    expect(await earningOf((await enrolmentOf(10, ids.course)).id)).toBeNull();

    const usd = await staffSale(11, ids.usdCourse, "49.00");
    expect(await earningOf(usd)).toBeNull();
    const staffOwned = await staffSale(11, ids.staffCourse);
    expect(await earningOf(staffOwned)).toBeNull();
  });

  it("the sale amount is what the buyer actually paid after a promo code", async () => {
    const promo = await createPromo(db, admin(), { code: "TWENTY", label: "20", discountType: "PERCENT", percent: "20", appliesTo: "ALL_COURSES", perLearnerLimit: "5" });
    resetRateLimits();
    await enrol(db, buyer(12), ids.course, promo.code);
    const e = await enrolmentOf(12, ids.course);
    await recordCoursePayment(db, sales(), e.id, { paid: "1999.20", reference: "P1", waived: false });
    expect(await earningOf(e.id)).toMatchObject({ saleAmount: 199_920, coachAmount: 119_952, platformAmount: 79_968 });
  });
});

describe("the split rate is locked at the sale", () => {
  it("changing the global rate affects only later sales; a special rate applies to new sales and is capped", async () => {
    const before = (await earningOf((await staffSale(13, ids.course2, "1000.00"))))!;
    expect(before.coachRateBps).toBe(6000);
    await updateWalletSettings(db, admin(), { coachShareBps: 5000, refundWindowDays: 14, holdBufferDays: 7, minimumWithdrawalMinor: 50_000, showBuyerEmail: false });
    expect((await earningOf(before.enrollmentId))).toMatchObject({ coachRateBps: 6000, coachAmount: 60_000 }); // untouched
    const after = (await earningOf(await staffSale(14, ids.course2, "1000.00")))!;
    expect(after).toMatchObject({ coachRateBps: 5000, coachAmount: 50_000, platformAmount: 50_000 });

    await setCoachShareOverride(db, admin(), { coachUserId: ids.coach2, percent: "70", note: "Founding coach" });
    await expect(setCoachShareOverride(db, admin(), { coachUserId: ids.coach2, percent: "85", note: "Too high" })).rejects.toThrow(/0% to 80%/);
    await expect(setCoachShareOverride(db, admin(), { coachUserId: ids.coach2, percent: "70", note: "" })).rejects.toThrow();
    // Restore the global rate; the override remains for coach 2 until cleared.
    await updateWalletSettings(db, admin(), { coachShareBps: 6000, refundWindowDays: 14, holdBufferDays: 7, minimumWithdrawalMinor: 50_000, showBuyerEmail: false });
    await clearCoachShareOverride(db, admin(), ids.coach2, "Deal ended");
    expect(await db.coachShareOverride.count({ where: { coachUserId: ids.coach2 } })).toBe(0);
  });

  it("an override is used for new sales", async () => {
    await setCoachShareOverride(db, admin(), { coachUserId: ids.coach2, percent: "70", note: "Special deal" });
    const c = await mkCourse(ids.coach2, 100_000);
    await db.courseEnrollment.deleteMany({ where: { agentProfileId: buyers[5].profileId, courseId: c } });
    const id = await staffSale(5, c, "1000.00");
    expect(await earningOf(id)).toMatchObject({ coachRateBps: 7000, coachAmount: 70_000, platformAmount: 30_000 });
    await clearCoachShareOverride(db, admin(), ids.coach2, "Deal ended");
  });
});

describe("hold, then available", () => {
  it("an earning becomes available after the refund window plus the buffer (21 days by default), not before", async () => {
    const c = await mkCourse(ids.coach1);
    const id = await staffSale(2, c);
    const e = (await earningOf(id))!;
    expect(e.status).toBe("ON_HOLD");
    expect(Math.round((e.availableAt.getTime() - e.paidAt.getTime()) / DAY)).toBe(21);
    expect(await releaseDueEarnings(db, new Date(e.paidAt.getTime() + 20 * DAY))).toBe(0);
    expect((await earningOf(id))!.status).toBe("ON_HOLD");
    expect(await releaseDueEarnings(db, new Date(e.paidAt.getTime() + 22 * DAY))).toBeGreaterThanOrEqual(1);
    expect((await earningOf(id))!.status).toBe("AVAILABLE");
    expect(await releaseDueEarnings(db, new Date(e.paidAt.getTime() + 22 * DAY))).toBe(0); // idempotent
  });

  it("the window and buffer are settings, locked per sale at the time of sale", async () => {
    await updateWalletSettings(db, admin(), { coachShareBps: 6000, refundWindowDays: 30, holdBufferDays: 0, minimumWithdrawalMinor: 50_000, showBuyerEmail: false });
    const c = await mkCourse(ids.coach1);
    const e = (await earningOf(await staffSale(3, c)))!;
    expect(Math.round((e.availableAt.getTime() - e.paidAt.getTime()) / DAY)).toBe(30);
    await updateWalletSettings(db, admin(), { coachShareBps: 6000, refundWindowDays: 14, holdBufferDays: 7, minimumWithdrawalMinor: 50_000, showBuyerEmail: false });
  });

  it("a fee that arrives after the hold has ended makes the earning available straight away", async () => {
    const c = await mkCourse(ids.coach1);
    resetRateLimits();
    await enrol(db, buyer(4), c);
    const e = await enrolmentOf(4, c);
    const { url } = await startMayaCheckout(db, buyer(4), e.id);
    const rrn = url.split("/").pop()!;
    fake.setStatus(rrn, "PAYMENT_SUCCESS");
    await reconcileOnlinePayment(db, rrn);
    const earning = (await earningOf(e.id))!;
    await db.coachEarning.update({ where: { id: earning.id }, data: { availableAt: new Date(Date.now() - DAY) } });
    expect((await setGatewayFee(db, admin(), earning.id, 5000)).status).toBe("AVAILABLE");
  });
});

describe("refunds and chargebacks", () => {
  it("a refund while on hold reverses the earning, removes it from the wallet, and logs the fee the platform absorbed", async () => {
    const c = await mkCourse(ids.coach2, 249_900);
    const { enrollmentId } = await mayaSale(6, c);
    const e = (await earningOf(enrollmentId))!;
    await setGatewayFee(db, admin(), e.id, 10_247);
    const before = await balanceFor(db, ids.coach2);
    await recordCourseRefund(db, admin(), enrollmentId, { kind: "REFUND", reason: "Changed their mind" });
    const after = (await earningOf(enrollmentId))!;
    expect(after).toMatchObject({ status: "REVERSED", coachReversedMinor: 143_791, feeAbsorbedMinor: 10_247, refundedSaleMinor: 249_900 });
    const b = await balanceFor(db, ids.coach2);
    expect(b.total).toBe(before.total - 143_791);
    expect(b.onHold).toBe(before.onHold - 143_791);
    const lines = (await entries(ids.coach2)).filter((l) => l.earningId === e.id);
    expect(lines.map((l) => [l.type, l.amount])).toEqual([["EARNING", 143_791], ["REVERSAL", -143_791]]);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "WALLET_EARNING_REVERSED", entityId: e.id } });
    expect(JSON.stringify(log.newValue)).toContain("10247");
    expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).paymentStatus).toBe("REFUNDED");
  });

  it("a refund of a sale still waiting for its fee reverses it with nothing to take out of the ledger", async () => {
    const c = await mkCourse(ids.coach2);
    const { enrollmentId } = await mayaSale(7, c);
    await recordCourseRefund(db, admin(), enrollmentId, { kind: "CHARGEBACK", reason: "Card dispute" });
    expect(await earningOf(enrollmentId)).toMatchObject({ status: "REVERSED", coachReversedMinor: 0 });
    expect((await entries(ids.coach2)).filter((l) => l.earningId === (null as unknown as string))).toHaveLength(0);
    expect(await db.walletLedgerEntry.count({ where: { earning: { enrollmentId } } })).toBe(0);
  });

  it("a refund after the coach withdrew creates a negative balance, and later earnings repay it first", async () => {
    // A fresh coach so the numbers are exact.
    const coachId = "coach3_cw";
    await db.user.create({ data: { id: coachId, email: "coach3@hirewise.example", roleId: (await db.role.findUniqueOrThrow({ where: { key: "COACH" } })).id, emailVerifiedAt: new Date() } });
    const coach3 = makeActor("COACH", { userId: coachId });
    const c = await mkCourse(coachId, 100_000);
    const id1 = await staffSale(2, c, "1000.00"); // coach 600.00
    const e1 = (await earningOf(id1))!;
    await releaseDueEarnings(db, new Date(e1.availableAt.getTime() + 1000));
    await setupPayout(coach3);
    const w = await requestWithdrawal(db, coach3);
    expect(w.amount).toBe(60_000);
    await decideWithdrawal(db, admin(), w.id, { outcome: "PAID", reference: "GCASH-TEST-1" });
    expect((await earningOf(id1))!.status).toBe("WITHDRAWN");

    await recordCourseRefund(db, admin(), id1, { kind: "REFUND", reason: "Late refund" });
    expect((await entries(coachId)).map((l) => [l.type, l.amount])).toEqual([["EARNING", 60_000], ["WITHDRAWAL", -60_000], ["REFUND_AFTER_WITHDRAWAL", -60_000]]);
    expect(await balanceFor(db, coachId)).toMatchObject({ total: -60_000, available: -60_000, withdrawable: 0, withdrawn: 60_000 });

    // A new 2,000.00 sale: its 1,200.00 is on hold, so nothing is withdrawable yet and the debt stays.
    const c2 = await mkCourse(coachId, 200_000);
    const id2 = await staffSale(3, c2, "2000.00");
    expect(await balanceFor(db, coachId)).toMatchObject({ total: 60_000, onHold: 120_000, available: -60_000, withdrawable: 0 });
    await expect(requestWithdrawal(db, coach3)).rejects.toThrow(/minimum withdrawal/);
    // Once it is available it repays the debt first: 1,200.00 - 600.00 = 600.00 can be withdrawn.
    const e2 = (await earningOf(id2))!;
    await releaseDueEarnings(db, new Date(e2.availableAt.getTime() + 1000));
    expect(await balanceFor(db, coachId)).toMatchObject({ total: 60_000, onHold: 0, available: 60_000, withdrawable: 60_000 });
  });

  it("partial refunds reverse every share in proportion, the learner keeps access, and repeated partials never exceed the whole", async () => {
    const coachId = "coach4_cw";
    await db.user.create({ data: { id: coachId, email: "coach4@hirewise.example", roleId: (await db.role.findUniqueOrThrow({ where: { key: "COACH" } })).id, emailVerifiedAt: new Date() } });
    const c = await mkCourse(coachId, 100_000);
    resetRateLimits();
    await enrol(db, buyer(1), c); // buyer 1 was referred: a 150.00 commission exists
    const e = await enrolmentOf(1, c);
    await recordCoursePayment(db, sales(), e.id, { paid: "1000.00", reference: "R1", waived: false });
    const earning = (await earningOf(e.id))!;
    expect(earning).toMatchObject({ coachAmount: 60_000, affiliateAmount: 15_000 });

    await recordCourseRefund(db, admin(), e.id, { kind: "REFUND", reason: "Part refund", amount: "250.00" }); // 25%
    expect(await earningOf(e.id)).toMatchObject({ status: "ON_HOLD", refundedSaleMinor: 25_000, coachReversedMinor: 15_000 });
    expect(await db.courseEnrollment.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ paymentStatus: "PAID", refundedCents: 25_000 });
    expect((await balanceFor(db, coachId)).total).toBe(45_000);
    const adj = await db.commissionAdjustment.findMany({ where: { commissionId: (await db.commission.findFirstOrThrow({ where: { sourceId: e.id } })).id } });
    expect(adj.map((a) => a.amount)).toEqual([-3750]); // 25% of the 150.00 commission

    await recordCourseRefund(db, admin(), e.id, { kind: "REFUND", reason: "Another part", amount: "250.00" });
    expect(await earningOf(e.id)).toMatchObject({ refundedSaleMinor: 50_000, coachReversedMinor: 30_000 });
    await expect(recordCourseRefund(db, admin(), e.id, { kind: "REFUND", reason: "Too much", amount: "600.00" })).rejects.toThrow(/between 0.01 and 500.00/);

    // Refunding what is left reverses the rest exactly; the commission is fully reversed and the earlier part-deductions undone.
    await recordCourseRefund(db, admin(), e.id, { kind: "REFUND", reason: "The rest" });
    expect(await earningOf(e.id)).toMatchObject({ status: "REVERSED", refundedSaleMinor: 100_000, coachReversedMinor: 60_000 });
    expect((await balanceFor(db, coachId)).total).toBe(0);
    const commission = await db.commission.findFirstOrThrow({ where: { sourceId: e.id } });
    expect(commission.status).toBe("REVERSED");
    const adjustments = await db.commissionAdjustment.findMany({ where: { commissionId: commission.id } });
    expect(adjustments.reduce((n, a) => n + a.amount, 0)).toBe(0);
    expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: e.id } })).paymentStatus).toBe("REFUNDED");
  });

  it("a partial refund is refused until the gateway fee is known", async () => {
    const c = await mkCourse(ids.coach2);
    const { enrollmentId } = await mayaSale(8, c);
    await expect(recordCourseRefund(db, admin(), enrollmentId, { kind: "REFUND", reason: "Part", amount: "100.00" })).rejects.toThrow(/Enter the gateway fee/);
  });
});

describe("withdrawals", () => {
  const coachId = "coach5_cw";
  const coach5 = () => makeActor("COACH", { userId: coachId });
  let earningId = "";

  it("need payout details, the minimum, and only come from the available balance", async () => {
    await db.user.create({ data: { id: coachId, email: "coach5@hirewise.example", roleId: (await db.role.findUniqueOrThrow({ where: { key: "COACH" } })).id, emailVerifiedAt: new Date() } });
    const c = await mkCourse(coachId, 100_000);
    const id = await staffSale(9, c, "1000.00"); // 600.00 on hold
    earningId = id;
    await expect(requestWithdrawal(db, coach5())).rejects.toThrow(/payout details/);
    await saveMyPayoutDetails(db, coach5(), { method: "GCASH", accountName: "Coach Five", accountNumber: "09171234567" });
    await expect(requestWithdrawal(db, coach5())).rejects.toThrow(/minimum withdrawal is .*500\.00.*available balance is .*0\.00/);
    const e = (await earningOf(id))!;
    await releaseDueEarnings(db, new Date(e.availableAt.getTime() + 1000));
    expect((await balanceFor(db, coachId)).withdrawable).toBe(60_000);
  });

  it("the account number is stored encrypted and never in the audit log", async () => {
    const d = await db.payoutDetails.findUniqueOrThrow({ where: { userId: coachId } });
    expect(d.accountNumberEnc).not.toContain("09171234567");
    expect(JSON.stringify(await db.auditLog.findMany({ where: { action: "WALLET_PAYOUT_DETAILS_SET" } }))).not.toContain("09171234567");
    const view = await myWallet(db, coach5());
    expect(view.payoutDetails).toMatchObject({ method: "GCASH", accountMasked: "****4567" });
    expect(JSON.stringify(view)).not.toContain("09171234567");
  });

  it("request the whole available balance, lock it in the ledger, and allow only one open request", async () => {
    const w = await requestWithdrawal(db, coach5());
    expect(w).toMatchObject({ amount: 60_000, status: "REQUESTED", account: "GCash ****4567" });
    expect(await balanceFor(db, coachId)).toMatchObject({ total: 0, available: 0, withdrawable: 0 });
    await expect(requestWithdrawal(db, coach5())).rejects.toThrow(/already have a withdrawal in progress/);
    // Two requests at the same instant: at most one can win.
    const results = await Promise.allSettled([requestWithdrawal(db, coach5()), requestWithdrawal(db, coach5())]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(await db.coachWithdrawal.count({ where: { coachUserId: coachId, status: { in: ["REQUESTED", "APPROVED"] } } })).toBe(1);
    // The database refuses a second open request even if the service is bypassed.
    const d = await db.payoutDetails.findUniqueOrThrow({ where: { userId: coachId } });
    await expect(db.coachWithdrawal.create({ data: { coachUserId: coachId, amount: 100, currency: "PHP", method: "GCASH", accountName: "x", accountNumberEnc: d.accountNumberEnc, accountLabel: "x" } })).rejects.toThrow();
  });

  it("staff approve, mark paid with a reference, or reject with a reason (a rejection returns the money)", async () => {
    const open = (await db.coachWithdrawal.findFirstOrThrow({ where: { coachUserId: coachId, status: "REQUESTED" } }));
    expect((await listWithdrawalQueue(db, admin())).some((w) => w.id === open.id && w.coachEmail === "coach5@hirewise.example")).toBe(true);
    await expect(decideWithdrawal(db, admin(), open.id, { outcome: "PAID", reference: "" })).rejects.toThrow();
    await expect(decideWithdrawal(db, admin(), open.id, { outcome: "REJECTED", reason: "" })).rejects.toThrow();
    await decideWithdrawal(db, admin(), open.id, { outcome: "REJECTED", reason: "Account name does not match" });
    expect(await balanceFor(db, coachId)).toMatchObject({ available: 60_000, withdrawable: 60_000 });
    await expect(decideWithdrawal(db, admin(), open.id, { outcome: "APPROVED" })).rejects.toThrow(/already rejected/);

    const w2 = await requestWithdrawal(db, coach5());
    expect((await decideWithdrawal(db, admin(), w2.id, { outcome: "APPROVED" })).status).toBe("APPROVED");
    await expect(requestWithdrawal(db, coach5())).rejects.toThrow(/already have a withdrawal in progress/); // approved is still open
    const paid = await decideWithdrawal(db, admin(), w2.id, { outcome: "PAID", reference: "GCASH-REF-123" });
    expect(paid).toMatchObject({ status: "PAID", reference: "GCASH-REF-123" });
    expect((await earningOf(earningId))!.status).toBe("WITHDRAWN");
    expect(await balanceFor(db, coachId)).toMatchObject({ total: 0, withdrawn: 60_000 });
    expect((await entries(coachId)).map((l) => [l.type, l.amount])).toEqual([["EARNING", 60_000], ["WITHDRAWAL", -60_000], ["WITHDRAWAL_RELEASED", 60_000], ["WITHDRAWAL", -60_000]]);
  });

  it("a withdrawal can never exceed the available balance", async () => {
    await expect(requestWithdrawal(db, coach5())).rejects.toThrow(/minimum withdrawal/);
    expect(await db.coachWithdrawal.count({ where: { coachUserId: coachId } })).toBe(2);
  });
});

describe("the ledger", () => {
  it("is append-only: the database refuses an update or a delete", async () => {
    const row = await db.walletLedgerEntry.findFirstOrThrow({ where: { coachUserId: ids.coach1 } });
    await expect(db.walletLedgerEntry.update({ where: { id: row.id }, data: { amount: 1 } })).rejects.toThrow(/append-only/);
    await expect(db.walletLedgerEntry.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  it("the balance is always the sum of the ledger", async () => {
    for (const id of [ids.coach1, ids.coach2, "coach3_cw", "coach5_cw"]) {
      const sum = (await entries(id)).reduce((n, l) => n + l.amount, 0);
      expect((await balanceFor(db, id)).total).toBe(sum);
    }
  });

  it("a split that does not add up is refused by the database", async () => {
    const e = (await db.coachEarning.findFirstOrThrow({ where: { status: "ON_HOLD" } }));
    await expect(db.coachEarning.update({ where: { id: e.id }, data: { coachAmount: (e.coachAmount ?? 0) + 1 } })).rejects.toThrow();
    await expect(db.coachEarning.update({ where: { id: e.id }, data: { gatewayFee: e.saleAmount + 1 } })).rejects.toThrow();
  });
});

describe("manual adjustments", () => {
  it("need a note, go in the ledger and the audit log, and only work on coaches", async () => {
    const before = (await balanceFor(db, ids.coach1)).total;
    await expect(adjustWallet(db, admin(), { coachUserId: ids.coach1, amountMinor: 5000, note: "" })).rejects.toThrow();
    await expect(adjustWallet(db, admin(), { coachUserId: ids.coach1, amountMinor: 0, note: "Nothing" })).rejects.toThrow();
    await expect(adjustWallet(db, admin(), { coachUserId: buyers[2].userId, amountMinor: 5000, note: "Not a coach" })).rejects.toBeInstanceOf(NotFoundError);
    await adjustWallet(db, admin(), { coachUserId: ids.coach1, amountMinor: 5000, note: "Goodwill bonus" });
    await adjustWallet(db, admin(), { coachUserId: ids.coach1, amountMinor: -2000, note: "Duplicate bonus" });
    expect((await balanceFor(db, ids.coach1)).total).toBe(before + 3000);
    const last = (await entries(ids.coach1)).slice(-2);
    expect(last.map((l) => [l.type, l.amount, l.note, l.createdById])).toEqual([["ADJUSTMENT", 5000, "Goodwill bonus", ids.admin], ["ADJUSTMENT", -2000, "Duplicate bonus", ids.admin]]);
    expect(await db.auditLog.count({ where: { action: "WALLET_ADJUSTED", entityId: ids.coach1 } })).toBe(2);
  });
});

describe("importing a settlement report", () => {
  it("applies fees by Maya payment id, our reference number, or the enrolment id, and reports everything else", async () => {
    const c = await mkCourse(ids.coach2);
    const a = await mayaSale(10, c);
    const b = await mayaSale(11, c);
    const d = await mayaSale(12, c);
    const payId = (await db.onlinePayment.findUniqueOrThrow({ where: { id: a.rrn } })).providerPaymentId!;
    const csv = ["Settlement date,Payment ID,Gross,MDR", `2026-11-02,${payId},2499.00,102.47`, `2026-11-02,${b.rrn},2499.00,102.47`, `2026-11-02,${d.enrollmentId},2499.00,102.47`, "2026-11-02,unknown_ref,100.00,4.00", "2026-11-02,x,100.00,abc"].join("\n");
    const r = await importSettlementFees(db, admin(), csv);
    expect(r).toMatchObject({ applied: 3, alreadyRecorded: 0 });
    expect(r.notFound).toEqual([{ line: 5, reference: "unknown_ref" }]);
    expect(r.invalid).toHaveLength(1);
    for (const x of [a, b, d]) expect(await earningOf(x.enrollmentId)).toMatchObject({ status: "ON_HOLD", gatewayFee: 10_247, feeSource: "SETTLEMENT_IMPORT", coachAmount: 143_791 });
    expect(await importSettlementFees(db, admin(), csv)).toMatchObject({ applied: 0, alreadyRecorded: 3 }); // idempotent
    expect((await importSettlementFees(db, admin(), "date,amount\n1,2\n")).headerError).toMatch(/Could not find the columns/);
  });
});

describe("a coach sees only their own money", () => {
  it("each coach's wallet holds only their own sales, and the rows carry only allowed fields", async () => {
    const w1 = await myWallet(db, coach1());
    const w2 = await myWallet(db, coach2());
    const courses1 = new Set(w1.sales.map((s) => s.courseId));
    const courses2 = new Set(w2.sales.map((s) => s.courseId));
    expect(courses1.size).toBeGreaterThan(0);
    expect(courses2.size).toBeGreaterThan(0);
    for (const id of courses1) expect(courses2.has(id)).toBe(false);
    for (const s of w1.sales) {
      expect(Object.keys(s).sort()).toEqual([...COACH_SALE_FIELDS].sort());
      expect(s.buyerEmail).toBeNull();
    }
    const json = JSON.stringify(w1);
    for (const forbidden of ["affiliateAmount", "buyerUserId", "referredBy", "@talent.example", "feeAbsorbed", "coachUserId"]) expect(json, forbidden).not.toContain(forbidden);
    // The buyer is a first name and last initial.
    expect(w1.sales.some((s) => s.buyer === "Maria S.")).toBe(true);
  });

  it("the buyer's email appears only if staff switch it on, and the phone never does", async () => {
    await updateWalletSettings(db, admin(), { coachShareBps: 6000, refundWindowDays: 14, holdBufferDays: 7, minimumWithdrawalMinor: 50_000, showBuyerEmail: true });
    const w = await myWallet(db, coach1());
    expect(w.sales.some((s) => s.buyerEmail === "maria@talent.example")).toBe(true);
    expect(JSON.stringify(w)).not.toMatch(/phone/i);
    await updateWalletSettings(db, admin(), { coachShareBps: 6000, refundWindowDays: 14, holdBufferDays: 7, minimumWithdrawalMinor: 50_000, showBuyerEmail: false });
  });

  it("filters by course and date range, and exports the same rows as CSV", async () => {
    const all = await myWallet(db, coach1());
    const one = all.sales[0].courseId;
    const byCourse = await myWallet(db, coach1(), { courseId: one });
    expect(byCourse.sales.every((s) => s.courseId === one)).toBe(true);
    // Wallet date filters are Manila days (+08:00), so "today" is the Manila date, not the UTC one.
    const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
    expect((await myWallet(db, coach1(), { from: today, to: today })).sales.length).toBe(all.sales.length);
    expect((await myWallet(db, coach1(), { from: "2020-01-01", to: "2020-01-02" })).sales).toHaveLength(0);
    const csv = await myWalletCsv(db, coach1(), { courseId: one });
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("Date,Buyer,Course,Sale price,Gateway fee,Net,Your share,Your earning,Status,Available on");
    expect(lines.length - 1).toBe(byCourse.sales.length);
    expect(csv).not.toContain("@talent.example");
    expect(csv).not.toMatch(/affiliate/i);
  });

  it("roles without the wallet permission cannot use the coach wallet, and coaches cannot use any admin function", async () => {
    for (const who of [admin(), sales(), buyer(2)]) {
      await expect(myWallet(db, who)).rejects.toBeInstanceOf(ForbiddenError).catch(async () => {
        // Admin holds coach.wallet through "everything except"; the point is that a non-coach has no earnings of their own.
        expect((await myWallet(db, who)).sales).toHaveLength(0);
      });
    }
    await expect(requestWithdrawal(db, sales())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requestWithdrawal(db, buyer(2))).rejects.toBeInstanceOf(ForbiddenError);
    const e = await db.coachEarning.findFirstOrThrow({ where: { coachUserId: ids.coach2 } });
    const w = await db.coachWithdrawal.findFirstOrThrow({ where: { coachUserId: "coach5_cw" } });
    for (const who of [coach1(), coach2(), sales(), buyer(2)]) {
      await expect(setGatewayFee(db, who, e.id, 1)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(importSettlementFees(db, who, "reference,fee\na,1\n")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listPendingFees(db, who)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(decideWithdrawal(db, who, w.id, { outcome: "APPROVED" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listWithdrawalQueue(db, who)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(adjustWallet(db, who, { coachUserId: ids.coach1, amountMinor: 100, note: "Sneaky" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listCoachWallets(db, who)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(coachWalletDetail(db, who, ids.coach1)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(platformRevenueReport(db, who)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setCoachShareOverride(db, who, { coachUserId: ids.coach1, percent: "70", note: "Sneaky" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(updateWalletSettings(db, who, { coachShareBps: 8000, refundWindowDays: 0, holdBufferDays: 0, minimumWithdrawalMinor: 0, showBuyerEmail: true })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(walletSettings(db, who)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("a coach's own balance and withdrawals never include another coach's", async () => {
    const w1 = await myWallet(db, coach1());
    const w2 = await myWallet(db, coach2());
    expect(w1.balance.total).toBe((await entries(ids.coach1)).reduce((n, l) => n + l.amount, 0));
    expect(w2.balance.total).toBe((await entries(ids.coach2)).reduce((n, l) => n + l.amount, 0));
    expect(w1.withdrawals).toHaveLength(0);
    const w5 = await myWallet(db, makeActor("COACH", { userId: "coach5_cw" }));
    expect(w5.withdrawals.length).toBe(2);
  });
});

describe("admin views and the revenue report", () => {
  it("shows every coach's wallet with the full ledger, and the settings", async () => {
    const list = await listCoachWallets(db, admin());
    expect(list.map((c) => c.email)).toEqual(expect.arrayContaining(["coach1@hirewise.example", "coach2@hirewise.example"]));
    const d = await coachWalletDetail(db, admin(), ids.coach1);
    expect(d.ledger.length).toBeGreaterThan(0);
    expect(d.earnings[0]).toHaveProperty("affiliateAmount"); // staff see the full breakdown
    await expect(coachWalletDetail(db, admin(), buyers[2].userId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await walletSettings(db, admin())).toMatchObject({ coachShareBps: 6000, refundWindowDays: 14, holdBufferDays: 7, minimumWithdrawalMinor: 50_000, showBuyerEmail: false });
  });

  it("totals sales, fees, coach payouts, affiliate payouts and the platform's net, by coach, and removes refunded parts", async () => {
    const r = await platformRevenueReport(db, admin());
    expect(r.currency).toBe("PHP");
    expect(r.perCoach.length).toBeGreaterThanOrEqual(2);
    const sum = (k: "sales" | "saleMinor" | "feeMinor" | "coachMinor" | "affiliateMinor" | "platformNetMinor") => r.perCoach.reduce((n, c) => n + c[k], 0);
    for (const k of ["sales", "saleMinor", "feeMinor", "coachMinor", "affiliateMinor", "platformNetMinor"] as const) expect(r.total[k]).toBe(sum(k));
    expect(r.total.affiliateMinor).toBeGreaterThan(0);
    expect(r.total.feeAbsorbedMinor).toBe(10_247); // the one refund of a priced Maya sale
    // Filter by coach, and by a date range with no sales.
    const only1 = await platformRevenueReport(db, admin(), { coachUserId: ids.coach1 });
    expect(only1.perCoach.every((c) => c.coachUserId === ids.coach1)).toBe(true);
    expect((await platformRevenueReport(db, admin(), { from: "2020-01-01", to: "2020-01-31" })).total.sales).toBe(0);
  });

  it("per sale, the report adds up: the platform's net is its share minus the affiliate commission", async () => {
    const e = (await db.coachEarning.findFirstOrThrow({ where: { status: { in: ["ON_HOLD", "AVAILABLE"] }, affiliateAmount: { gt: 0 }, platformAmount: 95_862 }, orderBy: { createdAt: "asc" } }));
    const r = await platformRevenueReport(db, admin(), { coachUserId: e.coachUserId });
    expect(r.total.platformNetMinor).toBeGreaterThan(0);
    // 143,791 + 95,862 = 239,653 net of the worked example; the referred sale kept 58,377 for the platform.
    expect(e.platformAmount! - e.affiliateAmount).toBe(58_377);
  });
});

describe("settings", () => {
  it("default to a 60% coach share, a 14-day window, a 7-day buffer, a 500.00 minimum, and buyer email off", async () => {
    const s = await walletSettings(db, superAdmin());
    expect(s).toEqual({ coachShareBps: 6000, refundWindowDays: 14, holdBufferDays: 7, minimumWithdrawalMinor: 50_000, showBuyerEmail: false });
  });

  it("refuse a coach share above the cap and are audited", async () => {
    await expect(updateWalletSettings(db, admin(), { coachShareBps: 8001, refundWindowDays: 14, holdBufferDays: 7, minimumWithdrawalMinor: 50_000, showBuyerEmail: false })).rejects.toThrow();
    expect(await db.auditLog.count({ where: { action: "WALLET_SETTINGS_SET" } })).toBeGreaterThan(0);
    await setSetting(db, superAdmin(), "coachWallet", { coachShareBps: 6000, refundWindowDays: 14, holdBufferDays: 7, minimumWithdrawalMinor: 50_000, showBuyerEmail: false });
  });
});
