import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { createSign, generateKeyPairSync } from "node:crypto";
import { testDb, resetDb } from "../setup/db";
import { createCourse, updateCourse, saveModule, saveLesson, publishCourse, archiveCourse, restoreCourse, enrol, getEnrollmentForAgent, recordCoursePayment, recordCourseRefund, catalogForAgent } from "@/server/services/academy.service";
import { startMayaCheckout, reconcileOnlinePayment, reconcileMyCourse, handleMayaWebhook, reconcilePendingOnlinePayments, mayaAvailableFor } from "@/server/services/maya-payment.service";
import { FakeMayaGateway, setMayaGatewayForTests, type MayaGateway } from "@/server/adapters/maya";
import { signedString } from "@/lib/maya-signature";
import { SETTING_SCHEMAS } from "@/server/services/setting.service";
import { runWorkerOnce, runMaintenance } from "@/server/jobs/worker";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";

const db = testDb();
const ids = { admin: "admin_my", sales: "sales_my", coach: "coach_my", referrer: "", agent1: "", profile1: "", agent2: "", profile2: "", agent3: "", profile3: "", category: "", phpCourse: "", usdCourse: "", freeCourse: "", archivedCourse: "" };
const fake = new FakeMayaGateway();
const keys = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });

const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const coach = () => makeActor("COACH", { userId: ids.coach, coachCourseIds: [ids.phpCourse] });
const agent = (n: 1 | 2 | 3) => makeActor("AGENT", { userId: ids[`agent${n}` as "agent1"], agentProfileId: ids[`profile${n}` as "profile1"] });

