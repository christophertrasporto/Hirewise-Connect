import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { enrol, recordCoursePayment, recordCourseRefund, getEnrollmentForAgent } from "@/server/services/academy.service";
import { createPromo, updatePromo, setPromoStatus, listPromos, getPromoRedemptions, previewPromo, applyPromoToEnrollment, removePromoFromEnrollment, releaseStaleReservations, PromoError } from "@/server/services/promo.service";
import { startMayaCheckout, reconcileOnlinePayment } from "@/server/services/maya-payment.service";
import { FakeMayaGateway, setMayaGatewayForTests } from "@/server/adapters/maya";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { runWorkerOnce } from "@/server/jobs/worker";
import { PROMO_REFUSAL_MESSAGE } from "@/lib/promo";
import { setSetting } from "@/server/services/setting.service";

const db = testDb();
const ids = { admin: "admin_pr", sales: "sales_pr", coach: "coach_pr", recruiter: "recruiter_pr", referrer: "", course: "", course2: "", usdCourse: "", freeCourse: "" };
const learners: Array<{ userId: string; profileId: string }> = [];
const fake = new FakeMayaGateway();

const admin = () => makeActor("ADMIN", { userId: ids.admin });
const superAdmin = () => makeActor("SUPER_ADMIN", { userId: "super_pr" });
const sales = () => makeActor("SALES", { userId: ids.sales });
const coach = () => makeActor("COACH", { userId: ids.coach });
const recruiter = () => makeActor("RECRUITER", { userId: ids.recruiter });
const learner = (n: number) => makeActor("AGENT", { userId: learners[n].userId, agentProfileId: learners[n].profileId });

