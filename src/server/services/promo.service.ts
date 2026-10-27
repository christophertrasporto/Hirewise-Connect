import { z } from "zod";
import type { Actor } from "@/server/auth/actor";
import { systemActor } from "@/server/auth/actor";
import type { Db, PrismaClient } from "@/server/db/types";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { rateLimit } from "@/server/auth/rate-limit";
import { academyRepository } from "@/server/repositories/academy.repository";
import { onlinePaymentRepository } from "@/server/repositories/online-payment.repository";
import { promoRepository, type PromoCodeRecord } from "@/server/repositories/promo.repository";
import { trainingRepository } from "@/server/repositories/training.repository";
import { discountLabel, evaluatePromo, isValidCodeFormat, normalizeCode, PROMO_REFUSAL_MESSAGE, type PromoDiscount, type PromoFacts } from "@/lib/promo";
import { formatMoney } from "@/server/views/seat.views";
import { getSetting } from "./setting.service";

/**
 * Course promo codes. A code lowers the enrolment's own price (`priceCents`, with the original kept in
 * `listPriceCents`), so Maya, staff payment recording, the amount-mismatch check, and the referral commission all follow
 * what the learner actually owes. Uses are counted from `PromoRedemption` rows, never stored; the cap is checked under
 * a per-code lock inside the transaction.
 */

export class PromoError extends Error {
  override name = "PromoError";
}
const refused = () => new PromoError(PROMO_REFUSAL_MESSAGE);

// ---------------------------------------------------------------------------
// Staff: create, edit, pause, archive (promo.manage)
// ---------------------------------------------------------------------------

const MANILA = "+08:00";
/** A calendar date typed by staff, read as a Manila date (the business runs on Philippine time). */
function manilaStart(d: string): Date {
  return new Date(`${d}T00:00:00.000${MANILA}`);
}

const dateField = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.").optional().or(z.literal(""));
const moneyField = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 200 or 199.50.");

export const promoInputSchema = z
  .object({
    code: z.string().transform(normalizeCode).refine(isValidCodeFormat, "Use 3 to 32 letters, numbers, or dashes."),
    label: z.string().trim().min(2, "Give the code a name staff will recognise.").max(80),
    discountType: z.enum(["PERCENT", "AMOUNT"]),
    percent: z.string().trim().optional().or(z.literal("")),
    amount: z.string().trim().optional().or(z.literal("")),
    currency: z.enum(["PHP", "USD"]).default("PHP"),
    /** The first day the code works and the last day it works (both inclusive, Manila time). */
    startsOn: dateField,
    endsOn: dateField,
    maxRedemptions: z.string().trim().regex(/^\d*$/, "Whole number.").optional().or(z.literal("")),
    perLearnerLimit: z.string().trim().regex(/^\d+$/, "Whole number.").default("1"),
    minPrice: z.string().trim().optional().or(z.literal("")),
    appliesTo: z.enum(["ALL_COURSES", "SELECTED_COURSES"]).default("ALL_COURSES"),
    courseIds: z.array(z.string()).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.discountType === "PERCENT") {
      const p = Number(v.percent);
      if (!v.percent || !Number.isFinite(p) || p <= 0 || p > 100) ctx.addIssue({ code: "custom", path: ["percent"], message: "Enter a percentage between 0.01 and 100." });
    } else if (!moneyField.safeParse(v.amount ?? "").success || Number(v.amount) <= 0) ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter an amount like 200 or 199.50." });
    if (v.minPrice && !moneyField.safeParse(v.minPrice).success) ctx.addIssue({ code: "custom", path: ["minPrice"], message: "Enter an amount like 500." });
    if (Number(v.perLearnerLimit) < 1) ctx.addIssue({ code: "custom", path: ["perLearnerLimit"], message: "At least 1." });
    if (v.maxRedemptions && Number(v.maxRedemptions) < 1) ctx.addIssue({ code: "custom", path: ["maxRedemptions"], message: "At least 1, or leave empty for no limit." });
    if (v.startsOn && v.endsOn && v.endsOn < v.startsOn) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "The last day is before the first day." });
    if (v.appliesTo === "SELECTED_COURSES" && v.courseIds.length === 0) ctx.addIssue({ code: "custom", path: ["courseIds"], message: "Pick at least one course." });
  });

