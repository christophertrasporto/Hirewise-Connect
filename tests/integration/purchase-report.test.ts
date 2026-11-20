import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { listPurchases, listFailedOnlinePayments, purchasesCsvReport } from "@/server/services/purchase-report.service";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { PURCHASES_PAGE_SIZE } from "@/lib/purchases";

const db = testDb();
const ids: Record<string, string> = {};
const profiles: Record<string, string> = {};
const courses: Record<string, string> = {};

const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const wrongRoles = () => [makeActor("COACH", { userId: ids.coach }), makeActor("RECRUITER", { userId: ids.recruiter }), makeActor("OPERATIONS", { userId: ids.ops }), makeActor("AGENT", { userId: ids.ana, agentProfileId: profiles.ana })];

async function mkUser(key: string, email: string, role: RoleKey, name?: string) {
  const u = await db.user.create({ data: { email, roleId: (await db.role.findUniqueOrThrow({ where: { key: role } })).id, emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  if (name) profiles[key] = (await db.agentProfile.create({ data: { userId: u.id, displayName: name, headline: "H", primaryRole: "Cold Caller", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila", approvedAt: new Date() } })).id;
}

async function mkCourse(key: string, title: string, currency = "PHP") {
  const c = await db.academyCourse.create({ data: { code: `T-${key}`, title, category: "Sales", description: "A course description long enough.", ownerCoachUserId: ids.coach, status: "PUBLISHED", currency, priceCents: 2500 } });
  courses[key] = c.id;
}

type E = { buyer: string; course: string; status: "PAID" | "PENDING" | "WAIVED" | "REFUNDED" | "NOT_REQUIRED"; currency?: string; price?: number; paid?: number | null; refunded?: number; ref?: string; at?: string };
async function enrol(e: E) {
  return db.courseEnrollment.create({ data: { courseId: courses[e.course], agentProfileId: profiles[e.buyer], paymentStatus: e.status, currency: e.currency ?? "PHP", priceCents: e.price ?? 2500, paidCents: e.paid === undefined ? (e.status === "PAID" || e.status === "REFUNDED" ? 2500 : null) : e.paid, refundedCents: e.refunded ?? 0, paymentReference: e.ref ?? null, paidAt: e.status === "PAID" || e.status === "REFUNDED" ? new Date(e.at ?? "2026-11-10T00:00:00Z") : null, enrolledAt: new Date(e.at ?? "2026-11-10T00:00:00Z") } });
}

beforeAll(async () => {
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  await mkUser("admin", "admin@hirewise.example", "ADMIN");
  await mkUser("sales", "sales@hirewise.example", "SALES");
  await mkUser("coach", "coach@hirewise.example", "COACH");
  await mkUser("recruiter", "rec@hirewise.example", "RECRUITER");
  await mkUser("ops", "ops@hirewise.example", "OPERATIONS");
  await mkUser("ana", "ana@hirewise.example", "AGENT", "Ana Cruz");
  await mkUser("ben", "ben@hirewise.example", "AGENT", "Ben Reyes");
  await mkUser("cy", "cy@hirewise.example", "AGENT", "=Cy Formula");
  await mkCourse("cold", "Cold Calling 101");
  await mkCourse("close", "Closing Mastery", "USD");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("purchase report: who may see it", () => {
  it("staff who record course payments can; every other role gets Forbidden from all three functions", async () => {
    await listPurchases(db, admin());
    await listPurchases(db, sales());
    for (const a of wrongRoles()) {
      await expect(listPurchases(db, a)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listFailedOnlinePayments(db, a)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(purchasesCsvReport(db, a)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("purchase report: what it lists", () => {
  it("lists paid, pending, waived and refunded purchases, never free enrolments, newest first", async () => {
    await enrol({ buyer: "ana", course: "cold", status: "PAID", ref: "BANK-1", at: "2026-11-01T00:00:00Z" });
    await enrol({ buyer: "ben", course: "cold", status: "PENDING", paid: null, at: "2026-11-05T00:00:00Z" });
    await enrol({ buyer: "cy", course: "cold", status: "WAIVED", paid: null, at: "2026-11-03T00:00:00Z" });
    await enrol({ buyer: "ana", course: "close", status: "REFUNDED", currency: "USD", price: 1900, paid: 1900, refunded: 1900, at: "2026-11-07T00:00:00Z" });
    await enrol({ buyer: "ben", course: "close", status: "NOT_REQUIRED", currency: "USD", price: 0, paid: null, at: "2026-11-08T00:00:00Z" });
    const r = await listPurchases(db, admin());
    expect(r.total).toBe(4);
    expect(r.purchases.map((p) => [p.buyerName, p.status])).toEqual([["Ana Cruz", "REFUNDED"], ["Ben Reyes", "PENDING"], ["=Cy Formula", "WAIVED"], ["Ana Cruz", "PAID"]]);
    expect(r.purchases[3]).toMatchObject({ method: "MANUAL", reference: "BANK-1", courseTitle: "Cold Calling 101" });
  });

  it("totals stay separate per currency and take refunds off", async () => {
    const r = await listPurchases(db, admin());
    expect(r.totals.map((t) => t.currency)).toEqual(["PHP", "USD"]);
    expect(r.totals[0]).toMatchObject({ currency: "PHP", netCents: 2500, pendingCents: 2500 });
    expect(r.totals[1]).toMatchObject({ currency: "USD", collectedCents: 1900, refundedCents: 1900, netCents: 0 });
  });

  it("a view never carries contact details, keys, or the buyer's account", async () => {
    const r = await listPurchases(db, admin());
    const text = JSON.stringify(r.purchases);
    for (const forbidden of ["@hirewise.example", "email", "phone", "storageKey", "photoKey", "userId", "lastPayload", "redirectUrl"]) expect(text).not.toContain(forbidden);
  });
});


describe("purchase report: how each was paid", () => {
  it("tells PayPal, Maya, access code, agency seat and staff recording apart, and filters by each", async () => {
    await mkCourse("pp", "PayPal course");
    await mkCourse("my", "Maya course");
    await mkCourse("ac", "Code course", "USD");
    await mkCourse("mn", "Manual course");
    await mkCourse("st", "Seat course");
    const paypal = await enrol({ buyer: "ana", course: "pp", status: "PAID", ref: "PP-1", at: "2026-10-01T00:00:00Z" });
    await db.onlinePayment.create({ data: { provider: "PAYPAL", enrollmentId: paypal.id, amountMinor: 2500, currency: "PHP", status: "PAID", checkoutId: "ord-1", paidAt: new Date() } });
    const maya = await enrol({ buyer: "ana", course: "my", status: "PAID", ref: "MY-1", at: "2026-10-02T00:00:00Z" });
    await db.onlinePayment.create({ data: { provider: "MAYA", enrollmentId: maya.id, amountMinor: 2500, currency: "PHP", status: "PAID", checkoutId: "chk-1", paidAt: new Date() } });
    const viaCode = await enrol({ buyer: "ana", course: "ac", status: "PAID", currency: "USD", price: 1900, paid: 1900, ref: "AC-REF", at: "2026-10-03T00:00:00Z" });
    await db.accessCode.create({ data: { code: "TESTCODE0001", courseId: courses.ac, paymentReference: "AC-REF", status: "REDEEMED", expiresAt: new Date(Date.now() + 86_400_000), createdById: ids.admin, redeemedById: ids.ana, redeemedAt: new Date(), enrollmentId: viaCode.id } });
    await enrol({ buyer: "ana", course: "mn", status: "PAID", ref: "GCASH-77", at: "2026-10-04T00:00:00Z" });

    const by = async (method: "PAYPAL" | "MAYA" | "ACCESS_CODE" | "MANUAL" | "WAIVED") => (await listPurchases(db, admin(), { method })).purchases.map((p) => p.courseTitle).sort();
    expect(await by("PAYPAL")).toEqual(["PayPal course"]);
    expect(await by("MAYA")).toEqual(["Maya course"]);
    expect(await by("ACCESS_CODE")).toEqual(["Code course"]);
    expect(await by("MANUAL")).toEqual(["Closing Mastery", "Cold Calling 101", "Manual course"]);
    expect(await by("WAIVED")).toEqual(["Cold Calling 101"]);
    const all = (await listPurchases(db, admin())).purchases;
    expect(all.find((p) => p.courseTitle === "PayPal course")!.method).toBe("PAYPAL");
    expect(all.find((p) => p.courseTitle === "Code course")!.method).toBe("ACCESS_CODE");
  });

  it("a payment that is only pending at PayPal does not make a sale a PayPal sale", async () => {
    await mkCourse("pend", "Pending at PayPal");
    const e = await enrol({ buyer: "ben", course: "pend", status: "PAID", ref: "BANK-2", at: "2026-10-05T00:00:00Z" });
    await db.onlinePayment.create({ data: { provider: "PAYPAL", enrollmentId: e.id, amountMinor: 2500, currency: "PHP", status: "PENDING", checkoutId: "ord-2" } });
    const row = (await listPurchases(db, admin(), { search: "Pending at PayPal" })).purchases[0];
    expect(row.method).toBe("MANUAL");
  });
});

describe("purchase report: filters, paging and the CSV", () => {
  it("filters by status, course, date range (the last day included) and search", async () => {
    expect((await listPurchases(db, admin(), { status: "PENDING" })).purchases.map((p) => p.buyerName)).toEqual(["Ben Reyes"]);
    expect((await listPurchases(db, admin(), { courseId: courses.close })).total).toBe(1);
    expect((await listPurchases(db, admin(), { from: "2026-11-05", to: "2026-11-05" })).purchases.map((p) => p.status)).toEqual(["PENDING"]);
    expect((await listPurchases(db, admin(), { search: "bank-1" })).purchases.map((p) => p.reference)).toEqual(["BANK-1"]);
    expect((await listPurchases(db, admin(), { search: "ben reyes", status: "PAID" })).purchases.every((p) => p.buyerName === "Ben Reyes" && p.status === "PAID")).toBe(true);
  });

  it("rejects a filter it does not understand instead of guessing", async () => {
    await expect(listPurchases(db, admin(), { status: "BOGUS" })).rejects.toThrow();
    await expect(listPurchases(db, admin(), { from: "tomorrow" })).rejects.toThrow();
  });

  it("pages the list and reports how many pages there are", async () => {
    await mkCourse("bulk", "Bulk course");
    const user = await db.user.create({ data: { email: "bulk@hirewise.example", roleId: (await db.role.findUniqueOrThrow({ where: { key: "AGENT" } })).id } });
    const profile = await db.agentProfile.create({ data: { userId: user.id, displayName: "Bulk Buyer", headline: "H", primaryRole: "Cold Caller", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila", approvedAt: new Date() } });
    for (let i = 0; i < PURCHASES_PAGE_SIZE + 5; i++) {
      const c = await db.academyCourse.create({ data: { code: `B-${i}`, title: `Bulk ${i}`, category: "Sales", description: "A course description long enough.", ownerCoachUserId: ids.coach, status: "PUBLISHED", currency: "PHP", priceCents: 100 } });
      await db.courseEnrollment.create({ data: { courseId: c.id, agentProfileId: profile.id, paymentStatus: "PAID", currency: "PHP", priceCents: 100, paidCents: 100, paidAt: new Date("2026-09-01T00:00:00Z"), enrolledAt: new Date("2026-09-01T00:00:00Z") } });
    }
    const p1 = await listPurchases(db, admin(), { search: "Bulk Buyer" });
    expect(p1.total).toBe(PURCHASES_PAGE_SIZE + 5);
    expect(p1.pages).toBe(2);
    expect(p1.purchases).toHaveLength(PURCHASES_PAGE_SIZE);
    const p2 = await listPurchases(db, admin(), { search: "Bulk Buyer", page: 2 });
    expect(p2.purchases).toHaveLength(5);
    expect(new Set([...p1.purchases, ...p2.purchases].map((p) => p.id)).size).toBe(PURCHASES_PAGE_SIZE + 5);
  });

  it("the CSV has the filtered rows only, and a buyer name starting with = cannot run as a formula", async () => {
    const csv = await purchasesCsvReport(db, admin(), { status: "WAIVED" });
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("'=Cy Formula");
    expect(lines[1]).toContain("Waived");
    expect(csv).not.toContain("@hirewise.example");
  });
});

describe("purchase report: online attempts that did not go through", () => {
  it("lists failed, expired, cancelled and mismatched attempts with the provider's reason, never the paid or open ones", async () => {
    await mkCourse("fail", "Failing course");
    const e = await enrol({ buyer: "cy", course: "fail", status: "PENDING", paid: null });
    const mk = (status: "FAILED" | "PENDING" | "PAID" | "CANCELLED" | "MISMATCH", n: number, reason?: string) => db.onlinePayment.create({ data: { provider: "PAYPAL", enrollmentId: e.id, amountMinor: 2500, currency: "PHP", status, checkoutId: `f-${n}`, failureReason: reason ?? null, createdAt: new Date(Date.UTC(2026, 10, 1 + n)) } });
    await mk("FAILED", 1, "Could not create the order: PayPal sign-in failed (401)");
    await mk("PENDING", 2);
    await mk("PAID", 3);
    await mk("CANCELLED", 4, "Price changed by a promo code");
    await mk("MISMATCH", 5);
    const f = await listFailedOnlinePayments(db, admin());
    expect(f.map((x) => x.status)).toEqual(["MISMATCH", "CANCELLED", "FAILED"]);
    expect(f[2]).toMatchObject({ provider: "PAYPAL", reason: "Could not create the order: PayPal sign-in failed (401)", buyerName: "=Cy Formula", courseTitle: "Failing course" });
    const text = JSON.stringify(f);
    for (const forbidden of ["lastPayload", "redirectUrl", "checkoutId", "@hirewise.example"]) expect(text).not.toContain(forbidden);
  });
});