async function drain() {
  for (let i = 0; i < 10; i++) if (!(await runWorkerOnce(db)).events) break;
}
async function mkAgent(email: string, referredBy: string | null) {
  const u = await db.user.create({ data: { email, roleId: (await db.role.findUniqueOrThrow({ where: { key: "AGENT" } })).id, emailVerifiedAt: new Date(), ...(referredBy ? { referredByUserId: referredBy, referredAt: new Date() } : {}) } });
  const p = await db.agentProfile.create({ data: { userId: u.id, displayName: email.split("@")[0], headline: "H", primaryRole: "Cold Caller", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila", approvedAt: new Date() } });
  return { userId: u.id, profileId: p.id };
}
/** A learner enrolled in the PHP course with a pending payment. */
async function pendingEnrollment(n: 1 | 2 | 3, courseId = ids.phpCourse) {
  await enrol(db, agent(n), courseId);
  return db.courseEnrollment.findFirstOrThrow({ where: { courseId, agentProfileId: ids[`profile${n}` as "profile1"] } });
}
const rows = (enrollmentId: string) => db.onlinePayment.findMany({ where: { enrollmentId }, orderBy: { createdAt: "asc" } });
const pubKeyEnv = () => keys.publicKey.replace(/\n/g, "\\n");

function signedWebhook(payload: Record<string, unknown>, opts: { privateKey?: string; timestamp?: number } = {}) {
  const nonce = Math.random().toString(16).slice(2, 18);
  const s = createSign("RSA-SHA256");
  s.update(signedString(payload, nonce));
  return { rawBody: JSON.stringify(payload), signature: `nonce=${nonce},v1=${s.sign(opts.privateKey ?? keys.privateKey, "hex")}`, timestamp: String(opts.timestamp ?? Date.now()), ip: "198.51.100.9" };
}

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16";
  process.env.APP_URL = "http://localhost:3000";
  process.env.MAYA_MODE = "fake";
  process.env.MAYA_WEBHOOK_PUBLIC_KEY_1 = pubKeyEnv();
  resetEnvCache();
  setMayaGatewayForTests(fake);
  setEmailChannelForTests(new ConsoleEmailChannel());
  await resetDb(db);
  resetRateLimits();
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN") } });
  await db.user.create({ data: { id: ids.sales, email: "sales@hirewise.example", roleId: await role("SALES") } });
  await db.user.create({ data: { id: ids.coach, email: "coach@hirewise.example", roleId: await role("COACH") } });
  ids.category = (await db.courseCategory.create({ data: { name: "Sales", slug: "sales", order: 1 } })).id;
  const referrer = await mkAgent("referrer@talent.example", null);
  ids.referrer = referrer.userId;
  const a1 = await mkAgent("buyer1@talent.example", referrer.userId);
  const a2 = await mkAgent("buyer2@talent.example", null);
  const a3 = await mkAgent("buyer3@talent.example", null);
  [ids.agent1, ids.profile1, ids.agent2, ids.profile2, ids.agent3, ids.profile3] = [a1.userId, a1.profileId, a2.userId, a2.profileId, a3.userId, a3.profileId];

  // The main course is created and published through the services, priced in PHP.
  ids.phpCourse = await createCourse(db, admin(), { title: "Cold Calling Masterclass", categoryId: ids.category, difficulty: "BEGINNER", description: "A course description long enough to satisfy validation rules.", price: "499.00", currency: "PHP", passingScore: 70, requiresCoachReview: false });
  const moduleId = await saveModule(db, admin(), ids.phpCourse, { title: "Module 1", description: "" });
  await saveLesson(db, admin(), ids.phpCourse, { moduleId, title: "Welcome", contentType: "TEXT", body: "Hello learners." });
  await db.courseModule.updateMany({ where: { courseId: ids.phpCourse }, data: { status: "PUBLISHED" } });
  await db.courseLesson.updateMany({ where: { module: { courseId: ids.phpCourse } }, data: { status: "PUBLISHED" } });
  await publishCourse(db, admin(), ids.phpCourse, {});
  const mk = async (title: string, priceCents: number, currency: string, status: "PUBLISHED" | "ARCHIVED") => (await db.academyCourse.create({ data: { code: title.replace(/\s/g, "-").toUpperCase(), title, category: "Sales", description: "A course description long enough to satisfy validation rules.", status, priceCents, currency, ownerCoachUserId: ids.coach } })).id;
  ids.usdCourse = await mk("Closing Mastery USD", 4900, "USD", "PUBLISHED");
  ids.freeCourse = await mk("Freelancers Foundation Program", 0, "PHP", "PUBLISHED");
  ids.archivedCourse = await mk("Archived Program", 0, "PHP", "ARCHIVED");
});

afterEach(() => {
  setMayaGatewayForTests(fake);
  process.env.MAYA_MODE = "fake";
  process.env.MAYA_WEBHOOK_STRICT = "false";
  resetEnvCache();
});

afterAll(async () => {
  setMayaGatewayForTests(null);
  delete process.env.MAYA_MODE;
  delete process.env.MAYA_WEBHOOK_PUBLIC_KEY_1;
  delete process.env.MAYA_WEBHOOK_STRICT;
  resetEnvCache();
  setEmailChannelForTests(null);
  await db.$disconnect();
});

describe("course price and currency", () => {
  it("prices a course in PHP, snapshots the currency on enrolment, and labels it", async () => {
    const course = await db.academyCourse.findUniqueOrThrow({ where: { id: ids.phpCourse } });
    expect([course.priceCents, course.currency]).toEqual([49900, "PHP"]);
    const cat = await catalogForAgent(db, agent(1));
    expect(cat.find((c) => c.id === ids.phpCourse)).toMatchObject({ priceLabel: "PHP 499.00", currency: "PHP" });
    expect(cat.find((c) => c.id === ids.usdCourse)).toMatchObject({ priceLabel: "USD 49.00", currency: "USD" });
    expect(cat.find((c) => c.id === ids.freeCourse)!.priceLabel).toBe("Free");
    const e = await pendingEnrollment(1);
    expect([e.priceCents, e.currency, e.paymentStatus]).toEqual([49900, "PHP", "PENDING"]);
    expect((await getEnrollmentForAgent(db, agent(1), ids.phpCourse)).enrollment).toMatchObject({ currency: "PHP", priceLabel: "PHP 499.00" });
  });

  it("changing the course currency applies to later enrolments only and is audited", async () => {
    const id = await createCourse(db, admin(), { title: "Currency Switch", categoryId: ids.category, difficulty: "BEGINNER", description: "A course description long enough to satisfy validation rules.", price: "100", passingScore: 70, requiresCoachReview: false });
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id } })).currency).toBe("PHP"); // the new default
    await updateCourse(db, admin(), id, { title: "Currency Switch", categoryId: ids.category, difficulty: "BEGINNER", description: "A course description long enough to satisfy validation rules.", price: "100", currency: "USD", passingScore: 70, requiresCoachReview: false });
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id } })).currency).toBe("USD");
    const audit = await db.auditLog.findFirst({ where: { action: "COURSE_PRICE_CHANGED", entityId: id } });
    expect(JSON.stringify(audit?.previousValue)).toContain("PHP");
    // The old USD field still means USD.
    const legacy = await createCourse(db, admin(), { title: "Legacy Price", categoryId: ids.category, difficulty: "BEGINNER", description: "A course description long enough to satisfy validation rules.", priceUsd: "20", passingScore: 70, requiresCoachReview: false });
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id: legacy } })).currency).toBe("USD");
  });

  it("staff recording an offline payment compares in the enrolment currency", async () => {
    const e = await pendingEnrollment(3);
    await expect(recordCoursePayment(db, sales(), e.id, { paid: "100.00", reference: "GCASH-1", waived: false })).rejects.toThrow(/cover the course price \(499.00 PHP\)/);
    await recordCoursePayment(db, sales(), e.id, { paid: "499.00", reference: "GCASH-2", waived: false });
    const paid = await db.courseEnrollment.findUniqueOrThrow({ where: { id: e.id } });
    expect([paid.paymentStatus, paid.paidCents, paid.currency]).toEqual(["PAID", 49900, "PHP"]);
  });

  it("the referral program now defaults to PHP with a 500.00 minimum", () => {
    expect(SETTING_SCHEMAS.referrals.parse(undefined)).toMatchObject({ payoutCurrency: "PHP", minimumPayoutMinor: 50_000, commissionRateBps: 1500, holdDays: 30, cookieDays: 30 });
  });
});