function rowFromInput(i: z.infer<typeof promoInputSchema>) {
  const day = 86_400_000;
  return {
    label: i.label,
    discountType: i.discountType,
    percentBps: i.discountType === "PERCENT" ? Math.round(Number(i.percent) * 100) : null,
    amountMinor: i.discountType === "AMOUNT" ? Math.round(Number(i.amount) * 100) : null,
    currency: i.discountType === "AMOUNT" ? i.currency : null,
    startsAt: i.startsOn ? manilaStart(i.startsOn) : null,
    // The last day is inclusive: the code stops at the start of the next Manila day.
    endsAt: i.endsOn ? new Date(manilaStart(i.endsOn).getTime() + day) : null,
    maxRedemptions: i.maxRedemptions ? Number(i.maxRedemptions) : null,
    perLearnerLimit: Number(i.perLearnerLimit),
    minPriceMinor: i.minPrice ? Math.round(Number(i.minPrice) * 100) : 0,
    appliesTo: i.appliesTo,
  } as const;
}

function summary(p: PromoCodeRecord) {
  return { code: p.code, label: p.label, discountType: p.discountType, percentBps: p.percentBps, amountMinor: p.amountMinor, currency: p.currency, startsAt: p.startsAt, endsAt: p.endsAt, maxRedemptions: p.maxRedemptions, perLearnerLimit: p.perLearnerLimit, minPriceMinor: p.minPriceMinor, appliesTo: p.appliesTo, courseIds: p.courses.map((c) => c.courseId), status: p.status };
}

async function assertCoursesExist(db: Db, ids: string[]) {
  for (const id of ids) if (!(await academyRepository.findCourse(db, id))) throw new PromoError("One of the selected courses no longer exists.");
}

export async function createPromo(db: PrismaClient, actor: Actor, raw: z.input<typeof promoInputSchema>) {
  authorize(actor, "promo.manage");
  const input = promoInputSchema.parse(raw);
  if (await promoRepository.findByCode(db, input.code)) throw Object.assign(new PromoError("That code already exists."), { field: "code" });
  if (input.appliesTo === "SELECTED_COURSES") await assertCoursesExist(db, input.courseIds);
  return db.$transaction(async (tx) => {
    const p = await promoRepository.create(tx, { code: input.code, ...rowFromInput(input), createdById: actor.userId, courseIds: input.appliesTo === "SELECTED_COURSES" ? input.courseIds : [] });
    await audit(tx, { actor, action: "PROMO_CREATED", entityType: "PromoCode", entityId: p.id, newValue: summary(p) });
    await publishEvent(tx, "PROMO_CHANGED", { promoCodeId: p.id, code: p.code, change: "CREATED" });
    return p;
  });
}

/** Everything but the code itself can change; redemptions already made keep the amounts they were made at. */
export async function updatePromo(db: PrismaClient, actor: Actor, id: string, raw: z.input<typeof promoInputSchema>) {
  authorize(actor, "promo.manage");
  const input = promoInputSchema.parse(raw);
  const before = await promoRepository.findById(db, id);
  if (!before) throw new NotFoundError();
  if (input.code !== before.code) throw Object.assign(new PromoError("A code cannot be renamed. Archive it and create a new one."), { field: "code" });
  if (input.appliesTo === "SELECTED_COURSES") await assertCoursesExist(db, input.courseIds);
  return db.$transaction(async (tx) => {
    const p = await promoRepository.update(tx, id, rowFromInput(input), input.appliesTo === "SELECTED_COURSES" ? input.courseIds : []);
    await audit(tx, { actor, action: "PROMO_UPDATED", entityType: "PromoCode", entityId: id, previousValue: summary(before), newValue: summary(p) });
    await publishEvent(tx, "PROMO_CHANGED", { promoCodeId: id, code: p.code, change: "UPDATED" });
    return p;
  });
}