const base = { label: "Launch week", discountType: "PERCENT" as const, percent: "20", appliesTo: "ALL_COURSES" as const, perLearnerLimit: "1" };
let seq = 0;
const newCode = (over: Partial<Parameters<typeof createPromo>[2]> = {}) => createPromo(db, admin(), { ...base, code: `PROMO${++seq}`, ...over });
let courseSeq = 0;
const freshCourse = async (priceCents = 100_000) => (await db.academyCourse.create({ data: { code: `FRESH-${++courseSeq}`, title: `Fresh course ${courseSeq}`, category: "Sales", description: "A course description long enough to satisfy validation rules.", status: "PUBLISHED", priceCents, currency: "PHP", ownerCoachUserId: ids.coach } })).id;
const enrolment = (n: number, courseId = ids.course) => db.courseEnrollment.findFirstOrThrow({ where: { courseId, agentProfileId: learners[n].profileId } });
const live = (enrollmentId: string) => db.promoRedemption.findFirst({ where: { enrollmentId, status: { in: ["RESERVED", "CONSUMED"] } } });
async function drain() {
  for (let i = 0; i < 10; i++) if (!(await runWorkerOnce(db)).events) break;
}
async function mkLearner(email: string, referredBy: string | null) {
  const u = await db.user.create({ data: { email, roleId: (await db.role.findUniqueOrThrow({ where: { key: "AGENT" } })).id, emailVerifiedAt: new Date(), ...(referredBy ? { referredByUserId: referredBy, referredAt: new Date() } : {}) } });
  const p = await db.agentProfile.create({ data: { userId: u.id, displayName: email.split("@")[0], headline: "H", primaryRole: "Cold Caller", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila", approvedAt: new Date() } });
  learners.push({ userId: u.id, profileId: p.id });
}

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
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN") } });
  await db.user.create({ data: { id: "super_pr", email: "super@hirewise.example", roleId: await role("SUPER_ADMIN") } });
  await db.user.create({ data: { id: ids.sales, email: "sales@hirewise.example", roleId: await role("SALES") } });
  await db.user.create({ data: { id: ids.coach, email: "coach@hirewise.example", roleId: await role("COACH") } });
  await db.user.create({ data: { id: ids.recruiter, email: "recruiter@hirewise.example", roleId: await role("RECRUITER") } });
  await mkLearner("referrer@talent.example", null);
  ids.referrer = learners[0].userId;
  await mkLearner("buyer1@talent.example", ids.referrer); // referred
  for (let i = 2; i <= 9; i++) await mkLearner(`buyer${i}@talent.example`, null);
  const mk = async (title: string, priceCents: number, currency: string) => (await db.academyCourse.create({ data: { code: title.replace(/\s/g, "-").toUpperCase(), title, category: "Sales", description: "A course description long enough to satisfy validation rules.", status: "PUBLISHED", priceCents, currency, ownerCoachUserId: ids.coach } })).id;
  ids.course = await mk("Cold Calling Masterclass", 100_000, "PHP"); // PHP 1,000.00
  ids.course2 = await mk("Objection Handling", 50_000, "PHP");
  ids.usdCourse = await mk("Closing Mastery USD", 4900, "USD");
  ids.freeCourse = await mk("Freelancers Foundation Program", 0, "PHP");
});

afterEach(() => resetRateLimits());

afterAll(async () => {
  setMayaGatewayForTests(null);
  delete process.env.MAYA_MODE;
  resetEnvCache();
  await db.$disconnect();
});

describe("staff manage codes (promo.manage)", () => {
  it("Admin and Super Admin create, edit, pause, resume and archive; every change is audited", async () => {
    const p = await createPromo(db, admin(), { ...base, code: " spring 20 " });
    expect(p.code).toBe("SPRING20"); // normalised
    expect(p).toMatchObject({ discountType: "PERCENT", percentBps: 2000, status: "ACTIVE", perLearnerLimit: 1 });
    await updatePromo(db, superAdmin(), p.id, { ...base, code: "SPRING20", label: "Spring", percent: "25", maxRedemptions: "50", startsOn: "2099-11-01", endsOn: "2099-11-30" });
    const edited = (await listPromos(db, admin())).find((x) => x.id === p.id)!;
    expect(edited).toMatchObject({ percent: "25", maxRedemptions: 50, startsOn: "2099-11-01", endsOn: "2099-11-30", effective: "SCHEDULED" });
    await setPromoStatus(db, admin(), p.id, "PAUSED");
    expect((await db.promoCode.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PAUSED");
    await setPromoStatus(db, admin(), p.id, "ACTIVE");
    await setPromoStatus(db, admin(), p.id, "ARCHIVED");
    await expect(setPromoStatus(db, admin(), p.id, "ACTIVE")).rejects.toThrow(/archived code cannot be used again/);
    const actions = (await db.auditLog.findMany({ where: { entityId: p.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["PROMO_CREATED", "PROMO_UPDATED", "PROMO_STATUS_CHANGED", "PROMO_STATUS_CHANGED", "PROMO_STATUS_CHANGED"]);
  });

  it("every role without promo.manage is refused", async () => {
    const p = await newCode();
    for (const who of [sales(), coach(), recruiter(), learner(2)]) {
      await expect(createPromo(db, who, { ...base, code: "NOPE1" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(updatePromo(db, who, p.id, { ...base, code: p.code })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setPromoStatus(db, who, p.id, "PAUSED")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listPromos(db, who)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getPromoRedemptions(db, who, p.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("rejects duplicates, renames, bad shapes, and unknown courses", async () => {
    const p = await newCode();
    await expect(createPromo(db, admin(), { ...base, code: p.code })).rejects.toThrow(/already exists/);
    await expect(updatePromo(db, admin(), p.id, { ...base, code: "RENAMED" })).rejects.toThrow(/cannot be renamed/);
    await expect(createPromo(db, admin(), { ...base, code: "AB" })).rejects.toThrow();
    await expect(createPromo(db, admin(), { ...base, code: "BADPCT", percent: "0" })).rejects.toThrow();
    await expect(createPromo(db, admin(), { ...base, code: "BADPCT2", percent: "101" })).rejects.toThrow();
    await expect(createPromo(db, admin(), { ...base, code: "BADAMT", discountType: "AMOUNT", amount: "" })).rejects.toThrow();
    await expect(createPromo(db, admin(), { ...base, code: "BADRANGE", startsOn: "2026-12-02", endsOn: "2026-12-01" })).rejects.toThrow();
    await expect(createPromo(db, admin(), { ...base, code: "NOCOURSE", appliesTo: "SELECTED_COURSES", courseIds: [] })).rejects.toThrow();
    await expect(createPromo(db, admin(), { ...base, code: "GHOST", appliesTo: "SELECTED_COURSES", courseIds: ["nope"] })).rejects.toThrow(/no longer exists/);
  });

  it("the database refuses a malformed code even if the service is bypassed", async () => {
    await expect(db.promoCode.create({ data: { code: "lower", label: "x", discountType: "PERCENT", percentBps: 1000, createdById: ids.admin } })).rejects.toThrow();
    await expect(db.promoCode.create({ data: { code: "GOODCODE", label: "x", discountType: "PERCENT", percentBps: 20_000, createdById: ids.admin } })).rejects.toThrow();
    await expect(db.promoCode.create({ data: { code: "GOODCODE", label: "x", discountType: "AMOUNT", amountMinor: 100, createdById: ids.admin } })).rejects.toThrow(); // no currency
  });
});

describe("what a learner is told", () => {
  it("previews the price without writing anything", async () => {
    const p = await newCode({ percent: "20" });
    const q = await previewPromo(db, learner(2), ids.course, p.code.toLowerCase());
    expect(q).toMatchObject({ code: p.code, listMinor: 100_000, discountMinor: 20_000, finalMinor: 80_000, currency: "PHP" });
    expect(q.finalPrice).toContain("800.00");
    expect(await db.promoRedemption.count({ where: { promoCodeId: p.id } })).toBe(0);
    expect(await db.courseEnrollment.count({ where: { agentProfileId: learners[2].profileId } })).toBe(0);
  });

  it("gives one generic refusal for every reason, so codes cannot be probed", async () => {
    const paused = await newCode();
    await setPromoStatus(db, admin(), paused.id, "PAUSED");
    const expired = await newCode({ endsOn: "2020-01-01", startsOn: "2019-01-01" });
    const future = await newCode({ startsOn: "2099-01-01" });
    const scoped = await newCode({ appliesTo: "SELECTED_COURSES", courseIds: [ids.course2] });
    const minimum = await newCode({ minPrice: "5000" });
    const usdOnly = await newCode({ discountType: "AMOUNT", amount: "10", currency: "USD" });
    const used = await newCode({ maxRedemptions: "1" });
    await enrol(db, learner(8), await freshCourse(), used.code);
    const attempts: Array<[string, string]> = [["NOSUCHCODE", ids.course], [paused.code, ids.course], [expired.code, ids.course], [future.code, ids.course], [scoped.code, ids.course], [minimum.code, ids.course], [usdOnly.code, ids.course], [used.code, ids.course], ["ANYCODE", ids.freeCourse]];
    for (const [code, courseId] of attempts) {
      const err = await previewPromo(db, learner(2), courseId, code).catch((e) => e);
      expect(err, code).toBeInstanceOf(PromoError);
      expect((err as Error).message, code).toBe(PROMO_REFUSAL_MESSAGE);
    }
  });

  it("applies a code to the selected course only, and an amount code only in its currency", async () => {
    const scoped = await newCode({ appliesTo: "SELECTED_COURSES", courseIds: [ids.course2] });
    expect((await previewPromo(db, learner(2), ids.course2, scoped.code)).finalMinor).toBe(40_000);
    const usd = await newCode({ discountType: "AMOUNT", amount: "10", currency: "USD" });
    expect((await previewPromo(db, learner(2), ids.usdCourse, usd.code)).finalMinor).toBe(3900);
    await expect(previewPromo(db, learner(2), ids.course, usd.code)).rejects.toThrow(PROMO_REFUSAL_MESSAGE);
  });

  it("only talent can use codes, and attempts are rate limited", async () => {
    const p = await newCode();
    await expect(previewPromo(db, sales(), ids.course, p.code)).rejects.toBeInstanceOf(NotFoundError);
    for (let i = 0; i < 20; i++) await previewPromo(db, learner(2), ids.course, p.code);
    await expect(previewPromo(db, learner(2), ids.course, p.code)).rejects.toMatchObject({ name: "RateLimitedError" });
  });

  it("free courses take no codes", async () => {
    const p = await newCode();
    await expect(previewPromo(db, learner(2), ids.freeCourse, p.code)).rejects.toThrow(PROMO_REFUSAL_MESSAGE);
  });
});

describe("enrolling with a code", () => {
  it("re-prices the enrolment, keeps the list price, reserves a use, and tells the world the discounted amount", async () => {
    const p = await newCode({ percent: "20" });
    await enrol(db, learner(2), ids.course, p.code);
    const e = await enrolment(2);
    expect([e.priceCents, e.listPriceCents, e.paymentStatus, e.credentialSource]).toEqual([80_000, 100_000, "PENDING", "INDEPENDENT_PURCHASE"]);
    expect(await live(e.id)).toMatchObject({ status: "RESERVED", listPriceMinor: 100_000, discountMinor: 20_000, finalMinor: 80_000, userId: learners[2].userId });
    expect(await db.auditLog.count({ where: { action: "PROMO_REDEEMED" } })).toBeGreaterThan(0);
    const enrolled = await db.auditLog.findFirstOrThrow({ where: { action: "COURSE_ENROLLED", entityId: e.id } });
    expect(JSON.stringify(enrolled.newValue)).toContain("80000");
    const view = (await getEnrollmentForAgent(db, learner(2), ids.course)).enrollment!;
    expect(view).toMatchObject({ priceLabel: expect.stringContaining("800.00"), listPriceLabel: "PHP 1000.00", promo: { code: p.code, status: "RESERVED" } });
  });

  it("an invalid code enrols nobody", async () => {
    await expect(enrol(db, learner(3), ids.course, "BOGUS-CODE")).rejects.toThrow(PROMO_REFUSAL_MESSAGE);
    expect(await db.courseEnrollment.count({ where: { agentProfileId: learners[3].profileId } })).toBe(0);
    await enrol(db, learner(3), ids.course); // the same learner can still enrol without it
    expect((await enrolment(3)).priceCents).toBe(100_000);
  });

  it("a 100% code unlocks the course at once: no payment, no checkout, no commission, a consumed use", async () => {
    const p = await newCode({ percent: "100" });
    await enrol(db, learner(1), ids.course2, p.code); // learner 1 was referred
    const e = await enrolment(1, ids.course2);
    expect([e.priceCents, e.listPriceCents, e.paymentStatus, e.credentialSource]).toEqual([0, 50_000, "NOT_REQUIRED", "HIREWISE_DIRECT"]);
    expect(await live(e.id)).toMatchObject({ status: "CONSUMED", finalMinor: 0 });
    await expect(startMayaCheckout(db, learner(1), e.id)).rejects.toThrow();
    expect(await db.commission.count({ where: { sourceId: e.id } })).toBe(0);
  });
});

describe("paying a discounted enrolment", () => {
  it("Maya is asked for the discounted amount, confirms it, consumes the use, and the referral commission is on what was paid", async () => {
    const p = await newCode({ percent: "20" });
    await enrol(db, learner(1), ids.course, p.code); // learner 1 was referred by the referrer
    const e = await enrolment(1);
    const { url } = await startMayaCheckout(db, learner(1), e.id);
    const rrn = url.split("/").pop()!;
    expect((await db.onlinePayment.findUniqueOrThrow({ where: { id: rrn } })).amountMinor).toBe(80_000);
    fake.setStatus(rrn, "PAYMENT_SUCCESS");
    expect(await reconcileOnlinePayment(db, rrn)).toEqual({ status: "PAID" });
    const paid = await enrolment(1);
    expect([paid.paymentStatus, paid.paidCents]).toEqual(["PAID", 80_000]);
    expect((await live(e.id))!.status).toBe("CONSUMED");
    const c = await db.commission.findFirstOrThrow({ where: { sourceId: e.id } });
    expect(c).toMatchObject({ saleAmount: 80_000, commissionAmount: 12_000, currency: "PHP" }); // 15% of 800.00
  });

  it("staff recording an offline payment must cover the discounted amount, and that settles the use", async () => {
    const p = await newCode({ percent: "20" });
    await enrol(db, learner(4), ids.course, p.code);
    const e = await enrolment(4);
    await expect(recordCoursePayment(db, sales(), e.id, { paid: "799.99", reference: "G1", waived: false })).rejects.toThrow(/cover the course price \(800.00 PHP\)/);
    await recordCoursePayment(db, sales(), e.id, { paid: "800.00", reference: "G2", waived: false });
    expect((await live(e.id))!.status).toBe("CONSUMED");
  });

  it("a waived payment also settles the use, and a refund never gives it back", async () => {
    const p = await newCode({ percent: "10" });
    await enrol(db, learner(5), ids.course, p.code);
    const e = await enrolment(5);
    await recordCoursePayment(db, sales(), e.id, { waived: true, reason: "Partner" });
    expect((await live(e.id))!.status).toBe("CONSUMED");
    const q = await newCode({ percent: "10" });
    await enrol(db, learner(6), ids.course, q.code);
    const e2 = await enrolment(6);
    await recordCoursePayment(db, sales(), e2.id, { paid: "900.00", reference: "G3", waived: false });
    await recordCourseRefund(db, admin(), e2.id, { kind: "REFUND", reason: "Changed their mind" });
    expect((await live(e2.id))!.status).toBe("CONSUMED");
  });
});

describe("changing the code on an unpaid enrolment", () => {
  it("add, replace, and remove; the price follows and the old reservation is released", async () => {
    await enrol(db, learner(7), ids.course);
    const e = await enrolment(7);
    const a = await newCode({ percent: "10" });
    const b = await newCode({ percent: "30" });
    await applyPromoToEnrollment(db, learner(7), e.id, a.code);
    expect((await enrolment(7)).priceCents).toBe(90_000);
    await applyPromoToEnrollment(db, learner(7), e.id, b.code);
    const after = await enrolment(7);
    expect([after.priceCents, after.listPriceCents]).toEqual([70_000, 100_000]); // from the list price, never stacked
    expect(await db.promoRedemption.count({ where: { enrollmentId: e.id, status: "RELEASED", promoCodeId: a.id } })).toBe(1);
    await removePromoFromEnrollment(db, learner(7), e.id);
    const removed = await enrolment(7);
    expect([removed.priceCents, removed.listPriceCents]).toEqual([100_000, null]);
    expect(await live(e.id)).toBeNull();
    await expect(removePromoFromEnrollment(db, learner(7), e.id)).rejects.toThrow(/no code to remove/);
    expect(await db.auditLog.count({ where: { action: "PROMO_RELEASED", reason: "Removed by the learner" } })).toBe(1);
  });

  it("another learner, or any other role, cannot touch the enrolment", async () => {
    const e = await enrolment(7);
    const p = await newCode();
    await expect(applyPromoToEnrollment(db, learner(2), e.id, p.code)).rejects.toBeInstanceOf(NotFoundError);
    await expect(removePromoFromEnrollment(db, learner(2), e.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(applyPromoToEnrollment(db, admin(), e.id, p.code)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cannot change a code once the enrolment is paid", async () => {
    const e = await enrolment(4); // paid above
    const p = await newCode();
    await expect(applyPromoToEnrollment(db, learner(4), e.id, p.code)).rejects.toThrow(/pending/);
  });

  it("an open Maya attempt is cancelled when the price changes, and if it is paid anyway it is flagged, not settled", async () => {
    await enrol(db, learner(9), ids.course2);
    const e = await enrolment(9, ids.course2);
    const { url } = await startMayaCheckout(db, learner(9), e.id);
    const rrn = url.split("/").pop()!;
    const p = await newCode({ percent: "50" });
    await applyPromoToEnrollment(db, learner(9), e.id, p.code);
    expect((await db.onlinePayment.findUniqueOrThrow({ where: { id: rrn } })).status).toBe("CANCELLED");
    fake.setStatus(rrn, "PAYMENT_SUCCESS"); // the old checkout was paid at the full 500.00
    expect(await reconcileOnlinePayment(db, rrn)).toEqual({ status: "MISMATCH" });
    expect((await enrolment(9, ids.course2)).paymentStatus).toBe("PENDING");
    await drain();
    expect(await db.auditLog.count({ where: { action: "ONLINE_PAYMENT_PROBLEM", entityId: rrn } })).toBe(1);
    // A fresh checkout is for the new amount.
    const again = await startMayaCheckout(db, learner(9), e.id);
    expect((await db.onlinePayment.findUniqueOrThrow({ where: { id: again.url.split("/").pop()! } })).amountMinor).toBe(25_000);
  });
});

describe("limits", () => {
  it("the total cap holds, and a removed reservation gives the use back", async () => {
    const p = await newCode({ maxRedemptions: "1" });
    const course = await freshCourse();
    await enrol(db, learner(2), course, p.code);
    await expect(enrol(db, learner(3), course, p.code)).rejects.toThrow(PROMO_REFUSAL_MESSAGE);
    await removePromoFromEnrollment(db, learner(2), (await enrolment(2, course)).id);
    await enrol(db, learner(3), course, p.code);
    expect((await listPromos(db, admin())).find((x) => x.id === p.id)).toMatchObject({ reserved: 1, consumed: 0, remaining: 0, effective: "FULLY_USED" });
  });

  it("two learners racing for the last use: exactly one gets it", async () => {
    const p = await newCode({ maxRedemptions: "1" });
    const course = await freshCourse();
    const results = await Promise.allSettled([enrol(db, learner(2), course, p.code), enrol(db, learner(3), course, p.code), enrol(db, learner(4), course, p.code)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.promoRedemption.count({ where: { promoCodeId: p.id, status: { in: ["RESERVED", "CONSUMED"] } } })).toBe(1);
    expect(await db.courseEnrollment.count({ where: { courseId: course } })).toBe(1); // the refused learners were not enrolled
  });

  it("the per-learner limit holds across courses, and can be raised", async () => {
    const q = await newCode({ perLearnerLimit: "1" });
    const c1 = await freshCourse();
    const c2 = await freshCourse();
    await enrol(db, learner(2), c1, q.code);
    await expect(previewPromo(db, learner(2), c2, q.code)).rejects.toThrow(PROMO_REFUSAL_MESSAGE);
    await expect(enrol(db, learner(2), c2, q.code)).rejects.toThrow(PROMO_REFUSAL_MESSAGE);
    expect((await previewPromo(db, learner(3), c2, q.code)).finalMinor).toBe(80_000); // another learner is unaffected
    const two = await newCode({ perLearnerLimit: "2" });
    await enrol(db, learner(5), c1, two.code);
    await enrol(db, learner(5), c2, two.code);
    expect(await db.promoRedemption.count({ where: { promoCodeId: two.id, userId: learners[5].userId } })).toBe(2);
  });
});

describe("reservations that are never paid", () => {
  it("are given back after the configured days; paid and recent ones are left alone", async () => {
    const stale = await newCode({ percent: "10" });
    const fresh = await newCode({ percent: "10" });
    const paidCode = await newCode({ percent: "10" });
    const [cStale, cFresh, cPaid] = [await freshCourse(), await freshCourse(), await freshCourse()];
    await enrol(db, learner(2), cStale, stale.code);
    await enrol(db, learner(3), cFresh, fresh.code);
    await enrol(db, learner(4), cPaid, paidCode.code);
    const paidEnrol = await enrolment(4, cPaid);
    await recordCoursePayment(db, sales(), paidEnrol.id, { paid: "900.00", reference: "P1", waived: false });
    const ancient = new Date(Date.now() - 8 * 86_400_000);
    const staleEnrol = await enrolment(2, cStale);
    await db.promoRedemption.updateMany({ where: { enrollmentId: { in: [staleEnrol.id, paidEnrol.id] } }, data: { createdAt: ancient } });

    expect(await releaseStaleReservations(db)).toBe(1);
    const back = await enrolment(2, cStale);
    expect([back.priceCents, back.listPriceCents]).toEqual([100_000, null]);
    expect(await db.promoRedemption.findFirstOrThrow({ where: { enrollmentId: staleEnrol.id } })).toMatchObject({ status: "RELEASED", releaseReason: "Unpaid after 7 days" });
    expect((await enrolment(3, cFresh)).priceCents).toBe(90_000); // recent: untouched
    expect((await live(paidEnrol.id))!.status).toBe("CONSUMED"); // paid: never given back
    expect(await releaseStaleReservations(db)).toBe(0); // idempotent
  });

  it("the number of days is a setting", async () => {
    await setSetting(db, superAdmin(), "promos", { reservationDays: 1 });
    const p = await newCode({ percent: "10" });
    const course = await freshCourse();
    await enrol(db, learner(5), course, p.code);
    const e = await enrolment(5, course);
    await db.promoRedemption.updateMany({ where: { enrollmentId: e.id }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    expect(await releaseStaleReservations(db)).toBe(1);
  });
});

describe("database guards", () => {
  it("allows one live redemption per enrolment and keeps the arithmetic honest", async () => {
    const p = await newCode();
    const course = await freshCourse();
    await enrol(db, learner(6), course, p.code);
    const e = await enrolment(6, course);
    const row = { promoCodeId: p.id, enrollmentId: e.id, userId: learners[6].userId, currency: "PHP" };
    await expect(db.promoRedemption.create({ data: { ...row, listPriceMinor: 100, discountMinor: 10, finalMinor: 90 } })).rejects.toThrow(); // second live row
    await expect(db.promoRedemption.create({ data: { ...row, listPriceMinor: 100, discountMinor: 10, finalMinor: 80, status: "RELEASED" } })).rejects.toThrow(); // does not add up
    await db.promoRedemption.create({ data: { ...row, listPriceMinor: 100, discountMinor: 10, finalMinor: 90, status: "RELEASED" } }); // history rows are fine
  });
});