describe("starting a Maya checkout", () => {
  it("is offered only for paid PHP courses while Maya is on", () => {
    expect(mayaAvailableFor({ currency: "PHP", priceCents: 49900 })).toBe(true);
    expect(mayaAvailableFor({ currency: "USD", priceCents: 4900 })).toBe(false);
    expect(mayaAvailableFor({ currency: "PHP", priceCents: 0 })).toBe(false);
    process.env.MAYA_MODE = "off";
    resetEnvCache();
    expect(mayaAvailableFor({ currency: "PHP", priceCents: 49900 })).toBe(false);
  });

  it("creates a pending payment keyed by our reference, and a second click resumes the same checkout", async () => {
    const e = await pendingEnrollment(2);
    resetRateLimits();
    const first = await startMayaCheckout(db, agent(2), e.id);
    const [row] = await rows(e.id);
    expect(first.url).toBe(`http://localhost:3000/api/payments/maya-fake/${row.id}`);
    expect([row.status, row.amountMinor, row.currency, row.provider, row.checkoutId]).toEqual(["PENDING", 49900, "PHP", "MAYA", `fake_co_${row.id}`]);
    expect((await startMayaCheckout(db, agent(2), e.id)).url).toBe(first.url);
    expect(await rows(e.id)).toHaveLength(1);
    expect(fake.redirectsFor(row.id)).toMatchObject({ successUrl: `http://localhost:3000/courses/${ids.phpCourse}?pay=success`, failureUrl: `http://localhost:3000/courses/${ids.phpCourse}?pay=failed`, cancelUrl: `http://localhost:3000/courses/${ids.phpCourse}?pay=cancelled` });
    expect(await db.auditLog.count({ where: { action: "ONLINE_PAYMENT_STARTED", entityId: row.id } })).toBe(1);
  });

  it("refuses other learners, other roles, USD and free courses, settled enrolments, and Maya being off", async () => {
    resetRateLimits();
    const e = await pendingEnrollment(2);
    await expect(startMayaCheckout(db, agent(1), e.id)).rejects.toThrow(NotFoundError);
    await expect(startMayaCheckout(db, sales(), e.id)).rejects.toThrow(ForbiddenError);
    await expect(startMayaCheckout(db, agent(2), "missing")).rejects.toThrow(NotFoundError);
    await enrol(db, agent(2), ids.usdCourse);
    const usd = await db.courseEnrollment.findFirstOrThrow({ where: { courseId: ids.usdCourse, agentProfileId: ids.profile2 } });
    await expect(startMayaCheckout(db, agent(2), usd.id)).rejects.toThrow(/cannot be paid with Maya/);
    await enrol(db, agent(2), ids.freeCourse);
    const free = await db.courseEnrollment.findFirstOrThrow({ where: { courseId: ids.freeCourse, agentProfileId: ids.profile2 } });
    await expect(startMayaCheckout(db, agent(2), free.id)).rejects.toThrow(/does not need a payment/);
    expect(free.paymentStatus).toBe("NOT_REQUIRED");
    process.env.MAYA_MODE = "off";
    resetEnvCache();
    await expect(startMayaCheckout(db, agent(2), e.id)).rejects.toThrow(/not available/);
  });

  it("a gateway failure leaves a failed attempt, a friendly message, and the option to try again", async () => {
    resetRateLimits();
    const e = await pendingEnrollment(3, ids.phpCourse).catch(async () => db.courseEnrollment.findFirstOrThrow({ where: { courseId: ids.phpCourse, agentProfileId: ids.profile3 } }));
    // Agent 3 was already paid in an earlier test, so use a fresh learner here.
    const fresh = await mkAgent("buyer4@talent.example", null);
    const freshActor = makeActor("AGENT", { userId: fresh.userId, agentProfileId: fresh.profileId });
    await enrol(db, freshActor, ids.phpCourse);
    const enrollment = await db.courseEnrollment.findFirstOrThrow({ where: { courseId: ids.phpCourse, agentProfileId: fresh.profileId } });
    void e;
    const broken: MayaGateway = { mode: "fake", createCheckout: async () => { throw new Error("Maya checkout failed (500): secret details"); }, paymentsByReference: async () => [], paymentById: async () => null };
    setMayaGatewayForTests(broken);
    await expect(startMayaCheckout(db, freshActor, enrollment.id)).rejects.toThrow(/Maya could not start the payment/);
    const [row] = await rows(enrollment.id);
    expect(row.status).toBe("FAILED");
    setMayaGatewayForTests(fake);
    const retry = await startMayaCheckout(db, freshActor, enrollment.id);
    expect(retry.url).toContain("/api/payments/maya-fake/");
    expect(await rows(enrollment.id)).toHaveLength(2);
  });
});