export async function setPromoStatus(db: PrismaClient, actor: Actor, id: string, status: "ACTIVE" | "PAUSED" | "ARCHIVED") {
  authorize(actor, "promo.manage");
  const before = await promoRepository.findById(db, id);
  if (!before) throw new NotFoundError();
  if (before.status === status) return before;
  if (before.status === "ARCHIVED") throw new PromoError("An archived code cannot be used again. Create a new one.");
  await db.$transaction(async (tx) => {
    await promoRepository.update(tx, id, { status });
    await audit(tx, { actor, action: "PROMO_STATUS_CHANGED", entityType: "PromoCode", entityId: id, previousValue: { status: before.status }, newValue: { status } });
    await publishEvent(tx, "PROMO_CHANGED", { promoCodeId: id, code: before.code, change: status });
  });
}

function toStaffView(p: PromoCodeRecord, usage: { reserved: number; consumed: number; discountGiven: Record<string, number> }, now = new Date()) {
  const live = usage.reserved + usage.consumed;
  const expired = !!p.endsAt && now >= p.endsAt;
  return {
    id: p.id,
    code: p.code,
    label: p.label,
    status: p.status,
    effective: p.status !== "ACTIVE" ? p.status : expired ? "EXPIRED" : p.startsAt && now < p.startsAt ? "SCHEDULED" : p.maxRedemptions !== null && live >= p.maxRedemptions ? "FULLY_USED" : "ACTIVE",
    discount: discountLabel(promoDiscount(p)),
    discountType: p.discountType,
    percent: p.percentBps === null ? "" : String(p.percentBps / 100),
    amount: p.amountMinor === null ? "" : (p.amountMinor / 100).toFixed(2),
    currency: p.currency ?? "PHP",
    startsOn: p.startsAt ? manilaDate(p.startsAt) : "",
    // endsAt is the start of the day after the last day.
    endsOn: p.endsAt ? manilaDate(new Date(p.endsAt.getTime() - 86_400_000)) : "",
    maxRedemptions: p.maxRedemptions,
    perLearnerLimit: p.perLearnerLimit,
    minPrice: p.minPriceMinor ? (p.minPriceMinor / 100).toFixed(2) : "",
    appliesTo: p.appliesTo,
    courses: p.courses.map((c) => ({ id: c.courseId, title: c.course.title })),
    reserved: usage.reserved,
    consumed: usage.consumed,
    remaining: p.maxRedemptions === null ? null : Math.max(0, p.maxRedemptions - live),
    discountGiven: Object.entries(usage.discountGiven).map(([currency, minor]) => ({ currency, minor, label: formatMoney(minor, currency) })),
    createdAt: p.createdAt,
  };
}
export type PromoStaffView = ReturnType<typeof toStaffView>;

