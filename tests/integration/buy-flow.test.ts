import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { seedTerms } from "../setup/terms";
import { startPurchase } from "@/server/services/purchase.service";
import { registerAgentQuick, quickAgentRegistrationSchema, getOwnProfile } from "@/server/services/agent.service";
import { createPromo } from "@/server/services/promo.service";
import { ensureReferralCode } from "@/server/services/referral.service";
import { recordCoursePayment } from "@/server/services/academy.service";
import { DuplicateDetectedError } from "@/server/services/identity.service";
import { FakePayPalGateway, setPayPalGatewayForTests } from "@/server/adapters/paypal";
import { FakeMayaGateway, setMayaGatewayForTests } from "@/server/adapters/maya";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";
import { resetRateLimits } from "@/server/auth/rate-limit";

const db = testDb();
const ids = { admin: "admin_bf", sales: "sales_bf", coach: "coach_bf", referrer: "", category: "" };
const learners: Array<{ userId: string; profileId: string }> = [];
const paypal = new FakePayPalGateway();
const maya = new FakeMayaGateway();
const meta = { ipAddress: "198.51.100.7", userAgent: "vitest" };
const PASSWORD = "Str0ngPassw0rd!";
let seq = 0;

const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const client = () => makeActor("CLIENT", { clientId: "c1" });
const learner = (n: number) => makeActor("AGENT", { userId: learners[n].userId, agentProfileId: learners[n].profileId });