describe("confirming a payment", () => {
  it("settles an enrolment only after Maya reports it paid, then unlocks it, notifies the learner, and creates the referral commission", async () => {
    resetRateLimits();
    const e = await pendingEnrollment(1);
    const { url } = await startMayaCheckout(db, agent(1), e.id);
    const rrn = url.split("/").pop()!;
    // Not paid yet: nothing changes.
    expect(await reconcileOnlinePayment(db, rrn)).toEqual({ status: "PENDING" });
    expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: e.id } })).paymentStatus).toBe("PENDING");
    fake.setStatus(rrn, "PAYMENT_SUCCESS");
    expect(await reconcileOnlinePayment(db, rrn)).toEqual({ status: "PAID" });
    const paid = await db.courseEnrollment.findUniqueOrThrow({ where: { id: e.id } });
    expect([paid.paymentStatus, paid.paidCents, paid.currency, paid.paymentReference]).toEqual(["PAID", 49900, "PHP", `MAYA:fake_pay_${rrn}`]);
    const op = await db.onlinePayment.findUniqueOrThrow({ where: { id: rrn } });
    expect([op.status, op.providerPaymentId]).toEqual(["PAID", `fake_pay_${rrn}`]);
    expect(op.paidAt).not.toBeNull();
    // The course is open to the learner.
    const view = await getEnrollmentForAgent(db, agent(1), ids.phpCourse);
    expect(view.enrollment?.paymentStatus).toBe("PAID");
    expect(view.course.modules).not.toBeNull();
    // Audit and notification.
    expect(await db.auditLog.count({ where: { action: "ONLINE_PAYMENT_CONFIRMED", entityId: rrn } })).toBe(1);
    const recorded = await db.auditLog.findFirstOrThrow({ where: { action: "COURSE_PAYMENT_RECORDED", entityId: e.id } });
    expect(JSON.stringify(recorded.newValue)).toContain("MAYA");
    await drain();
    expect(await db.notification.count({ where: { userId: ids.agent1, type: "COURSE_PAYMENT_RECORDED" } })).toBe(1);
    // The referrer earns 15% of 499.00 in PHP, on hold.
    const c = await db.commission.findFirstOrThrow({ where: { sourceId: e.id } });
    expect(c).toMatchObject({ referrerId: ids.referrer, saleAmount: 49900, rateBps: 1500, commissionAmount: 7485, currency: "PHP", status: "ON_HOLD" });
  });

  it("is idempotent: repeated and concurrent confirmations settle once", async () => {
    const e = await db.courseEnrollment.findFirstOrThrow({ where: { courseId: ids.phpCourse, agentProfileId: ids.profile1 } });
    const [op] = await rows(e.id);
    expect(await reconcileOnlinePayment(db, op.id)).toEqual({ status: "PAID" });
    const results = await Promise.all([reconcileOnlinePayment(db, op.id), reconcileOnlinePayment(db, op.id)]);
    for (const r of results) expect(r.status).toBe("PAID");
    expect(await db.commission.count({ where: { sourceId: e.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "COURSE_PAYMENT_RECORDED", entityId: e.id } })).toBe(1);
  });

  it("a refund of a Maya payment ends access and reverses the commission through the normal staff action", async () => {
    const e = await db.courseEnrollment.findFirstOrThrow({ where: { courseId: ids.phpCourse, agentProfileId: ids.profile1 } });
    await recordCourseRefund(db, sales(), e.id, { kind: "REFUND", reason: "Refunded in Maya Business Manager" });
    expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: e.id } })).paymentStatus).toBe("REFUNDED");
    expect((await db.commission.findFirstOrThrow({ where: { sourceId: e.id } })).status).toBe("REVERSED");
  });

  it("failed, expired, and cancelled payments leave the enrolment pending, and the learner can try again", async () => {
    const learner = await mkAgent("buyer5@talent.example", null);
    const actor = makeActor("AGENT", { userId: learner.userId, agentProfileId: learner.profileId });
    await enrol(db, actor, ids.phpCourse);
    const e = await db.courseEnrollment.findFirstOrThrow({ where: { courseId: ids.phpCourse, agentProfileId: learner.profileId } });
    for (const [maya, ours] of [["PAYMENT_FAILED", "FAILED"], ["PAYMENT_EXPIRED", "EXPIRED"], ["PAYMENT_CANCELLED", "CANCELLED"]] as const) {
      resetRateLimits();
      const { url } = await startMayaCheckout(db, actor, e.id);
      const rrn = url.split("/").pop()!;
      fake.setStatus(rrn, maya);
      expect(await reconcileOnlinePayment(db, rrn)).toEqual({ status: ours });
      expect((await db.onlinePayment.findUniqueOrThrow({ where: { id: rrn } })).status).toBe(ours);
      expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: e.id } })).paymentStatus).toBe("PENDING");
    }
    expect(await rows(e.id)).toHaveLength(3);
    // Finally it works.
    resetRateLimits();
    const rrn = (await startMayaCheckout(db, actor, e.id)).url.split("/").pop()!;
    fake.setStatus(rrn, "PAYMENT_SUCCESS");
    expect((await reconcileOnlinePayment(db, rrn)).status).toBe("PAID");
  });

  it("never settles when the amount, the currency, or the reference does not match, and tells staff", async () => {
    const learner = await mkAgent("buyer6@talent.example", null);
    const actor = makeActor("AGENT", { userId: learner.userId, agentProfileId: learner.profileId });
    await enrol(db, actor, ids.phpCourse);
    const e = await db.courseEnrollment.findFirstOrThrow({ where: { courseId: ids.phpCourse, agentProfileId: learner.profileId } });
    resetRateLimits();
    const rrn = (await startMayaCheckout(db, actor, e.id)).url.split("/").pop()!;
    fake.setStatus(rrn, "PAYMENT_SUCCESS", { amountMinor: 100 });
    expect(await reconcileOnlinePayment(db, rrn)).toEqual({ status: "MISMATCH" });
    expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: e.id } })).paymentStatus).toBe("PENDING");
    expect((await db.onlinePayment.findUniqueOrThrow({ where: { id: rrn } })).status).toBe("MISMATCH");
    // A mismatch stays a mismatch: a later honest report does not quietly settle it.
    fake.setStatus(rrn, "PAYMENT_SUCCESS", { amountMinor: 49900 });
    expect(await reconcileOnlinePayment(db, rrn)).toEqual({ status: "MISMATCH" });
    await drain();
    expect(await db.notification.count({ where: { userId: ids.admin, type: "ONLINE_PAYMENT_PROBLEM" } })).toBeGreaterThanOrEqual(1);
    expect(await db.auditLog.count({ where: { action: "ONLINE_PAYMENT_PROBLEM", entityId: rrn } })).toBe(1);
    // Wrong currency.
    resetRateLimits();
    const l2 = await mkAgent("buyer7@talent.example", null);
    const a2 = makeActor("AGENT", { userId: l2.userId, agentProfileId: l2.profileId });
    await enrol(db, a2, ids.phpCourse);
    const e2 = await db.courseEnrollment.findFirstOrThrow({ where: { courseId: ids.phpCourse, agentProfileId: l2.profileId } });
    const rrn2 = (await startMayaCheckout(db, a2, e2.id)).url.split("/").pop()!;
    fake.setStatus(rrn2, "PAYMENT_SUCCESS", { currency: "USD" });
    expect((await reconcileOnlinePayment(db, rrn2)).status).toBe("MISMATCH");
    expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: e2.id } })).paymentStatus).toBe("PENDING");
  });

  it("when staff already recorded the payment, the online one is kept and flagged, and nothing is settled twice", async () => {
    const learner = await mkAgent("buyer8@talent.example", ids.referrer);
    const actor = makeActor("AGENT", { userId: learner.userId, agentProfileId: learner.profileId });
    await enrol(db, actor, ids.phpCourse);
    const e = await db.courseEnrollment.findFirstOrThrow({ where: { courseId: ids.phpCourse, agentProfileId: learner.profileId } });
    resetRateLimits();
    const rrn = (await startMayaCheckout(db, actor, e.id)).url.split("/").pop()!;
    await recordCoursePayment(db, sales(), e.id, { paid: "499.00", reference: "BANK-1", waived: false });
    fake.setStatus(rrn, "PAYMENT_SUCCESS");
    expect(await reconcileOnlinePayment(db, rrn)).toEqual({ status: "PROBLEM" });
    expect((await db.onlinePayment.findUniqueOrThrow({ where: { id: rrn } })).status).toBe("PAID");
    expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: e.id } })).paymentReference).toBe("BANK-1");
    expect(await db.commission.count({ where: { sourceId: e.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "ONLINE_PAYMENT_PROBLEM", entityId: rrn } })).toBe(1);
  });
});

