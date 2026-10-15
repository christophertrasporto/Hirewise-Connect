import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { scopedAgencyId, requireActiveAgency } from "@/server/policies/ownership";
import { trainingRepository } from "@/server/repositories/training.repository";
import { membershipRepository } from "@/server/repositories/membership.repository";
import { academyRepository } from "@/server/repositories/academy.repository";
import { agencyRepository } from "@/server/repositories/agency.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { toCourseCatalogView, toCoursePurchaseView, toMemberTrainingView } from "@/server/views/training.views";

/**
 * Agency training (v2 phase 4): the catalog, Course Seats bought per course and recorded by Hirewise, assignment to
 * members (which creates an agency-sponsored enrollment), and the agency's view of its members' progress and
 * credentials with their source and status.
 */

export class CourseSeatError extends Error {
  readonly name = "SeatCapacityError";
  readonly status = 409;
}

async function agencyOrThrow(db: PrismaClient, agencyId: string) {
  const a = await agencyRepository.findAgency(db, agencyId);
  if (!a) throw new NotFoundError();
  return a;
}

export async function trainingCatalog(db: PrismaClient, actor: Actor, requestedAgencyId?: string) {
  const agencyId = scopedAgencyId(actor, requestedAgencyId, "agency.read");
  if (!actor.permissions.has("agency.read")) authorize(actor, "agency.training.read");
  const [courses, seats, purchases] = await Promise.all([trainingRepository.publishedCourses(db), trainingRepository.seatsByCourse(db, agencyId), trainingRepository.listPurchases(db, { agencyId }, 50)]);
  return { agencyId, courses: courses.map((c) => toCourseCatalogView(c, seats[c.id])), purchases: purchases.map(toCoursePurchaseView) };
}

export async function agencyTrainingOverview(db: PrismaClient, actor: Actor, requestedAgencyId?: string) {
  const agencyId = scopedAgencyId(actor, requestedAgencyId, "agency.read");
  if (!actor.permissions.has("agency.read")) authorize(actor, "agency.training.read");
  return (await trainingRepository.memberTraining(db, agencyId)).map((m) => toMemberTrainingView(m, agencyId));
}

