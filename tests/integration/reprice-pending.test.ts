import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { createCourse, updateCourse } from "@/server/services/academy.service";
import { createPromo, applyPromoToEnrollment } from "@/server/services/promo.service";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";

const db = testDb();
const ids: Record<string, string> = {};
const profiles: Record<string, string> = {};
let categoryId = "";

const admin = () => makeActor("ADMIN", { userId: ids.admin });
const coach = () => makeActor("COACH", { userId: ids.coach });
const otherCoach = () => makeActor("COACH", { userId: ids.coach2 });
const learner = (k: string) => makeActor("AGENT", { userId: ids[k], agentProfileId: profiles[k] });

async function mkUser(key: string, email: string, role: RoleKey) {
  const u = await db.user.create({ data: { email, roleId: (await db.role.findUniqueOrThrow({ where: { key: role } })).id, emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  if (role === "AGENT") profiles[key] = (await db.agentProfile.create({ data: { userId: u.id, displayName: key, headline: "H", primaryRole: "Cold Caller", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila", approvedAt: new Date() } })).id;
}

const form = (title: string, price: string, currency: "PHP" | "USD") => ({ title, categoryId, description: "A course description long enough to satisfy validation rules.", difficulty: "BEGINNER" as const, price, currency, passingScore: 70 });

async function course(title: string, price = "19", currency: "PHP" | "USD" = "USD") {
  const id = await createCourse(db, coach(), form(title, price, currency));
  return id;
}
const enrolment = (courseId: string, who: string, over: Record<string, unknown> = {}) => {
  const c = db.academyCourse.findUniqueOrThrow({ where: { id: courseId } });
  return c.then((x) => db.courseEnrollment.create({ data: { courseId, agentProfileId: profiles[who], paymentStatus: "PENDING", priceCents: x.priceCents, currency: x.currency, ...over } }));
};
const fresh = (id: string) => db.courseEnrollment.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  await mkUser("admin", "admin@hirewise.example", "ADMIN");
  await mkUser("coach", "coach@hirewise.example", "COACH");
  await mkUser("coach2", "coach2@hirewise.example", "COACH");
  for (const k of ["ana", "ben", "cy", "dee"]) await mkUser(k, `${k}@hirewise.example`, "AGENT");
  categoryId = (await db.courseCategory.create({ data: { name: "Sales", slug: "sales", order: 1 } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("a price change reaches unpaid enrolments", () => {
  it("a pending USD 19 enrolment becomes PHP 25 when the course price changes to PHP 25", async () => {
    const id = await course("Cold Calling 101");
    const e = await enrolment(id, "ana");
    expect([e.priceCents, e.currency]).toEqual([1900, "USD"]);
    await updateCourse(db, coach(), id, form("Cold Calling 101", "25", "PHP"));
    const after = await fresh(e.id);
    expect([after.priceCents, after.currency, after.paymentStatus, after.listPriceCents]).toEqual([2500, "PHP", "PENDING", null]);
    const log = await db.auditLog.findFirst({ where: { entityId: e.id, action: "COURSE_PRICE_CHANGED" } });
    expect(log).toBeTruthy();
    expect(log!.previousValue).toMatchObject({ priceCents: 1900, currency: "USD" });
    expect(log!.newValue).toMatchObject({ priceCents: 2500, currency: "PHP" });
  });

  it("paid, waived, refunded and free enrolments keep what they were charged", async () => {
    const id = await course("Closing Mastery");
    const paid = await enrolment(id, "ana", { paymentStatus: "PAID", paidCents: 1900, paidAt: new Date() });
    const waived = await enrolment(id, "ben", { paymentStatus: "WAIVED" });
    const refunded = await enrolment(id, "cy", { paymentStatus: "REFUNDED", paidCents: 1900, refundedCents: 1900 });
    const free = await enrolment(id, "dee", { paymentStatus: "NOT_REQUIRED", priceCents: 0 });
    await updateCourse(db, coach(), id, form("Closing Mastery", "250", "PHP"));
    for (const e of [paid, waived, refunded]) expect([(await fresh(e.id)).priceCents, (await fresh(e.id)).currency]).toEqual([1900, "USD"]);
    expect([(await fresh(free.id)).priceCents, (await fresh(free.id)).paymentStatus]).toEqual([0, "NOT_REQUIRED"]);
  });

  it("only that course's enrolments change", async () => {
    const a = await course("Course A");
    const b = await course("Course B");
    const ea = await enrolment(a, "ana");
    const eb = await enrolment(b, "ana");
    await updateCourse(db, coach(), a, form("Course A", "30", "USD"));
    expect((await fresh(ea.id)).priceCents).toBe(3000);
    expect((await fresh(eb.id)).priceCents).toBe(1900);
  });

  it("saving without changing the price touches nothing", async () => {
    const id = await course("Same price");
    const e = await enrolment(id, "ana");
    await updateCourse(db, coach(), id, form("Same price renamed", "19", "USD"));
    expect(await db.auditLog.count({ where: { entityId: e.id, action: "COURSE_PRICE_CHANGED" } })).toBe(0);
    expect((await fresh(e.id)).priceCents).toBe(1900);
  });
});

describe("what happens to a code and an open checkout", () => {
  it("a reserved promo code is released and the new price carries no discount; open checkouts are cancelled", async () => {
    const id = await course("Promo course", "100", "PHP");
    const e = await enrolment(id, "ana");
    const p = await createPromo(db, admin(), { label: "Launch", code: "REPRICE20", discountType: "PERCENT", percent: "20", appliesTo: "ALL_COURSES", perLearnerLimit: "1" });
    await applyPromoToEnrollment(db, learner("ana"), e.id, p.code);
    expect((await fresh(e.id)).priceCents).toBe(8000);
    const attempt = await db.onlinePayment.create({ data: { provider: "PAYPAL", enrollmentId: e.id, amountMinor: 8000, currency: "PHP", status: "PENDING", checkoutId: "ord-x", redirectUrl: "https://paypal.example/x" } });

    await updateCourse(db, coach(), id, form("Promo course", "150", "PHP"));
    const after = await fresh(e.id);
    expect([after.priceCents, after.listPriceCents, after.currency, after.paymentStatus]).toEqual([15000, null, "PHP", "PENDING"]);
    const redemption = await db.promoRedemption.findFirstOrThrow({ where: { enrollmentId: e.id } });
    expect(redemption.status).toBe("RELEASED");
    expect((await db.onlinePayment.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("CANCELLED");
  });

  it("the learner can apply the code again to the new price", async () => {
    const e = await db.courseEnrollment.findFirstOrThrow({ where: { agentProfileId: profiles.ana, course: { title: "Promo course" } } });
    await applyPromoToEnrollment(db, learner("ana"), e.id, "REPRICE20");
    expect([(await fresh(e.id)).priceCents, (await fresh(e.id)).listPriceCents]).toEqual([12000, 15000]);
  });

  it("a course made free turns its unpaid enrolments into free access", async () => {
    const id = await course("Now free", "40", "PHP");
    const e = await enrolment(id, "ben");
    await updateCourse(db, coach(), id, form("Now free", "", "PHP"));
    const after = await fresh(e.id);
    expect([after.priceCents, after.paymentStatus, after.credentialSource]).toEqual([0, "NOT_REQUIRED", "HIREWISE_DIRECT"]);
  });
});

describe("who can change a price", () => {
  it("a coach who does not own the course cannot, and nothing is re-priced", async () => {
    const id = await course("Not yours");
    const e = await enrolment(id, "cy");
    await expect(updateCourse(db, otherCoach(), id, form("Not yours", "99", "PHP"))).rejects.toThrow();
    expect((await fresh(e.id)).priceCents).toBe(1900);
    await expect(updateCourse(db, learner("ana"), id, form("Not yours", "99", "PHP"))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