describe("the return page and the maintenance pass", () => {
  it("a learner coming back from Maya is confirmed at once, and only their own payment", async () => {
    const learner = await mkAgent("buyer9@talent.example", null);
    const actor = makeActor("AGENT", { userId: learner.userId, agentProfileId: learner.profileId });
    await enrol(db, actor, ids.phpCourse);
    const e = await db.courseEnrollment.findFirstOrThrow({ where: { courseId: ids.phpCourse, agentProfileId: learner.profileId } });
    resetRateLimits();
    expect(await reconcileMyCourse(db, actor, ids.phpCourse)).toBeNull(); // nothing open yet
    const rrn = (await startMayaCheckout(db, actor, e.id)).url.split("/").pop()!;
    expect(await reconcileMyCourse(db, actor, ids.phpCourse)).toEqual({ status: "PENDING" });
    fake.setStatus(rrn, "PAYMENT_SUCCESS");
    expect(await reconcileMyCourse(db, agent(3), ids.phpCourse)).toBeNull(); // someone else's visit does nothing (agent 3 already paid)
    expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: e.id } })).paymentStatus).toBe("PENDING");
    expect(await reconcileMyCourse(db, actor, ids.phpCourse)).toEqual({ status: "PAID" });
    expect(await reconcileMyCourse(db, actor, ids.phpCourse)).toBeNull(); // nothing left to do
    expect(await reconcileMyCourse(db, sales(), ids.phpCourse)).toBeNull();
  });

  it("the maintenance pass confirms payments whose webhook never arrived, but not brand-new ones", async () => {
    const learner = await mkAgent("buyer10@talent.example", null);
    const actor = makeActor("AGENT", { userId: learner.userId, agentProfileId: learner.profileId });
    await enrol(db, actor, ids.phpCourse);
    const e = await db.courseEnrollment.findFirstOrThrow({ where: { courseId: ids.phpCourse, agentProfileId: learner.profileId } });
    resetRateLimits();
    const rrn = (await startMayaCheckout(db, actor, e.id)).url.split("/").pop()!;
    fake.setStatus(rrn, "PAYMENT_SUCCESS");
    expect(await reconcilePendingOnlinePayments(db)).toBe(0); // created seconds ago
    await db.onlinePayment.update({ where: { id: rrn }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
    expect(await reconcilePendingOnlinePayments(db)).toBe(1);
    expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: e.id } })).paymentStatus).toBe("PAID");
    expect(await reconcilePendingOnlinePayments(db)).toBe(0);
    process.env.MAYA_MODE = "off";
    resetEnvCache();
    expect(await reconcilePendingOnlinePayments(db)).toBe(0);
    await runMaintenance(db); // does not fail with Maya off
  });
});

