import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { createAccessCode, redeemAccessCode, voidAccessCode, listAccessCodes, listPayableCourses, normalizeAccessCode, generateAccessCode, ACCESS_CODE_REFUSAL, AccessCodeError } from "@/server/services/access-code.service";
import { createPromo, applyPromoToEnrollment } from "@/server/services/promo.service";
import { enrol } from "@/server/services/academy.service";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";
import { resetRateLimits } from "@/server/auth/rate-limit";

const db = testDb();
const ids: Record<string, string> = {};
const profiles: Record<string, string> = {};

const admin = () => makeActor("ADMIN", { userId: ids.admin });
const coach = () => makeActor("COACH", { userId: ids.coach });
const client = () => makeActor("CLIENT", { clientId: "c1" });
const learner = (k: string) => makeActor("AGENT", { userId: ids[k], agentProfileId: profiles[k] });

async function mkUser(key: string, email: string, role: RoleKey) {
  const u = await db.user.create({ data: { email, roleId: (await db.role.findUniqueOrThrow({ where: { key: role } })).id, emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  if (role === "AGENT") profiles[key] = (await db.agentProfile.create({ data: { userId: u.id, displayName: key, headline: "H", primaryRole: "Cold Caller", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila", approvedAt: new Date() } })).id;
}

let seq = 0;
async function mkCourse(over: { priceCents?: number; status?: "PUBLISHED" | "DRAFT" } = {}) {
  seq++;
  const c = await db.academyCourse.create({ data: { code: `AC-${seq}`, title: `Course ${seq}`, category: "Sales", description: "A course description long enough to satisfy validation rules.", status: over.status ?? "PUBLISHED", priceCents: over.priceCents ?? 100_000, currency: "PHP", ownerCoachUserId: ids.coach } });
  await db.courseCoach.create({ data: { courseId: c.id, coachUserId: ids.coach } });
  return c.id;
}

const issue = (courseId: string, over: Record<string, unknown> = {}) => createAccessCode(db, admin(), { courseId, paymentReference: "BDO-12345", ...over });

beforeAll(async () => {
  process.env.APP_URL = "http://localhost:3000";
  resetEnvCache();
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  await mkUser("admin", "admin@hirewise.example", "ADMIN");
  await mkUser("coach", "coach@hirewise.example", "COACH");
  for (const k of ["maria", "juan", "ana", "pat"] as const) await mkUser(k, `${k}@talent.example`, "AGENT");
});

beforeEach(() => resetRateLimits());

afterAll(async () => {
  await db.$disconnect();
});

describe("code format", () => {
  it("generates HW-XXXX-XXXX without look-alike characters", () => {
    for (let i = 0; i < 200; i++) expect(generateAccessCode()).toMatch(/^HW-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(new Set(Array.from({ length: 200 }, generateAccessCode)).size).toBe(200);
  });

  it("accepts what a buyer types: any case, spaces, missing dashes", () => {
    expect(normalizeAccessCode("hw-k7m2-9xqp")).toBe("HW-K7M2-9XQP");
    expect(normalizeAccessCode(" hw k7m2 9xqp ")).toBe("HW-K7M2-9XQP");
    expect(normalizeAccessCode("HWK7M29XQP")).toBe("HW-K7M2-9XQP");
    for (const bad of ["", "K7M2-9XQP", "HW-K7M2", "HW-K7M2-9XQP-1", "SUMMER20", "HW-K7M2-9XQ!"]) expect(normalizeAccessCode(bad), bad).toBe("");
  });
});

describe("issuing and voiding", () => {
  it("staff with course.payment.record issue a code for a published, paid course", async () => {
    const course = await mkCourse();
    const r = await issue(course, { buyerEmail: "Maria@Talent.example", expiresInDays: 10, note: "GCash 0917" });
    expect(r.code).toMatch(/^HW-/);
    const row = await db.accessCode.findUniqueOrThrow({ where: { code: r.code } });
    expect(row).toMatchObject({ status: "UNUSED", courseId: course, buyerEmail: "maria@talent.example", paymentReference: "BDO-12345", createdById: ids.admin, note: "GCash 0917" });
    expect(Math.round((row.expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(10);
    expect(await db.auditLog.count({ where: { action: "ACCESS_CODE_CREATED", entityId: row.id } })).toBe(1);
    expect((await listPayableCourses(db, admin())).some((c) => c.id === course)).toBe(true);
  });

  it("refuses a free, draft or unknown course and bad input", async () => {
    await expect(issue(await mkCourse({ priceCents: 0 }))).rejects.toThrow(/free/);
    await expect(issue(await mkCourse({ status: "DRAFT" }))).rejects.toThrow(NotFoundError);
    await expect(issue("missing")).rejects.toThrow(NotFoundError);
    const course = await mkCourse();
    await expect(issue(course, { paymentReference: "x" })).rejects.toThrow();
    await expect(issue(course, { buyerEmail: "not-an-email" })).rejects.toThrow();
    await expect(issue(course, { expiresInDays: 0 })).rejects.toThrow();
    await expect(issue(course, { expiresInDays: 366 })).rejects.toThrow();
  });

  it("only staff who record payments can issue, list or void; coaches, clients and learners cannot", async () => {
    const course = await mkCourse();
    const code = await issue(course);
    const row = await db.accessCode.findUniqueOrThrow({ where: { code: code.code } });
    for (const a of [coach(), client(), learner("maria")]) {
      await expect(createAccessCode(db, a, { courseId: course, paymentReference: "BDO-1" })).rejects.toThrow(ForbiddenError);
      await expect(listAccessCodes(db, a)).rejects.toThrow(ForbiddenError);
      await expect(voidAccessCode(db, a, row.id, "mistake")).rejects.toThrow(ForbiddenError);
      await expect(listPayableCourses(db, a)).rejects.toThrow(ForbiddenError);
    }
  });

  it("voiding needs a reason, works once, and only on an unused code", async () => {
    const course = await mkCourse();
    const { code } = await issue(course);
    const row = await db.accessCode.findUniqueOrThrow({ where: { code } });
    await expect(voidAccessCode(db, admin(), row.id, "x")).rejects.toThrow(/reason/);
    await expect(voidAccessCode(db, admin(), "missing", "mistake")).rejects.toThrow(NotFoundError);
    await voidAccessCode(db, admin(), row.id, "Issued by mistake");
    await expect(voidAccessCode(db, admin(), row.id, "again")).rejects.toThrow(/unused/);
    expect((await db.accessCode.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("VOIDED");
    await expect(redeemAccessCode(db, learner("maria"), code)).rejects.toThrow(ACCESS_CODE_REFUSAL);
    const listed = (await listAccessCodes(db, admin())).find((c) => c.id === row.id);
    expect(listed).toMatchObject({ status: "VOIDED", voidReason: "Issued by mistake", createdBy: "admin@hirewise.example" });
  });
});

describe("redeeming", () => {
  it("opens the course for a buyer with no enrolment, recording the payment, the coach earning and the audit trail", async () => {
    const course = await mkCourse({ priceCents: 249_900 });
    const { code } = await issue(course, { paymentReference: "GCASH-778899" });
    const r = await redeemAccessCode(db, learner("maria"), code.toLowerCase(), course);
    expect(r.courseId).toBe(course);
    const e = await db.courseEnrollment.findUniqueOrThrow({ where: { courseId_agentProfileId: { courseId: course, agentProfileId: profiles.maria } } });
    expect(e).toMatchObject({ paymentStatus: "PAID", paidCents: 249_900, paymentReference: "GCASH-778899", paymentRecordedById: ids.admin });
    expect(e.accessRevokedAt).toBeNull();
    const row = await db.accessCode.findUniqueOrThrow({ where: { code } });
    expect(row).toMatchObject({ status: "REDEEMED", redeemedById: ids.maria, enrollmentId: e.id });
    expect(row.redeemedAt).not.toBeNull();
    // The same single settlement point as a payment recorded by hand: the coach wallet earning exists for this sale.
    const earning = await db.coachEarning.findFirstOrThrow({ where: { enrollmentId: e.id } });
    expect(earning).toMatchObject({ coachUserId: ids.coach, saleAmount: 249_900 });
    expect(await db.auditLog.count({ where: { action: "COURSE_PAYMENT_RECORDED", entityId: e.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "ACCESS_CODE_REDEEMED", entityId: row.id } })).toBe(1);
    const listed = (await listAccessCodes(db, admin())).find((c) => c.code === code);
    expect(listed).toMatchObject({ status: "REDEEMED", redeemedBy: "maria@talent.example" });
  });

  it("settles an existing pending enrolment, at the price after any promo code", async () => {
    const course = await mkCourse({ priceCents: 100_000 });
    await createPromo(db, makeActor("SUPER_ADMIN", { userId: ids.admin }), { code: `TWENTY${course.slice(-4)}`.toUpperCase(), label: "20 off", discountType: "PERCENT", percent: "20", appliesTo: "ALL_COURSES", courseIds: [], perLearnerLimit: "1" });
    await enrol(db, learner("juan"), course);
    const e0 = await db.courseEnrollment.findUniqueOrThrow({ where: { courseId_agentProfileId: { courseId: course, agentProfileId: profiles.juan } } });
    await applyPromoToEnrollment(db, learner("juan"), e0.id, `TWENTY${course.slice(-4)}`);
    const { code } = await issue(course);
    await redeemAccessCode(db, learner("juan"), code);
    const e = await db.courseEnrollment.findUniqueOrThrow({ where: { id: e0.id } });
    expect(e).toMatchObject({ paymentStatus: "PAID", paidCents: 80_000 });
    expect((await db.promoRedemption.findFirstOrThrow({ where: { enrollmentId: e0.id } })).status).toBe("CONSUMED");
  });

  it("a code works once: a second redeem, by anyone, is refused", async () => {
    const course = await mkCourse();
    const { code } = await issue(course);
    await redeemAccessCode(db, learner("ana"), code);
    await expect(redeemAccessCode(db, learner("ana"), code)).rejects.toThrow(ACCESS_CODE_REFUSAL);
    await expect(redeemAccessCode(db, learner("pat"), code)).rejects.toThrow(ACCESS_CODE_REFUSAL);
    expect(await db.courseEnrollment.count({ where: { courseId: course } })).toBe(1);
  });

  it("two buyers racing for one code: exactly one wins, the other is left with no enrolment", async () => {
    const course = await mkCourse();
    const { code } = await issue(course);
    const results = await Promise.allSettled([redeemAccessCode(db, learner("maria"), code), redeemAccessCode(db, learner("pat"), code)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await db.courseEnrollment.count({ where: { courseId: course, paymentStatus: "PAID" } })).toBe(1);
    expect(await db.courseEnrollment.count({ where: { courseId: course } })).toBe(1);
    expect(await db.coachEarning.count({ where: { enrollment: { courseId: course } } })).toBe(1);
  });

  it("every failure reads the same: unknown, wrong course, wrong buyer, expired, voided, malformed", async () => {
    const course = await mkCourse();
    const other = await mkCourse();
    const forPat = (await issue(course, { buyerEmail: "pat@talent.example" })).code;
    const expired = (await issue(course)).code;
    await db.accessCode.update({ where: { code: expired }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const fine = (await issue(course)).code;
    const messages: string[] = [];
    const attempt = async (a: ReturnType<typeof learner>, code: string, courseId?: string) => {
      try {
        await redeemAccessCode(db, a, code, courseId);
        messages.push("OPENED");
      } catch (e) {
        expect(e).toBeInstanceOf(AccessCodeError);
        messages.push((e as Error).message);
      }
    };
    await attempt(learner("juan"), "HW-ZZZZ-ZZZZ");
    await attempt(learner("juan"), "not a code");
    await attempt(learner("juan"), forPat); // meant for Pat
    await attempt(learner("juan"), expired);
    await attempt(learner("juan"), fine, other); // right code, wrong course page
    expect(messages).toEqual(Array(5).fill(ACCESS_CODE_REFUSAL));
    // None of that used anything up: the right buyer can still use the codes.
    await redeemAccessCode(db, learner("pat"), forPat);
    await redeemAccessCode(db, learner("juan"), fine, course);
  });

  it("a code for a named buyer cannot be used by another account, and email case does not matter", async () => {
    const course = await mkCourse();
    const { code } = await issue(course, { buyerEmail: "ANA@talent.example" });
    await expect(redeemAccessCode(db, learner("maria"), code)).rejects.toThrow(ACCESS_CODE_REFUSAL);
    await redeemAccessCode(db, learner("ana"), code);
    expect((await db.courseEnrollment.findFirstOrThrow({ where: { courseId: course } })).agentProfileId).toBe(profiles.ana);
  });

  it("someone who already has access keeps the code unused", async () => {
    const course = await mkCourse();
    const first = (await issue(course)).code;
    await redeemAccessCode(db, learner("maria"), first);
    const second = (await issue(course)).code;
    await expect(redeemAccessCode(db, learner("maria"), second)).rejects.toThrow(/already have access/);
    expect((await db.accessCode.findUniqueOrThrow({ where: { code: second } })).status).toBe("UNUSED");
  });

  it("a refunded enrolment is not reopened by a code", async () => {
    const course = await mkCourse();
    const { code } = await issue(course);
    await db.courseEnrollment.create({ data: { courseId: course, agentProfileId: profiles.pat, priceCents: 100_000, currency: "PHP", paymentStatus: "REFUNDED" } });
    await expect(redeemAccessCode(db, learner("pat"), code)).rejects.toThrow(/refunded/);
    expect((await db.accessCode.findUniqueOrThrow({ where: { code } })).status).toBe("UNUSED");
  });

  it("a course unpublished after the code was issued cannot be opened with it", async () => {
    const course = await mkCourse();
    const { code } = await issue(course);
    await db.academyCourse.update({ where: { id: course }, data: { status: "ARCHIVED" } });
    await expect(redeemAccessCode(db, learner("maria"), code)).rejects.toThrow(ACCESS_CODE_REFUSAL);
  });

  it("only talent can redeem; staff, coaches and clients cannot", async () => {
    const { code } = await issue(await mkCourse());
    for (const a of [admin(), coach(), client()]) await expect(redeemAccessCode(db, a, code)).rejects.toThrow(ForbiddenError);
  });

  it("guessing is rate limited per account", async () => {
    let limited = false;
    for (let i = 0; i < 12; i++) {
      try {
        await redeemAccessCode(db, learner("juan"), `HW-AAAA-${String(2222 + i)}`);
      } catch (e) {
        if ((e as Error).name === "RateLimitedError") limited = true;
      }
    }
    expect(limited).toBe(true);
  });
});
