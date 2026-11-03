import { randomInt } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { accessCodeRepository } from "@/server/repositories/access-code.repository";
import { academyRepository } from "@/server/repositories/academy.repository";
import { UserMessageError } from "@/server/policies/user-message-error";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { rateLimit } from "@/server/auth/rate-limit";
import { sourceForSelfEnrolment } from "@/server/services/credential.service";
import { coursesLockedFor } from "./onboarding.service";
import { settleEnrollmentPaymentTx } from "./academy.service";
import { priceLabel } from "@/server/views/academy.views";

/**
 * Access codes: the way a buyer opens a paid course while Maya is unavailable. Staff who confirmed a bank or GCash payment
 * issue a one-time code for that course; redeeming it records the payment (at the enrolment's price, after any promo code)
 * through `settleEnrollmentPaymentTx`, so the audit entry, the coach earning, the referral commission and the learner's
 * notification are exactly those of a payment recorded by hand. A code is single use, tied to one course, optionally tied to
 * one buyer's email, and expires.
 */

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

/** Every refusal reads the same, so codes cannot be probed for existence, use, expiry or the course they belong to. */
export const ACCESS_CODE_REFUSAL = "This access code isn't valid.";

export class AccessCodeError extends UserMessageError {}
const refused = () => new AccessCodeError(ACCESS_CODE_REFUSAL);

/** HW-XXXX-XXXX from a cryptographically secure source. */
export function generateAccessCode(): string {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `HW-${part()}-${part()}`;
}

/** What a buyer typed, tolerant of case, spaces and missing dashes ("hw k7m2 9xqp"), or "" when it cannot be a code. */
export function normalizeAccessCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^HW[A-Z0-9]{8}$/.test(s) ? `HW-${s.slice(2, 6)}-${s.slice(6)}` : "";
}

export const accessCodeInputSchema = z.object({
  courseId: z.string().min(1, "Choose a course."),
  buyerEmail: z.string().trim().toLowerCase().email("Enter a valid email address.").optional().or(z.literal("")),
  paymentReference: z.string().trim().min(3, "Enter the bank or GCash reference you checked.").max(80),
  expiresInDays: z.coerce.number().int().min(1, "At least 1 day.").max(365, "At most 365 days.").default(30),
  note: z.string().trim().max(200).optional().or(z.literal("")),
});
export type AccessCodeInput = z.input<typeof accessCodeInputSchema>;

export async function createAccessCode(db: PrismaClient, actor: Actor, raw: AccessCodeInput) {
  authorize(actor, "course.payment.record");
  const input = accessCodeInputSchema.parse(raw);
  const course = await academyRepository.findCourse(db, input.courseId);
  if (!course || course.status !== "PUBLISHED") throw new NotFoundError();
  if (course.priceCents <= 0) throw new UserMessageError("This course is free, so it does not need an access code.");
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);
  return db.$transaction(async (tx) => {
    let code = generateAccessCode();
    for (let i = 0; i < 5 && (await accessCodeRepository.findByCode(tx, code)); i++) code = generateAccessCode();
    const row = await accessCodeRepository.create(tx, { code, courseId: course.id, buyerEmail: input.buyerEmail || null, paymentReference: input.paymentReference, note: input.note || null, expiresAt, createdById: actor.userId });
    await audit(tx, { actor, action: "ACCESS_CODE_CREATED", entityType: "AccessCode", entityId: row.id, newValue: { courseId: course.id, buyerEmail: row.buyerEmail, paymentReference: input.paymentReference, expiresAt } });
    return { id: row.id, code: row.code, courseTitle: course.title, expiresAt };
  });
}

export async function voidAccessCode(db: PrismaClient, actor: Actor, id: string, reason: string) {
  authorize(actor, "course.payment.record");
  const why = reason.trim();
  if (why.length < 3) throw new UserMessageError("Give a reason (at least 3 characters).");
  const row = await accessCodeRepository.findById(db, id);
  if (!row) throw new NotFoundError();
  await db.$transaction(async (tx) => {
    if ((await accessCodeRepository.void(tx, id, { voidedById: actor.userId, reason: why.slice(0, 200), now: new Date() })) !== 1) throw new UserMessageError("Only an unused code can be voided.");
    await audit(tx, { actor, action: "ACCESS_CODE_VOIDED", entityType: "AccessCode", entityId: id, reason: why });
  });
}

/** Published courses with a price: the ones a buyer can pay for offline and open with a code. */
export async function listPayableCourses(db: PrismaClient, actor: Actor) {
  authorize(actor, "course.payment.record");
  const rows = await academyRepository.listCourses(db, { status: ["PUBLISHED"] });
  return rows.filter((c) => c.priceCents > 0).map((c) => ({ id: c.id, title: c.title, priceLabel: priceLabel(c.priceCents, c.currency) }));
}

type StaffStatus = "UNUSED" | "REDEEMED" | "VOIDED" | "EXPIRED";