function manilaDate(d: Date): string {
  return new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

function promoDiscount(p: Pick<PromoCodeRecord, "discountType" | "percentBps" | "amountMinor" | "currency">): PromoDiscount {
  return p.discountType === "PERCENT" ? { type: "PERCENT", percentBps: p.percentBps ?? 0 } : { type: "AMOUNT", amountMinor: p.amountMinor ?? 0, currency: p.currency ?? "PHP" };
}

export async function listPromos(db: PrismaClient, actor: Actor): Promise<PromoStaffView[]> {
  authorize(actor, "promo.manage");
  const [codes, usage] = await Promise.all([promoRepository.list(db), promoRepository.usageByCode(db)]);
  const by = new Map<string, { reserved: number; consumed: number; discountGiven: Record<string, number> }>();
  for (const u of usage) {
    const e = by.get(u.promoCodeId) ?? { reserved: 0, consumed: 0, discountGiven: {} };
    if (u.status === "RESERVED") e.reserved += u._count._all;
    if (u.status === "CONSUMED") {
      e.consumed += u._count._all;
      e.discountGiven[u.currency] = (e.discountGiven[u.currency] ?? 0) + (u._sum.discountMinor ?? 0);
    }
    by.set(u.promoCodeId, e);
  }
  return codes.map((c) => toStaffView(c, by.get(c.id) ?? { reserved: 0, consumed: 0, discountGiven: {} }));
}

export async function getPromoRedemptions(db: PrismaClient, actor: Actor, id: string) {
  authorize(actor, "promo.manage");
  const p = await promoRepository.findById(db, id);
  if (!p) throw new NotFoundError();
  const rows = await promoRepository.listRedemptions(db, id);
  return rows.map((r) => ({ id: r.id, learner: r.enrollment.agentProfile.displayName, email: r.enrollment.agentProfile.user.email, course: r.enrollment.course.title, status: r.status, listLabel: formatMoney(r.listPriceMinor, r.currency), discountLabel: formatMoney(r.discountMinor, r.currency), finalLabel: formatMoney(r.finalMinor, r.currency), createdAt: r.createdAt, releaseReason: r.releaseReason }));
}

// ---------------------------------------------------------------------------
// Learner: preview, apply, remove
// ---------------------------------------------------------------------------

function ownProfile(actor: Actor): string {
  if (actor.role !== "AGENT" || !actor.agentProfileId) throw new NotFoundError();
  return actor.agentProfileId;
}

function factsOf(p: PromoCodeRecord): PromoFacts {
  return { status: p.status, startsAt: p.startsAt, endsAt: p.endsAt, maxRedemptions: p.maxRedemptions, perLearnerLimit: p.perLearnerLimit, minPriceMinor: p.minPriceMinor, appliesTo: p.appliesTo, courseIds: p.courses.map((c) => c.courseId), discount: promoDiscount(p) };
}

export type PromoQuote = { code: string; label: string; discountLabel: string; currency: string; listMinor: number; discountMinor: number; finalMinor: number; listPrice: string; finalPrice: string };

async function evaluateFor(db: Db, p: PromoCodeRecord, ctx: { userId: string; courseId: string; listMinor: number; currency: string; exceptEnrollmentId?: string; now?: Date }) {
  const [usedTotal, usedByLearner] = await Promise.all([promoRepository.countLive(db, p.id, ctx.exceptEnrollmentId), promoRepository.countLiveForUser(db, p.id, ctx.userId, ctx.exceptEnrollmentId)]);
  return evaluatePromo(factsOf(p), { now: ctx.now ?? new Date(), courseId: ctx.courseId, listMinor: ctx.listMinor, currency: ctx.currency, usedTotal, usedByLearner });
}

function quoteOf(p: PromoCodeRecord, ctx: { listMinor: number; currency: string }, r: { discountMinor: number; finalMinor: number }): PromoQuote {
  return { code: p.code, label: p.label, discountLabel: discountLabel(promoDiscount(p)), currency: ctx.currency, listMinor: ctx.listMinor, discountMinor: r.discountMinor, finalMinor: r.finalMinor, listPrice: formatMoney(ctx.listMinor, ctx.currency), finalPrice: r.finalMinor === 0 ? "Free" : formatMoney(r.finalMinor, ctx.currency) };
}

/** What a code would do to a course's price for this learner, before they enrol. Writes nothing. */
export async function previewPromo(db: PrismaClient, actor: Actor, courseId: string, rawCode: string): Promise<PromoQuote> {
  ownProfile(actor);
  rateLimit(`promo:${actor.userId}`, 20, 60 * 60_000);
  const course = await academyRepository.findCourse(db, courseId);
  if (!course || course.status !== "PUBLISHED") throw new NotFoundError();
  const p = await promoRepository.findByCode(db, normalizeCode(rawCode));
  if (!p) throw refused();
  const r = await evaluateFor(db, p, { userId: actor.userId, courseId, listMinor: course.priceCents, currency: course.currency });
  if (!r.ok) throw refused();
  return quoteOf(p, { listMinor: course.priceCents, currency: course.currency }, r);
}

type EnrollmentPricing = { id: string; courseId: string; agentProfileId: string; priceCents: number; listPriceCents: number | null; currency: string };

/**
 * Applies a code to an unpaid enrolment inside the caller's transaction. Used when enrolling with a code and when a
 * learner adds, changes, or removes one on a pending enrolment. Any open Maya attempt is cancelled locally, because it
 * was created for the old amount; if it is paid anyway, the existing mismatch check flags it for staff.
 */
export async function applyPromoTx(tx: Db, actor: Actor, e: EnrollmentPricing, rawCode: string, now = new Date()): Promise<PromoQuote> {
  const p = await promoRepository.findByCode(tx, normalizeCode(rawCode));
  if (!p) throw refused();
  await promoRepository.lockCode(tx, p.id);
  const listMinor = e.listPriceCents ?? e.priceCents;
  const r = await evaluateFor(tx, p, { userId: actor.userId, courseId: e.courseId, listMinor, currency: e.currency, exceptEnrollmentId: e.id, now });
  if (!r.ok) throw refused();

  const existing = await promoRepository.liveForEnrollment(tx, e.id);
  if (existing?.status === "CONSUMED") throw new PromoError("A promo code was already used on this course.");
  if (existing) {
    await promoRepository.releaseReserved(tx, existing.id, "Replaced by another code");
    await audit(tx, { actor, action: "PROMO_RELEASED", entityType: "PromoRedemption", entityId: existing.id, newValue: { enrollmentId: e.id, code: existing.promoCode.code }, reason: "Replaced by another code" });
    await publishEvent(tx, "PROMO_RELEASED", { promoCodeId: existing.promoCodeId, code: existing.promoCode.code, enrollmentId: e.id, userId: actor.userId, reason: "Replaced by another code" });
  }

  const free = r.finalMinor === 0;
  const row = await promoRepository.createRedemption(tx, { promoCodeId: p.id, enrollmentId: e.id, userId: actor.userId, listPriceMinor: listMinor, discountMinor: r.discountMinor, finalMinor: r.finalMinor, currency: e.currency, consumed: free });
  await academyRepository.setPrice(tx, e.id, { priceCents: r.finalMinor, listPriceCents: listMinor, paymentStatus: free ? "NOT_REQUIRED" : "PENDING" });
  // A course the code makes free is Hirewise-direct access, the same as any free course.
  if (free) await trainingRepository.setEnrollmentSource(tx, e.id, "HIREWISE_DIRECT");
  await onlinePaymentRepository.cancelOpenForEnrollment(tx, e.id, "Price changed by a promo code");
  await audit(tx, { actor, action: "PROMO_REDEEMED", entityType: "PromoRedemption", entityId: row.id, newValue: { code: p.code, enrollmentId: e.id, listMinor, discountMinor: r.discountMinor, finalMinor: r.finalMinor, currency: e.currency, free } });
  await publishEvent(tx, "PROMO_REDEEMED", { promoCodeId: p.id, code: p.code, enrollmentId: e.id, userId: actor.userId, discountMinor: r.discountMinor, finalMinor: r.finalMinor, currency: e.currency });
  return quoteOf(p, { listMinor, currency: e.currency }, r);
}

/** Returns an enrolment to its list price after its reservation ends. Only an unpaid, reserved code can be undone. */
async function releaseTx(tx: Db, actor: Actor, e: EnrollmentPricing, reason: string, userId: string) {
  const live = await promoRepository.liveForEnrollment(tx, e.id);
  if (!live || live.status !== "RESERVED") return false;
  if ((await promoRepository.releaseReserved(tx, live.id, reason)) !== 1) return false;
  await academyRepository.setPrice(tx, e.id, { priceCents: e.listPriceCents ?? e.priceCents, listPriceCents: null, paymentStatus: "PENDING" });
  await onlinePaymentRepository.cancelOpenForEnrollment(tx, e.id, "Price changed by a promo code");
  await audit(tx, { actor, action: "PROMO_RELEASED", entityType: "PromoRedemption", entityId: live.id, newValue: { enrollmentId: e.id, code: live.promoCode.code }, reason });
  await publishEvent(tx, "PROMO_RELEASED", { promoCodeId: live.promoCodeId, code: live.promoCode.code, enrollmentId: e.id, userId, reason });
  return true;
}

async function ownPendingEnrollment(db: Db, actor: Actor, enrollmentId: string) {
  const profileId = ownProfile(actor);
  const e = await academyRepository.findEnrollmentById(db, enrollmentId);
  if (!e || e.agentProfileId !== profileId) throw new NotFoundError();
  if (e.paymentStatus !== "PENDING") throw new PromoError("A code can only be changed while the payment is pending.");
  return e;
}

export async function applyPromoToEnrollment(db: PrismaClient, actor: Actor, enrollmentId: string, rawCode: string): Promise<PromoQuote> {
  rateLimit(`promo:${actor.userId}`, 20, 60 * 60_000);
  const e = await ownPendingEnrollment(db, actor, enrollmentId);
  return db.$transaction((tx) => applyPromoTx(tx, actor, e, rawCode));
}

export async function removePromoFromEnrollment(db: PrismaClient, actor: Actor, enrollmentId: string) {
  const e = await ownPendingEnrollment(db, actor, enrollmentId);
  await db.$transaction(async (tx) => {
    if (!(await releaseTx(tx, actor, e, "Removed by the learner", actor.userId))) throw new PromoError("There is no code to remove.");
  });
}

/** What the learner's course page shows: the live code on this enrolment, if any. */
export async function promoForEnrollment(db: Db, enrollmentId: string) {
  const r = await promoRepository.liveForEnrollment(db, enrollmentId);
  if (!r) return null;
  return { code: r.promoCode.code, label: r.promoCode.label, status: r.status, discountLabel: formatMoney(r.discountMinor, r.currency), listPrice: formatMoney(r.listPriceMinor, r.currency) };
}

/** Called by the one place an enrolment becomes paid or waived: the use is no longer a reservation. */
export async function consumePromoTx(tx: Db, enrollmentId: string) {
  return promoRepository.consumeForEnrollment(tx, enrollmentId);
}

/** Maintenance: reservations on enrolments still unpaid after `promos.reservationDays` give their use back. */
export async function releaseStaleReservations(db: PrismaClient, now = new Date()): Promise<number> {
  const { reservationDays } = await getSetting(db, "promos");
  const stale = await promoRepository.listStaleReservations(db, new Date(now.getTime() - reservationDays * 86_400_000));
  let released = 0;
  for (const r of stale) {
    await db.$transaction(async (tx) => {
      const e = await academyRepository.findEnrollmentById(tx, r.enrollmentId);
      if (!e || e.paymentStatus !== "PENDING") return;
      if (await releaseTx(tx, systemActor(), e, `Unpaid after ${reservationDays} days`, r.userId)) released++;
    });
  }
  return released;
}

/** Courses a code can be limited to (everything but archived), for the staff form. */
export async function listCoursesForPromo(db: PrismaClient, actor: Actor): Promise<Array<{ id: string; title: string; currency: string }>> {
  authorize(actor, "promo.manage");
  const courses = await academyRepository.listCourses(db, { status: ["DRAFT", "PENDING_APPROVAL", "PUBLISHED"] });
  return courses.map((c) => ({ id: c.id, title: c.title, currency: c.currency }));
}