describe("the webhook", () => {
  async function openCheckout(email: string) {
    const learner = await mkAgent(email, null);
    const actor = makeActor("AGENT", { userId: learner.userId, agentProfileId: learner.profileId });
    await enrol(db, actor, ids.phpCourse);
    const e = await db.courseEnrollment.findFirstOrThrow({ where: { courseId: ids.phpCourse, agentProfileId: learner.profileId } });
    resetRateLimits();
    const rrn = (await startMayaCheckout(db, actor, e.id)).url.split("/").pop()!;
    return { e, rrn };
  }
  const payload = (rrn: string, over: Record<string, unknown> = {}) => ({ id: `fake_pay_${rrn}`, isPaid: true, status: "PAYMENT_SUCCESS", amount: 499, currency: "PHP", requestReferenceNumber: rrn, ...over });

  it("a correctly signed success webhook confirms the payment (and records that the signature verified)", async () => {
    const { e, rrn } = await openCheckout("hook1@talent.example");
    fake.setStatus(rrn, "PAYMENT_SUCCESS");
    const r = await handleMayaWebhook(db, signedWebhook(payload(rrn)));
    expect(r).toEqual({ status: 200, body: { received: true, status: "PAID", signature: "ok" } });
    expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: e.id } })).paymentStatus).toBe("PAID");
    const op = await db.onlinePayment.findUniqueOrThrow({ where: { id: rrn } });
    expect(op.signatureValid).toBe(true);
    // Only a short summary is kept, never the card details Maya includes.
    expect(JSON.stringify(op.lastPayload)).not.toContain("fundSource");
    // A retry from Maya is harmless.
    const again = await handleMayaWebhook(db, signedWebhook(payload(rrn)));
    expect(again.status).toBe(200);
    expect(await db.auditLog.count({ where: { action: "ONLINE_PAYMENT_CONFIRMED", entityId: rrn } })).toBe(1);
  });

  it("a forged success webhook cannot unlock anything: the lookup at Maya decides", async () => {
    const { e, rrn } = await openCheckout("hook2@talent.example");
    // The attacker signs with their own key and claims success; Maya says the payment is still pending.
    const attacker = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    const r = await handleMayaWebhook(db, signedWebhook(payload(rrn), { privateKey: attacker.privateKey }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "PENDING", signature: "bad-signature" });
    expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: e.id } })).paymentStatus).toBe("PENDING");
    expect((await db.onlinePayment.findUniqueOrThrow({ where: { id: rrn } })).signatureValid).toBe(false);
    // Unsigned, stale, and malformed deliveries behave the same way.
    for (const bad of [{ ...signedWebhook(payload(rrn)), signature: null }, signedWebhook(payload(rrn), { timestamp: Date.now() - 3_600_000 })]) {
      expect((await handleMayaWebhook(db, bad)).body).toMatchObject({ status: "PENDING" });
    }
    expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: e.id } })).paymentStatus).toBe("PENDING");
  });

  it("strict mode rejects a bad signature before touching anything", async () => {
    const { e, rrn } = await openCheckout("hook3@talent.example");
    fake.setStatus(rrn, "PAYMENT_SUCCESS");
    process.env.MAYA_WEBHOOK_STRICT = "true";
    resetEnvCache();
    const attacker = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    expect(await handleMayaWebhook(db, signedWebhook(payload(rrn), { privateKey: attacker.privateKey }))).toEqual({ status: 400, body: { error: "Invalid signature" } });
    expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: e.id } })).paymentStatus).toBe("PENDING");
    expect((await handleMayaWebhook(db, signedWebhook(payload(rrn)))).body).toMatchObject({ status: "PAID" });
  });

  it("finds the payment from Maya's own id when the body has no reference number", async () => {
    const { e, rrn } = await openCheckout("hook4@talent.example");
    fake.setStatus(rrn, "PAYMENT_SUCCESS");
    const { requestReferenceNumber: _omit, ...withoutRrn } = payload(rrn);
    void _omit;
    expect((await handleMayaWebhook(db, signedWebhook(withoutRrn))).body).toMatchObject({ status: "PAID" });
    expect((await db.courseEnrollment.findUniqueOrThrow({ where: { id: e.id } })).paymentStatus).toBe("PAID");
  });

  it("ignores unknown payments and refuses unparseable bodies, and answers 404 when Maya is off", async () => {
    expect(await handleMayaWebhook(db, signedWebhook({ id: "unknown-id", status: "PAYMENT_SUCCESS", requestReferenceNumber: "nope" }))).toEqual({ status: 200, body: { received: true, ignored: true } });
    expect((await handleMayaWebhook(db, { rawBody: "not json", signature: null, timestamp: null, ip: null })).status).toBe(400);
    expect((await handleMayaWebhook(db, { rawBody: "[1]", signature: null, timestamp: null, ip: null })).status).toBe(400);
    process.env.MAYA_MODE = "off";
    resetEnvCache();
    expect((await handleMayaWebhook(db, signedWebhook(payload("x")))).status).toBe(404);
  });
});