export async function listAccessCodes(db: PrismaClient, actor: Actor) {
  authorize(actor, "course.payment.record");
  const rows = await accessCodeRepository.list(db);
  const users = await accessCodeRepository.userBasics(db, [...new Set(rows.flatMap((r) => [r.createdById, r.redeemedById].filter((x): x is string => !!x)))]);
  const email = new Map(users.map((u) => [u.id, u.email]));
  const now = new Date();
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    courseId: r.courseId,
    courseTitle: r.course.title,
    buyerEmail: r.buyerEmail,
    paymentReference: r.paymentReference,
    note: r.note,
    status: (r.status === "UNUSED" && r.expiresAt <= now ? "EXPIRED" : r.status) as StaffStatus,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    createdBy: email.get(r.createdById) ?? null,
    redeemedBy: r.redeemedById ? email.get(r.redeemedById) ?? null : null,
    redeemedAt: r.redeemedAt,
    voidReason: r.voidReason,
  }));
}
export type AccessCodeStaffView = Awaited<ReturnType<typeof listAccessCodes>>[number];

/**
 * A learner redeems a code. If they have no enrolment in the code's course yet, one is created; if they have a pending one,
 * that one is settled. Any failure rolls everything back, so a refused code enrols nobody and uses nothing up.
 */
export async function redeemAccessCode(db: PrismaClient, actor: Actor, rawCode: string, courseId?: string): Promise<{ courseId: string }> {
  if (actor.role !== "AGENT" || !actor.agentProfileId) throw new ForbiddenError("Only talent can redeem an access code");
  rateLimit(`access-code:${actor.userId}`, 10, 60 * 60_000);
  const profileId = actor.agentProfileId;
  const normalized = normalizeAccessCode(rawCode);
  if (!normalized) throw refused();
  const code = await accessCodeRepository.findByCode(db, normalized);
  const now = new Date();
  if (!code || code.status !== "UNUSED" || code.expiresAt <= now) throw refused();
  if (courseId && code.courseId !== courseId) throw refused();
  if (code.buyerEmail) {
    const me = await accessCodeRepository.buyerEmail(db, actor.userId);
    if (!me || me.email.toLowerCase() !== code.buyerEmail) throw refused();
  }
  const course = await academyRepository.findCourse(db, code.courseId);
  if (!course || course.status !== "PUBLISHED") throw refused();

  // Same onboarding rule as enrolling by hand: a new enrolment waits for the welcome video when staff require it.
  if (!(await academyRepository.findEnrollment(db, course.id, profileId))) {
    const lock = await coursesLockedFor(db, actor);
    if (lock.locked) throw new ForbiddenError(lock.reason ?? "Finish your onboarding checklist before enrolling.");
  }

  await db.$transaction(async (tx) => {
    let enrollment = await academyRepository.findEnrollment(tx, course.id, profileId);
    if (enrollment && enrollment.paymentStatus !== "PENDING") {
      throw new AccessCodeError(enrollment.paymentStatus === "REFUNDED" ? "This enrolment was refunded. Contact Hirewise." : "You already have access to this course.");
    }
    if (!enrollment) {
      const created = await academyRepository.enroll(tx, { currency: course.currency, courseId: course.id, agentProfileId: profileId, priceCents: course.priceCents, credentialSource: sourceForSelfEnrolment(course.priceCents) });
      await audit(tx, { actor, action: "COURSE_ENROLLED", entityType: "CourseEnrollment", entityId: created.id, newValue: { courseId: course.id, priceCents: course.priceCents, via: "ACCESS_CODE" } });
      await publishEvent(tx, "COURSE_ENROLLED", { courseId: course.id, title: course.title, agentProfileId: profileId, agentUserId: actor.userId, coachUserIds: [course.ownerCoachUserId, ...course.coaches.map((x) => x.coachUserId)], paymentRequired: false, priceCents: course.priceCents });
      enrollment = await academyRepository.findEnrollment(tx, course.id, profileId);
    }
    const e = await academyRepository.findEnrollmentById(tx, enrollment!.id);
    if (!e || e.priceCents <= 0) throw new AccessCodeError("You already have access to this course.");
    // Single use: the claim is the gate. Losing the race (or an expiry in between) throws and undoes the enrolment above.
    if ((await accessCodeRepository.claim(tx, code.id, { redeemedById: actor.userId, enrollmentId: e.id, now })) !== 1) throw refused();
    await settleEnrollmentPaymentTx(tx, actor, e, { paidCents: e.priceCents, reference: code.paymentReference, waived: false, reason: `Access code ${code.code}`, recordedById: code.createdById, channel: "STAFF" });
    await audit(tx, { actor, action: "ACCESS_CODE_REDEEMED", entityType: "AccessCode", entityId: code.id, newValue: { courseId: course.id, enrollmentId: e.id, paidMinor: e.priceCents, currency: e.currency } });
  });
  return { courseId: course.id };
}