async function mkAgent(email: string) {
  const u = await db.user.create({ data: { email, roleId: (await db.role.findUniqueOrThrow({ where: { key: "AGENT" } })).id, emailVerifiedAt: new Date() } });
  const p = await db.agentProfile.create({ data: { userId: u.id, displayName: email.split("@")[0], headline: "H", primaryRole: "Cold Caller", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila", approvedAt: new Date() } });
  return { userId: u.id, profileId: p.id };
}
async function course(o: { priceCents?: number; currency?: string; status?: "PUBLISHED" | "DRAFT" } = {}) {
  seq++;
  return (
    await db.academyCourse.create({
      data: { code: `BF-${seq}`, title: `Buy Flow Course ${seq}`, slug: `buy-flow-course-${seq}`, category: "Sales", categoryId: ids.category, description: "A course description long enough to satisfy validation rules.", status: o.status ?? "PUBLISHED", priceCents: o.priceCents ?? 49900, currency: o.currency ?? "PHP", ownerCoachUserId: ids.coach },
    })
  ).id;
}
const enrolmentOf = (n: number, courseId: string) => db.courseEnrollment.findFirstOrThrow({ where: { courseId, agentProfileId: learners[n].profileId } });
const quick = (over: Record<string, unknown> = {}) => quickAgentRegistrationSchema.parse({ termsAccepted: true, fullName: "Maria Santos", email: "maria.new@talent.example", password: PASSWORD, ...over });

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16";
  process.env.APP_URL = "http://localhost:3000";
  process.env.PAYPAL_MODE = "fake";
  process.env.MAYA_MODE = "fake";
  resetEnvCache();
  setPayPalGatewayForTests(paypal);
  setMayaGatewayForTests(maya);
  setEmailChannelForTests(new ConsoleEmailChannel());
  await resetDb(db);
  resetRateLimits();
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  await seedTerms(db);
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN") } });
  await db.user.create({ data: { id: ids.sales, email: "sales@hirewise.example", roleId: await role("SALES") } });
  await db.user.create({ data: { id: ids.coach, email: "coach@hirewise.example", roleId: await role("COACH") } });
  ids.category = (await db.courseCategory.create({ data: { name: "Sales", slug: "sales", order: 1 } })).id;
  for (const email of ["one@talent.example", "two@talent.example", "three@talent.example"]) learners.push(await mkAgent(email));
  ids.referrer = (await mkAgent("referrer@talent.example")).userId;
});

afterEach(() => {
  process.env.PAYPAL_MODE = "fake";
  process.env.MAYA_MODE = "fake";
  resetEnvCache();
  resetRateLimits();
});

afterAll(async () => {
  setPayPalGatewayForTests(null);
  setMayaGatewayForTests(null);
  setEmailChannelForTests(null);
  delete process.env.PAYPAL_MODE;
  delete process.env.MAYA_MODE;
  resetEnvCache();
  await db.$disconnect();
});

describe("the one-press purchase", () => {
  it("enrols and goes to PayPal for a paid course, and a second press reuses the same checkout", async () => {
    const c = await course();
    const r = await startPurchase(db, learner(0), { courseId: c, method: "PAYPAL" });
    expect(r).toMatchObject({ kind: "REDIRECT" });
    const e = await enrolmentOf(0, c);
    expect([e.paymentStatus, e.priceCents, e.currency]).toEqual(["PENDING", 49900, "PHP"]);
    const rows = await db.onlinePayment.findMany({ where: { enrollmentId: e.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "PAYPAL", status: "PENDING" });
    const again = await startPurchase(db, learner(0), { courseId: c, method: "PAYPAL" });
    expect(again).toEqual(r);
    expect(await db.courseEnrollment.count({ where: { courseId: c, agentProfileId: learners[0].profileId } })).toBe(1);
    expect(await db.onlinePayment.count({ where: { enrollmentId: e.id } })).toBe(1);
  });

  it("goes to Maya for a PHP course, and PayPal works for a USD course", async () => {
    const php = await course();
    expect(await startPurchase(db, learner(1), { courseId: php, method: "MAYA" })).toMatchObject({ kind: "REDIRECT" });
    expect((await db.onlinePayment.findFirstOrThrow({ where: { enrollmentId: (await enrolmentOf(1, php)).id } })).provider).toBe("MAYA");
    const usd = await course({ priceCents: 4900, currency: "USD" });
    expect(await startPurchase(db, learner(1), { courseId: usd, method: "PAYPAL" })).toMatchObject({ kind: "REDIRECT" });
    await expect(startPurchase(db, learner(2), { courseId: usd, method: "MAYA" })).rejects.toThrow(/cannot be paid with Maya/);
    // That refused press still left an unpaid enrolment and nothing charged.
    const e = await enrolmentOf(2, usd);
    expect(e.paymentStatus).toBe("PENDING");
    expect(await db.onlinePayment.count({ where: { enrollmentId: e.id } })).toBe(0);
  });

  it("offline: enrols, starts no online payment, and tells the screen to show the instructions", async () => {
    const c = await course();
    expect(await startPurchase(db, learner(0), { courseId: c, method: "OFFLINE" })).toEqual({ kind: "OFFLINE" });
    const e = await enrolmentOf(0, c);
    expect(e.paymentStatus).toBe("PENDING");
    expect(await db.onlinePayment.count({ where: { enrollmentId: e.id } })).toBe(0);
  });

  it("a free course opens at once whichever button was pressed", async () => {
    const c = await course({ priceCents: 0 });
    expect(await startPurchase(db, learner(0), { courseId: c, method: "PAYPAL" })).toEqual({ kind: "OPEN_COURSE" });
    expect((await enrolmentOf(0, c)).paymentStatus).toBe("NOT_REQUIRED");
    expect(await db.onlinePayment.count({ where: { enrollment: { courseId: c } } })).toBe(0);
  });

  it("a promo code is applied with the enrolment, and a code that makes it free opens the course", async () => {
    const c = await course();
    await createPromo(db, admin(), { label: "Half", discountType: "PERCENT", percent: "50", appliesTo: "ALL_COURSES", perLearnerLimit: "1", code: "HALFOFF" });
    await startPurchase(db, learner(0), { courseId: c, method: "PAYPAL", promoCode: "halfoff" });
    const e = await enrolmentOf(0, c);
    expect([e.priceCents, e.listPriceCents]).toEqual([24950, 49900]);
    expect((await db.onlinePayment.findFirstOrThrow({ where: { enrollmentId: e.id } })).amountMinor).toBe(24950);

    const c2 = await course();
    await createPromo(db, admin(), { label: "Free", discountType: "PERCENT", percent: "100", appliesTo: "ALL_COURSES", perLearnerLimit: "1", code: "ALLFREE" });
    expect(await startPurchase(db, learner(1), { courseId: c2, method: "PAYPAL", promoCode: "ALLFREE" })).toEqual({ kind: "OPEN_COURSE" });
    expect((await enrolmentOf(1, c2)).paymentStatus).toBe("NOT_REQUIRED");
  });

  it("a bad promo code enrols nobody", async () => {
    const c = await course();
    await expect(startPurchase(db, learner(2), { courseId: c, method: "PAYPAL", promoCode: "NOSUCHCODE" })).rejects.toThrow();
    expect(await db.courseEnrollment.count({ where: { courseId: c, agentProfileId: learners[2].profileId } })).toBe(0);
  });

  it("someone who already owns the course is sent to it, with nothing new charged", async () => {
    const c = await course();
    await startPurchase(db, learner(0), { courseId: c, method: "OFFLINE" });
    const e = await enrolmentOf(0, c);
    await recordCoursePayment(db, sales(), e.id, { paid: "499.00", reference: "GCASH-1", waived: false });
    expect(await startPurchase(db, learner(0), { courseId: c, method: "PAYPAL" })).toEqual({ kind: "OPEN_COURSE" });
    expect(await db.onlinePayment.count({ where: { enrollmentId: e.id } })).toBe(0);
  });

  it("an ended enrolment is refused with a readable message", async () => {
    const c = await course();
    await startPurchase(db, learner(1), { courseId: c, method: "OFFLINE" });
    const e = await enrolmentOf(1, c);
    await db.courseEnrollment.update({ where: { id: e.id }, data: { paymentStatus: "REFUNDED" } });
    await expect(startPurchase(db, learner(1), { courseId: c, method: "PAYPAL" })).rejects.toThrow(/access to this course has ended/);
  });

  it("only talent can buy, and only a published course", async () => {
    const c = await course();
    await expect(startPurchase(db, sales(), { courseId: c, method: "PAYPAL" })).rejects.toThrow(ForbiddenError);
    await expect(startPurchase(db, client(), { courseId: c, method: "PAYPAL" })).rejects.toThrow(ForbiddenError);
    const draft = await course({ status: "DRAFT" });
    await expect(startPurchase(db, learner(0), { courseId: draft, method: "PAYPAL" })).rejects.toThrow(NotFoundError);
    await expect(startPurchase(db, learner(0), { courseId: "missing", method: "PAYPAL" })).rejects.toThrow(NotFoundError);
    expect(await db.courseEnrollment.count({ where: { courseId: draft } })).toBe(0);
  });

  it("with a gateway switched off, the learner keeps an unpaid enrolment and is told to pay another way", async () => {
    const c = await course();
    process.env.PAYPAL_MODE = "off";
    resetEnvCache();
    await expect(startPurchase(db, learner(2), { courseId: c, method: "PAYPAL" })).rejects.toThrow(/PayPal is not available/);
    expect((await enrolmentOf(2, c)).paymentStatus).toBe("PENDING");
    expect(await startPurchase(db, learner(2), { courseId: c, method: "OFFLINE" })).toEqual({ kind: "OFFLINE" });
  });
});

describe("the short sign-up", () => {
  it("creates a talent account from a name, email, password and the terms, and nothing else", async () => {
    const r = await registerAgentQuick(db, quick(), meta);
    const user = await db.user.findUniqueOrThrow({ where: { id: r.userId }, include: { role: true } });
    expect(user.role.key).toBe("AGENT");
    expect(user.emailVerifiedAt).toBeNull();
    const profile = await db.agentProfile.findUniqueOrThrow({ where: { id: r.agentProfileId }, include: { privateContact: true } });
    expect(profile).toMatchObject({ displayName: "Maria S.", status: "DRAFT", availabilityStatus: "UNAVAILABLE", locationCity: null, locationCountry: null, timezone: null, primaryRole: null, yearsExperience: null });
    expect(profile.privateContact).toMatchObject({ fullLegalName: "Maria Santos", personalEmail: "maria.new@talent.example" });
    expect(r.token).toBeTruthy();
    const accepted = await db.agreementAcceptance.findMany({ where: { userId: r.userId }, include: { agreement: true } });
    expect(accepted.map((a) => a.agreement.type).sort()).toEqual(["PLATFORM_TERMS", "PRIVACY_POLICY"]);
    expect(await db.platformIdentity.count({ where: { userId: r.userId } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "AGENT_REGISTERED", entityId: r.agentProfileId } })).toBe(1);
  });

  it("needs the terms, a real password and a name, like the full form", async () => {
    resetRateLimits();
    await expect(registerAgentQuick(db, quick({ termsAccepted: false, email: "noterms@talent.example" }), meta)).rejects.toMatchObject({ name: "RegistrationError", field: "termsAccepted" });
    expect(() => quickAgentRegistrationSchema.parse({ termsAccepted: true, fullName: "Maria", email: "weak@talent.example", password: "short" })).toThrow();
    expect(() => quickAgentRegistrationSchema.parse({ termsAccepted: true, fullName: "M", email: "x@talent.example", password: PASSWORD })).toThrow();
    expect(() => quickAgentRegistrationSchema.parse({ termsAccepted: true, fullName: "Maria", email: "not-an-email", password: PASSWORD })).toThrow();
    expect(await db.user.count({ where: { email: "noterms@talent.example" } })).toBe(0);
  });

  it("stops a duplicate email the same way the full form does", async () => {
    resetRateLimits();
    await expect(registerAgentQuick(db, quick({ email: "MARIA.NEW@talent.example", fullName: "Maria Again" }), meta)).rejects.toBeInstanceOf(DuplicateDetectedError);
  });

  it("credits the referrer from the referral cookie", async () => {
    resetRateLimits();
    const code = await ensureReferralCode(db, ids.referrer);
    const r = await registerAgentQuick(db, quick({ email: "referred@talent.example", fullName: "Rey Ocampo" }), meta, { referralCode: code });
    expect((await db.user.findUniqueOrThrow({ where: { id: r.userId } })).referredByUserId).toBe(ids.referrer);
    const none = await registerAgentQuick(db, quick({ email: "unreferred@talent.example", fullName: "Una Reyes" }), meta, { referralCode: "nonsense" });
    expect((await db.user.findUniqueOrThrow({ where: { id: none.userId } })).referredByUserId).toBeNull();
  });

  it("the new account's empty profile still loads, and the new talent can buy right away", async () => {
    resetRateLimits();
    const r = await registerAgentQuick(db, quick({ email: "buyer.new@talent.example", fullName: "Cris Dela Cruz" }), meta);
    const actor = makeActor("AGENT", { userId: r.userId, agentProfileId: r.agentProfileId });
    const profile = await getOwnProfile(db, actor);
    // First name and the initial of the last word, the same label used for buyers and clients.
    expect(profile.displayName).toBe("Cris C.");
    const c = await course();
    expect(await startPurchase(db, actor, { courseId: c, method: "PAYPAL" })).toMatchObject({ kind: "REDIRECT" });
    // And it settles like any other PayPal payment.
    const e = await db.courseEnrollment.findFirstOrThrow({ where: { courseId: c, agentProfileId: r.agentProfileId } });
    expect(e.paymentStatus).toBe("PENDING");
  });
});