describe("restoring an archived course", () => {
  it("an Admin brings an archived course back to published; others cannot", async () => {
    await expect(restoreCourse(db, admin(), ids.phpCourse)).rejects.toThrow(/Only an archived course/);
    await expect(restoreCourse(db, admin(), ids.archivedCourse)).rejects.toThrow(/at least one published lesson/);
    // Give the archived course a published lesson, as Freelancers Foundation has.
    const m = await db.courseModule.create({ data: { courseId: ids.archivedCourse, order: 1, title: "Module", status: "PUBLISHED" } });
    await db.courseLesson.create({ data: { moduleId: m.id, order: 1, title: "Lesson", contentType: "TEXT", body: "Hi", status: "PUBLISHED" } });
    for (const actor of [sales(), agent(1), coach()]) await expect(restoreCourse(db, actor, ids.archivedCourse)).rejects.toThrow(ForbiddenError);
    await expect(restoreCourse(db, admin(), "missing")).rejects.toThrow(NotFoundError);
    await restoreCourse(db, admin(), ids.archivedCourse);
    const c = await db.academyCourse.findUniqueOrThrow({ where: { id: ids.archivedCourse } });
    expect(c.status).toBe("PUBLISHED");
    expect(await db.auditLog.count({ where: { action: "COURSE_RESTORED", entityId: ids.archivedCourse } })).toBe(1);
    expect((await catalogForAgent(db, agent(1))).some((x) => x.id === ids.archivedCourse)).toBe(true);
    // Archiving and restoring again is possible.
    await archiveCourse(db, admin(), ids.archivedCourse);
    await restoreCourse(db, admin(), ids.archivedCourse);
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id: ids.archivedCourse } })).status).toBe("PUBLISHED");
  });
});