export const coursePurchaseSchema = z.object({
  courseId: z.string().min(1),
  seatCount: z.coerce.number().int().min(1, "Buy at least one course seat.").max(500),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function purchaseCourseSeats(db: PrismaClient, actor: Actor, raw: z.input<typeof coursePurchaseSchema>) {
  authorize(actor, "agency.training.purchase");
  const agencyId = requireActiveAgency(actor);
  const input = coursePurchaseSchema.parse(raw);
  const course = await trainingRepository.course(db, input.courseId);
  if (!course || course.status !== "PUBLISHED") throw new NotFoundError("Course not found");
  if (course.priceCents === 0) throw new ForbiddenError("This course is free: assign it to members directly, no purchase needed.");
  const agency = await agencyOrThrow(db, agencyId);
  return db.$transaction(async (tx) => {
    const p = await trainingRepository.createPurchase(tx, { agencyId, courseId: course.id, seatCount: input.seatCount, amountMinor: course.priceCents * input.seatCount, currency: "USD", requestedById: actor.userId, note: input.note || null });
    await audit(tx, { actor, action: "COURSE_PURCHASE_CREATED", entityType: "CoursePurchase", entityId: p.id, newValue: { agencyId, courseId: course.id, seatCount: input.seatCount, amountMinor: p.amountMinor } });
    await publishEvent(tx, "COURSE_PURCHASE_CREATED", { purchaseId: p.id, agencyId, agencyName: agency.name, courseTitle: course.title, seatCount: input.seatCount, amountMinor: p.amountMinor, currency: "USD" });
    return toCoursePurchaseView(p);
  });
}

export const purchaseOutcomeSchema = z.object({
  outcome: z.enum(["PAID", "WAIVED", "CANCELLED"]),
  reference: z.string().trim().max(120).optional().or(z.literal("")),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function recordCoursePurchase(db: PrismaClient, actor: Actor, id: string, raw: z.input<typeof purchaseOutcomeSchema>) {
  authorize(actor, "agency.seats.manage");
  const input = purchaseOutcomeSchema.parse(raw);
  const p = await trainingRepository.findPurchase(db, id);
  if (!p) throw new NotFoundError();
  if (p.status !== "PENDING") throw new ForbiddenError("This purchase was already recorded.");
  if (input.outcome === "PAID" && !input.reference) throw Object.assign(new Error("Enter the payment reference."), { name: "RegistrationError", field: "reference" });
  return db.$transaction(async (tx) => {
    const updated = await trainingRepository.recordPurchase(tx, p.id, { status: input.outcome, recordedById: actor.userId, paymentReference: input.reference || null, note: input.note || null, paidAt: input.outcome === "PAID" ? new Date() : null });
    await audit(tx, { actor, action: "COURSE_PURCHASE_RECORDED", entityType: "CoursePurchase", entityId: p.id, previousValue: { status: "PENDING" }, newValue: { status: input.outcome, reference: input.reference || null }, reason: input.note || undefined });
    await publishEvent(tx, "COURSE_PURCHASE_RECORDED", { purchaseId: p.id, agencyId: p.agencyId, agencyName: p.agency.name, ownerUserId: p.agency.ownerUserId, ownerEmail: p.agency.owner.email, courseTitle: p.course.title, seatCount: p.seatCount, outcome: input.outcome });
    return toCoursePurchaseView(updated);
  });
}

export async function listCoursePurchases(db: PrismaClient, actor: Actor, status?: "PENDING" | "PAID" | "WAIVED" | "CANCELLED") {
  authorize(actor, "agency.read");
  const [rows, counts] = await Promise.all([trainingRepository.listPurchases(db, { status }), trainingRepository.purchaseCounts(db)]);
  return { rows: rows.map(toCoursePurchaseView), counts };
}

export const assignCourseSchema = z.object({ courseId: z.string().min(1), agentProfileId: z.string().min(1) });

/** Gives a member a Course Seat: an agency-sponsored enrollment, paid by the agency's purchase (or free). */
export async function assignCourse(db: PrismaClient, actor: Actor, raw: z.input<typeof assignCourseSchema>) {
  authorize(actor, "agency.training.assign");
  const agencyId = requireActiveAgency(actor);
  const input = assignCourseSchema.parse(raw);
  const [course, membership, agency] = await Promise.all([trainingRepository.course(db, input.courseId), membershipRepository.openForProfile(db, input.agentProfileId), agencyOrThrow(db, agencyId)]);
  if (!course || course.status !== "PUBLISHED") throw new NotFoundError("Course not found");
  if (!membership || membership.agencyId !== agencyId) throw new NotFoundError("Member not found");
  if (await academyRepository.findEnrollment(db, course.id, input.agentProfileId)) throw new ForbiddenError(`${membership.agentProfile.displayName} is already enrolled in ${course.title}.`);
  let purchaseId: string | null = null;
  if (course.priceCents > 0) {
    const capacity = await trainingRepository.purchasesWithCapacity(db, agencyId, course.id);
    if (!capacity.length) throw new CourseSeatError(`No Course Seats left for ${course.title}. Buy more seats first.`);
    purchaseId = capacity[0].id;
  }
  return db.$transaction(async (tx) => {
    const assignment = await trainingRepository.createAssignment(tx, { coursePurchaseId: purchaseId, agencyId, courseId: course.id, agentProfileId: input.agentProfileId, assignedById: actor.userId });
    const e = await trainingRepository.createSponsoredEnrollment(tx, { courseId: course.id, agentProfileId: input.agentProfileId, priceCents: course.priceCents, sponsoringAgencyId: agencyId, courseSeatAssignmentId: assignment.id });
    await trainingRepository.linkAssignmentEnrollment(tx, assignment.id, e.id);
    await audit(tx, { actor, action: "COURSE_SEAT_ASSIGNED", entityType: "CourseSeatAssignment", entityId: assignment.id, newValue: { agencyId, courseId: course.id, agentProfileId: input.agentProfileId, enrollmentId: e.id, purchaseId } });
    await audit(tx, { actor, action: "COURSE_ENROLLED", entityType: "CourseEnrollment", entityId: e.id, newValue: { courseId: course.id, priceCents: course.priceCents, paymentStatus: e.paymentStatus, credentialSource: "AGENCY_SPONSORED", sponsoringAgencyId: agencyId } });
    await publishEvent(tx, "COURSE_ENROLLED", { courseId: course.id, title: course.title, agentProfileId: input.agentProfileId, agentUserId: membership.agentProfile.userId, coachUserIds: [course.ownerCoachUserId, ...course.coaches.map((c) => c.coachUserId)], paymentRequired: false, priceCents: course.priceCents });
    await publishEvent(tx, "COURSE_SEAT_ASSIGNED", { assignmentId: assignment.id, agencyId, agencyName: agency.name, courseTitle: course.title, agentUserId: membership.agentProfile.userId, agentEmail: membership.agentProfile.user.email, displayName: membership.agentProfile.displayName });
    return { assignmentId: assignment.id, enrollmentId: e.id };
  });
}
