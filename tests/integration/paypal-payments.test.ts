import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { recordCoursePayment } from "@/server/services/academy.service";
import { startPayPalCheckout, reconcilePayPalPayment, reconcileMyPayPalPayment, handlePayPalWebhook, reconcilePendingPayPalPayments, paypalAvailableFor } from "@/server/services/paypal-payment.service";
import { startMayaCheckout, reconcilePendingOnlinePayments } from "@/server/services/maya-payment.service";
import { FakePayPalGateway, setPayPalGatewayForTests, type PayPalWebhookHeaders } from "@/server/adapters/paypal";
import { FakeMayaGateway, setMayaGatewayForTests } from "@/server/adapters/maya";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { UserMessageError } from "@/server/policies/user-message-error";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { runWorkerOnce } from "@/server/jobs/worker";

const db = testDb();
const ids = { admin: "admin_pp", sales: "sales_pp", coach: "coach_pp", referrer: "", agent1: "", profile1: "", agent2: "", profile2: "", category: "" };
const fake = new FakePayPalGateway();
let seq = 0;

const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const agent = (n: 1 | 2) => makeActor("AGENT", { userId: ids[`agent${n}` as "agent1"], agentProfileId: ids[`profile${n}` as "profile1"] });

async function mkAgent(email: string, referredBy: string | null) {
  const u = await db.user.create({ data: { email, roleId: (await db.role.findUniqueOrThrow({ where: { key: "AGENT" } })).id, emailVerifiedAt: new Date(), ...(referredBy ? { referredByUserId: referredBy, referredAt: new Date() } : {}) } });
  const p = await db.agentProfile.create({ data: { userId: u.id, displayName: email.split("@")[0], headline: "H", primaryRole: "Cold Caller", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila", approvedAt: new Date() } });
  return { userId: u.id, profileId: p.id };
}

/** A fresh published course (so every test has its own enrolment), owned by the coach (earns a wallet share) or by an admin. */
async function course(o: { owner?: "coach" | "admin"; priceCents?: number; currency?: string } = {}) {
  seq++;
  const c = await db.academyCourse.create({
    data: { code: `PP-${seq}`, title: `PayPal Course ${seq}`, slug: `paypal-course-${seq}`, category: "Sales", categoryId: ids.category, description: "A course description long enough to satisfy validation rules.", status: "PUBLISHED", priceCents: o.priceCents ?? 49900, currency: o.currency ?? "PHP", ownerCoachUserId: o.owner === "admin" ? ids.admin : ids.coach },
  });
  return c.id;
}
async function pending(n: 1 | 2, courseId: string) {
  const c = await db.academyCourse.findUniqueOrThrow({ where: { id: courseId } });
  return db.courseEnrollment.create({ data: { courseId, agentProfileId: ids[`profile${n}` as "profile1"], priceCents: c.priceCents, currency: c.currency, paymentStatus: "PENDING" } });
}
const reference = (url: string) => decodeURIComponent(url.split("/").pop()!);
const enrolment = (id: string) => db.courseEnrollment.findUniqueOrThrow({ where: { id } });
const headers = (sig: string | null = "valid"): PayPalWebhookHeaders => ({ transmissionId: "t1", transmissionTime: new Date().toISOString(), transmissionSig: sig, certUrl: "https://api.paypal.com/cert", authAlgo: "SHA256withRSA" });
const hook = (event: Record<string, unknown>, sig: string | null = "valid") => handlePayPalWebhook(db, { rawBody: JSON.stringify(event), headers: headers(sig), ip: "198.51.100.9" });
const problems = (rowId: string) => db.auditLog.count({ where: { action: "ONLINE_PAYMENT_PROBLEM", entityId: rowId } });

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16";
  process.env.APP_URL = "http://localhost:3000";
  process.env.PAYPAL_MODE = "fake";
  resetEnvCache();
  setPayPalGatewayForTests(fake);
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
  [ids.agent1, ids.profile1, ids.agent2, ids.profile2] = [a1.userId, a1.profileId, a2.userId, a2.profileId];
});

afterEach(() => {
  setPayPalGatewayForTests(fake);
  fake.feeBps = 440;
  fake.omitFee = false;
  process.env.PAYPAL_MODE = "fake";
  process.env.PAYPAL_WEBHOOK_STRICT = "false";
  resetEnvCache();
  resetRateLimits();
});

afterAll(async () => {
  setPayPalGatewayForTests(null);
  delete process.env.PAYPAL_MODE;
  delete process.env.PAYPAL_WEBHOOK_STRICT;
  resetEnvCache();
  await db.$disconnect();
});

describe("which courses PayPal can take", () => {
  it("paid PHP and USD courses when PayPal is on, nothing else", () => {
    expect(paypalAvailableFor({ currency: "PHP", priceCents: 49900 })).toBe(true);
    expect(paypalAvailableFor({ currency: "USD", priceCents: 4900 })).toBe(true);
    expect(paypalAvailableFor({ currency: "EUR", priceCents: 4900 })).toBe(false);
    expect(paypalAvailableFor({ currency: "PHP", priceCents: 0 })).toBe(false);
    process.env.PAYPAL_MODE = "off";
    resetEnvCache();
    expect(paypalAvailableFor({ currency: "PHP", priceCents: 49900 })).toBe(false);
  });
});

describe("starting a checkout", () => {
  it("creates one PayPal order per pending enrolment and reuses it on a second press", async () => {
    const e = await pending(1, await course());
    const { url } = await startPayPalCheckout(db, agent(1), e.id);
    expect(url).toMatch(/\/api\/payments\/paypal-fake\//);
    const again = await startPayPalCheckout(db, agent(1), e.id);
    expect(again.url).toBe(url);
    const rows = await db.onlinePayment.findMany({ where: { enrollmentId: e.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "PAYPAL", status: "PENDING", amountMinor: 49900, currency: "PHP" });
    expect(rows[0].checkoutId).toBe(`fake_order_${rows[0].id}`);
    expect(await db.auditLog.count({ where: { action: "ONLINE_PAYMENT_STARTED", entityId: rows[0].id } })).toBe(1);
  });

  it("works for a USD course", async () => {
    const e = await pending(1, await course({ priceCents: 4900, currency: "USD" }));
    await startPayPalCheckout(db, agent(1), e.id);
    expect((await db.onlinePayment.findFirstOrThrow({ where: { enrollmentId: e.id } })).currency).toBe("USD");
  });

  it("only the learner who owns the enrolment can start it, and only talent", async () => {
    const e = await pending(1, await course());
    await expect(startPayPalCheckout(db, agent(2), e.id)).rejects.toThrow(NotFoundError);
    await expect(startPayPalCheckout(db, sales(), e.id)).rejects.toThrow(ForbiddenError);
    await expect(startPayPalCheckout(db, admin(), e.id)).rejects.toThrow(ForbiddenError);
    await expect(startPayPalCheckout(db, agent(1), "missing")).rejects.toThrow(NotFoundError);
  });

  it("refuses with a message the learner can read when PayPal is off, the enrolment is not pending, or the currency is not taken", async () => {
    const e = await pending(1, await course());
    process.env.PAYPAL_MODE = "off";
    resetEnvCache();
    await expect(startPayPalCheckout(db, agent(1), e.id)).rejects.toThrow(UserMessageError);
    process.env.PAYPAL_MODE = "fake";
    resetEnvCache();
    await db.courseEnrollment.update({ where: { id: e.id }, data: { paymentStatus: "PAID" } });
    await expect(startPayPalCheckout(db, agent(1), e.id)).rejects.toThrow(/does not need a payment/);
    const odd = await pending(2, await course({ currency: "EUR" }));
    await expect(startPayPalCheckout(db, agent(2), odd.id)).rejects.toThrow(/cannot be paid with PayPal/);
  });

  it("marks the attempt failed and tells the learner when PayPal cannot create the order", async () => {
    const e = await pending(1, await course());
    setPayPalGatewayForTests({ ...fake, mode: "fake", createOrder: async () => { throw new Error("boom"); }, getOrder: async () => null, captureOrder: async () => { throw new Error("no"); }, verifyWebhook: async () => false });
    await expect(startPayPalCheckout(db, agent(1), e.id)).rejects.toThrow(/PayPal could not start the payment/);
    expect((await db.onlinePayment.findFirstOrThrow({ where: { enrollmentId: e.id } })).status).toBe("FAILED");
  });
});

describe("confirming a payment", () => {
  it("captures an approved order, then settles the enrolment once: access, audit, referral commission", async () => {
    const e = await pending(1, await course({ owner: "admin" }));
    const ref = reference((await startPayPalCheckout(db, agent(1), e.id)).url);
    // Not approved yet: nothing changes.
    expect(await reconcilePayPalPayment(db, ref)).toEqual({ status: "PENDING" });
    expect((await enrolment(e.id)).paymentStatus).toBe("PENDING");
    fake.setState(ref, "APPROVED");
    expect(await reconcilePayPalPayment(db, ref)).toEqual({ status: "PAID" });
    const paid = await enrolment(e.id);
    expect([paid.paymentStatus, paid.paidCents, paid.currency, paid.paymentReference]).toEqual(["PAID", 49900, "PHP", `PAYPAL:fake_cap_${ref}`]);
    const op = await db.onlinePayment.findUniqueOrThrow({ where: { id: ref } });
    expect([op.status, op.providerPaymentId]).toEqual(["PAID", `fake_cap_${ref}`]);
    expect(await db.auditLog.count({ where: { action: "ONLINE_PAYMENT_CONFIRMED", entityId: ref } })).toBe(1);
    const recorded = await db.auditLog.findFirstOrThrow({ where: { action: "COURSE_PAYMENT_RECORDED", entityId: e.id } });
    expect(JSON.stringify(recorded.newValue)).toContain("PAYPAL");
    const c = await db.commission.findFirstOrThrow({ where: { sourceId: e.id } });
    expect(c).toMatchObject({ referrerId: ids.referrer, saleAmount: 49900, commissionAmount: 7485, currency: "PHP" });
  });

  it("is idempotent: repeated and concurrent confirmations settle once", async () => {
    const courseId = await course({ owner: "admin" });
    const e = await pending(1, courseId);
    const ref = reference((await startPayPalCheckout(db, agent(1), e.id)).url);
    fake.setState(ref, "APPROVED");
    const results = await Promise.all([reconcilePayPalPayment(db, ref), reconcilePayPalPayment(db, ref), reconcilePayPalPayment(db, ref)]);
    for (const r of results) expect(["PAID", "PENDING"]).toContain(r.status);
    expect(await reconcilePayPalPayment(db, ref)).toEqual({ status: "PAID" });
    expect(await db.commission.count({ where: { sourceId: e.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "ONLINE_PAYMENT_CONFIRMED", entityId: ref } })).toBe(1);
  });

  it("gives the coach a wallet earning with PayPal's real fee, not a pending one", async () => {
    const e = await pending(2, await course({ owner: "coach" }));
    const ref = reference((await startPayPalCheckout(db, agent(2), e.id)).url);
    fake.setState(ref, "APPROVED");
    await reconcilePayPalPayment(db, ref);
    const earning = await db.coachEarning.findUniqueOrThrow({ where: { enrollmentId: e.id } });
    // The fake charges 4.40%: 2195.6 rounded to 2196 centavos.
    expect(earning).toMatchObject({ channel: "PAYPAL", saleAmount: 49900, gatewayFee: 2196, feeSource: "GATEWAY_API" });
    expect(earning.status).not.toBe("PENDING_FEE");
    expect(earning.coachAmount).toBeGreaterThan(0);
  });

  it("waits for the real fee when PayPal does not report one", async () => {
    fake.omitFee = true;
    const e = await pending(1, await course({ owner: "coach" }));
    const ref = reference((await startPayPalCheckout(db, agent(1), e.id)).url);
    fake.setState(ref, "APPROVED");
    await reconcilePayPalPayment(db, ref);
    expect((await db.coachEarning.findUniqueOrThrow({ where: { enrollmentId: e.id } })).status).toBe("PENDING_FEE");
  });

  it("does not believe an amount, currency or reference that is not what was asked for", async () => {
    for (const [over, ref2] of [[{ amountMinor: 100 }, undefined], [{ currency: "USD" }, undefined], [{}, "someone-else"]] as const) {
      const e = await pending(1, await course({ owner: "admin" }));
      const ref = reference((await startPayPalCheckout(db, agent(1), e.id)).url);
      fake.setState(ref, "PAID", over);
      if (ref2) fake.records.get(ref)!.payment.reference = ref2;
      expect(await reconcilePayPalPayment(db, ref)).toEqual({ status: "MISMATCH" });
      expect((await enrolment(e.id)).paymentStatus).toBe("PENDING");
      expect((await db.onlinePayment.findUniqueOrThrow({ where: { id: ref } })).status).toBe("MISMATCH");
      expect(await problems(ref)).toBe(1);
      // A mismatch is final until staff handle it: asking again changes nothing and flags nothing new.
      expect(await reconcilePayPalPayment(db, ref)).toEqual({ status: "MISMATCH" });
      expect(await problems(ref)).toBe(1);
    }
  });

  it("a declined or voided order fails the attempt and the learner can try again", async () => {
    const e = await pending(1, await course({ owner: "admin" }));
    const ref = reference((await startPayPalCheckout(db, agent(1), e.id)).url);
    fake.setState(ref, "FAILED");
    expect(await reconcilePayPalPayment(db, ref)).toEqual({ status: "FAILED" });
    expect((await enrolment(e.id)).paymentStatus).toBe("PENDING");
    const retry = await startPayPalCheckout(db, agent(1), e.id);
    expect(reference(retry.url)).not.toBe(ref);
    expect(await db.onlinePayment.count({ where: { enrollmentId: e.id } })).toBe(2);
  });

  it("a capture PayPal is still reviewing does not unlock anything yet", async () => {
    const e = await pending(1, await course({ owner: "admin" }));
    const ref = reference((await startPayPalCheckout(db, agent(1), e.id)).url);
    fake.setState(ref, "PENDING");
    expect(await reconcilePayPalPayment(db, ref)).toEqual({ status: "PENDING" });
    expect((await enrolment(e.id)).paymentStatus).toBe("PENDING");
    fake.setState(ref, "PAID");
    expect(await reconcilePayPalPayment(db, ref)).toEqual({ status: "PAID" });
  });

  it("a payment refunded before it was confirmed gives no access and tells staff", async () => {
    const e = await pending(1, await course({ owner: "admin" }));
    const ref = reference((await startPayPalCheckout(db, agent(1), e.id)).url);
    fake.setState(ref, "REFUNDED");
    expect(await reconcilePayPalPayment(db, ref)).toEqual({ status: "FAILED" });
    expect((await enrolment(e.id)).paymentStatus).toBe("PENDING");
    expect(await problems(ref)).toBe(1);
  });

  it("money that arrives after staff already recorded the payment is flagged, and nothing is settled twice", async () => {
    const e = await pending(2, await course({ owner: "coach" }));
    const ref = reference((await startPayPalCheckout(db, agent(2), e.id)).url);
    await recordCoursePayment(db, sales(), e.id, { paid: "499.00", reference: "GCASH-9", waived: false });
    fake.setState(ref, "APPROVED");
    expect(await reconcilePayPalPayment(db, ref)).toEqual({ status: "PROBLEM" });
    expect((await enrolment(e.id)).paymentReference).toBe("GCASH-9");
    expect(await db.coachEarning.count({ where: { enrollmentId: e.id } })).toBe(1);
    expect(await problems(ref)).toBe(1);
  });

  it("an attempt that belongs to another provider is not touched", async () => {
    const e = await pending(1, await course({ owner: "admin" }));
    const row = await db.onlinePayment.create({ data: { provider: "MAYA", enrollmentId: e.id, amountMinor: 49900, currency: "PHP" } });
    expect(await reconcilePayPalPayment(db, row.id)).toEqual({ status: "NOT_FOUND" });
    expect(await reconcilePayPalPayment(db, "missing")).toEqual({ status: "NOT_FOUND" });
  });
});

describe("the learner coming back", () => {
  it("captures and unlocks the learner's own open payment, and does nothing for anyone else", async () => {
    const courseId = await course({ owner: "admin" });
    const e = await pending(1, courseId);
    const ref = reference((await startPayPalCheckout(db, agent(1), e.id)).url);
    fake.setState(ref, "APPROVED");
    expect(await reconcileMyPayPalPayment(db, agent(2), courseId)).toBeNull();
    expect(await reconcileMyPayPalPayment(db, sales(), courseId)).toBeNull();
    expect(await reconcileMyPayPalPayment(db, agent(1), courseId)).toEqual({ status: "PAID" });
    expect((await enrolment(e.id)).paymentStatus).toBe("PAID");
    expect(await reconcileMyPayPalPayment(db, agent(1), courseId)).toBeNull();
  });

  it("a lookup that fails leaves the learner waiting instead of erroring", async () => {
    const courseId = await course({ owner: "admin" });
    const e = await pending(1, courseId);
    await startPayPalCheckout(db, agent(1), e.id);
    setPayPalGatewayForTests({ ...fake, mode: "fake", createOrder: fake.createOrder.bind(fake), getOrder: async () => { throw new Error("network"); }, captureOrder: async () => { throw new Error("network"); }, verifyWebhook: async () => false });
    expect(await reconcileMyPayPalPayment(db, agent(1), courseId)).toEqual({ status: "PENDING" });
  });
});

describe("the webhook", () => {
  it("an order-approved event makes the server capture and settle, whatever the body claims", async () => {
    const e = await pending(1, await course({ owner: "admin" }));
    const ref = reference((await startPayPalCheckout(db, agent(1), e.id)).url);
    fake.setState(ref, "APPROVED");
    const r = await hook({ id: "WH-1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: `fake_order_${ref}`, status: "APPROVED", purchase_units: [{ custom_id: ref }] } });
    expect(r).toEqual({ status: 200, body: { received: true, status: "PAID" } });
    expect((await enrolment(e.id)).paymentStatus).toBe("PAID");
    const op = await db.onlinePayment.findUniqueOrThrow({ where: { id: ref } });
    expect(op.signatureValid).toBe(true);
    expect(JSON.stringify(op.lastPayload)).toContain("CHECKOUT.ORDER.APPROVED");
  });

  it("a body that claims a payment that PayPal does not show settles nothing", async () => {
    const e = await pending(1, await course({ owner: "admin" }));
    const ref = reference((await startPayPalCheckout(db, agent(1), e.id)).url);
    const r = await hook({ id: "WH-2", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "cap", status: "COMPLETED", custom_id: ref, amount: { value: "499.00", currency_code: "PHP" } } });
    expect(r.body).toMatchObject({ received: true, status: "PENDING" });
    expect((await enrolment(e.id)).paymentStatus).toBe("PENDING");
  });

  it("finds the payment by the order id when the event carries no reference", async () => {
    const e = await pending(1, await course({ owner: "admin" }));
    const ref = reference((await startPayPalCheckout(db, agent(1), e.id)).url);
    fake.setState(ref, "APPROVED");
    const r = await hook({ id: "WH-3", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "cap", supplementary_data: { related_ids: { order_id: `fake_order_${ref}` } } } });
    expect(r.body).toMatchObject({ status: "PAID" });
  });

  it("records a bad signature but still confirms by lookup; strict mode rejects it", async () => {
    const e = await pending(1, await course({ owner: "admin" }));
    const ref = reference((await startPayPalCheckout(db, agent(1), e.id)).url);
    fake.setState(ref, "APPROVED");
    process.env.PAYPAL_WEBHOOK_STRICT = "true";
    resetEnvCache();
    expect((await hook({ id: "WH-4", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: `fake_order_${ref}` } }, "forged")).status).toBe(400);
    expect((await enrolment(e.id)).paymentStatus).toBe("PENDING");
    process.env.PAYPAL_WEBHOOK_STRICT = "false";
    resetEnvCache();
    const r = await hook({ id: "WH-5", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: `fake_order_${ref}` } }, "forged");
    expect(r.body).toMatchObject({ status: "PAID" });
    expect((await db.onlinePayment.findUniqueOrThrow({ where: { id: ref } })).signatureValid).toBe(false);
  });

  it("ignores events for payments it does not know, rejects junk, and answers 404 when PayPal is off", async () => {
    expect(await hook({ id: "WH-6", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { custom_id: "nope" } })).toEqual({ status: 200, body: { received: true, ignored: true } });
    expect((await handlePayPalWebhook(db, { rawBody: "not json", headers: headers(), ip: null })).status).toBe(400);
    expect((await handlePayPalWebhook(db, { rawBody: "[1]", headers: headers(), ip: null })).status).toBe(400);
    process.env.PAYPAL_MODE = "off";
    resetEnvCache();
    expect((await hook({ id: "WH-7", event_type: "X" })).status).toBe(404);
  });

  it("a refund event for a settled payment flags staff once and changes nothing by itself", async () => {
    const e = await pending(1, await course({ owner: "coach" }));
    const ref = reference((await startPayPalCheckout(db, agent(1), e.id)).url);
    fake.setState(ref, "APPROVED");
    await reconcilePayPalPayment(db, ref);
    const event = { id: "WH-8", event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { id: "refund", custom_id: ref } };
    expect((await hook(event)).body).toMatchObject({ status: "REFUND_FLAGGED" });
    expect((await hook(event)).body).toMatchObject({ status: "REFUND_FLAGGED" });
    expect(await problems(ref)).toBe(1);
    expect((await enrolment(e.id)).paymentStatus).toBe("PAID");
    expect(await db.coachEarning.count({ where: { enrollmentId: e.id } })).toBe(1);
  });
});

describe("the maintenance pass", () => {
  it("confirms an approved payment whose webhook and return page never arrived, and leaves the other provider's rows alone", async () => {
    const courseId = await course({ owner: "admin" });
    const e = await pending(1, courseId);
    const ref = reference((await startPayPalCheckout(db, agent(1), e.id)).url);
    fake.setState(ref, "APPROVED");
    // A Maya attempt open at the same time must not be handed to the PayPal gateway, nor the PayPal one to Maya's.
    setMayaGatewayForTests(new FakeMayaGateway());
    process.env.MAYA_MODE = "fake";
    resetEnvCache();
    const e2 = await pending(2, await course({ owner: "admin" }));
    const mayaRef = (await startMayaCheckout(db, agent(2), e2.id)).url.split("/").pop()!;
    await db.onlinePayment.updateMany({ where: { id: { in: [ref, mayaRef] } }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });

    expect(await reconcilePendingOnlinePayments(db)).toBe(0);
    expect((await db.onlinePayment.findUniqueOrThrow({ where: { id: ref } })).status).toBe("PENDING");
    expect(await reconcilePendingPayPalPayments(db)).toBe(1);
    expect((await db.onlinePayment.findUniqueOrThrow({ where: { id: ref } })).status).toBe("PAID");
    expect((await db.onlinePayment.findUniqueOrThrow({ where: { id: mayaRef } })).status).toBe("PENDING");
    setMayaGatewayForTests(null);
    delete process.env.MAYA_MODE;
    resetEnvCache();
  });

  it("does nothing when PayPal is off, and the worker runs the pass without error", async () => {
    process.env.PAYPAL_MODE = "off";
    resetEnvCache();
    expect(await reconcilePendingPayPalPayments(db)).toBe(0);
    process.env.PAYPAL_MODE = "fake";
    resetEnvCache();
    await expect(runWorkerOnce(db)).resolves.toBeDefined();
  });
});
