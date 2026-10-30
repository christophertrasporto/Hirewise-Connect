import { z } from "zod";
import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { entitledToCourse } from "@/server/policies/lesson-access";
import { publicAcademyRepository } from "@/server/repositories/public-academy.repository";
import { audit } from "@/server/audit/audit";
import { buyerLabel } from "@/lib/coach-wallet";

/**
 * Verified course reviews. One per learner per course (writing again edits it), and only a learner whose access is current
 * (free, paid or waived, not refunded, charged back or revoked) may write one. Readers see the first name and last initial;
 * staff can hide a review with a reason, and a hidden review is left out of the average and the list.
 */

const repo = publicAcademyRepository;

export const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1, "Choose 1 to 5 stars.").max(5, "Choose 1 to 5 stars."),
  body: z.string().trim().max(2000, "Keep the review under 2,000 characters.").optional().or(z.literal("")),
});
export type ReviewInput = z.input<typeof reviewSchema>;

export async function writeReview(db: PrismaClient, actor: Actor, courseId: string, raw: ReviewInput): Promise<string> {
  if (actor.role !== "AGENT" || !actor.agentProfileId) throw new ForbiddenError("Only learners can review a course");
  const input = reviewSchema.parse(raw);
  const course = await repo.findCourseSlugById(db, courseId);
  if (!course || course.status !== "PUBLISHED") throw new NotFoundError();
  const enrollment = await repo.findEnrollmentForReview(db, courseId, actor.agentProfileId);
  if (!entitledToCourse(enrollment)) throw new ForbiddenError("Only learners with access to this course can review it");
  const e = enrollment!;
  return db.$transaction(async (tx) => {
    const existing = await repo.findReviewByEnrollment(tx, e.id);
    const body = input.body || null;
    if (existing) {
      await repo.updateReview(tx, existing.id, { rating: input.rating, body });
      await audit(tx, { actor, action: "REVIEW_POSTED", entityType: "CourseReview", entityId: existing.id, previousValue: { rating: existing.rating }, newValue: { rating: input.rating, edited: true } });
      return existing.id;
    }
    const r = await repo.createReview(tx, { courseId, enrollmentId: e.id, userId: actor.userId, rating: input.rating, body });
    await audit(tx, { actor, action: "REVIEW_POSTED", entityType: "CourseReview", entityId: r.id, newValue: { courseId, rating: input.rating } });
    return r.id;
  });
}

/** Staff hide a review (a reason is required) or show it again. */
export async function hideReview(db: PrismaClient, actor: Actor, reviewId: string, reason: string) {
  authorize(actor, "course.manage");
  const why = reason.trim();
  if (why.length < 5) throw new Error("Give a reason of at least 5 characters.");
  const r = await repo.findReview(db, reviewId);
  if (!r) throw new NotFoundError();
  await db.$transaction(async (tx) => {
    await repo.setReviewHidden(tx, r.id, { hiddenAt: new Date(), hiddenReason: why.slice(0, 500), hiddenById: actor.userId });
    await audit(tx, { actor, action: "REVIEW_HIDDEN", entityType: "CourseReview", entityId: r.id, newValue: { courseId: r.courseId }, reason: why });
  });
}

export async function unhideReview(db: PrismaClient, actor: Actor, reviewId: string) {
  authorize(actor, "course.manage");
  const r = await repo.findReview(db, reviewId);
  if (!r) throw new NotFoundError();
  await db.$transaction(async (tx) => {
    await repo.setReviewHidden(tx, r.id, { hiddenAt: null, hiddenReason: null, hiddenById: null });
    await audit(tx, { actor, action: "REVIEW_UNHIDDEN", entityType: "CourseReview", entityId: r.id, newValue: { courseId: r.courseId } });
  });
}

/** Average of the visible ratings (one decimal) and how many there are. Public; no actor needed. */
export async function courseRatingSummary(db: Db, courseId: string): Promise<{ count: number; average: number | null }> {
  const s = await repo.ratingSummary(db, courseId);
  return { count: s.count, average: s.average === null ? null : Math.round(s.average * 10) / 10 };
}

/** What a reader of the course page sees of each review: stars, text, date, and "Maria S.". Never an id of the learner. */
export async function listCourseReviews(db: Db, courseId: string) {
  const rows = await repo.visibleReviews(db, courseId);
  return rows.map((r) => ({ id: r.id, rating: r.rating, body: r.body, author: buyerLabel(r.enrollment.agentProfile.displayName), createdAt: r.createdAt }));
}

export async function listReviewsForStaff(db: PrismaClient, actor: Actor, courseId: string) {
  authorize(actor, "course.manage");
  const rows = await repo.allReviewsForStaff(db, courseId);
  return rows.map((r) => ({ id: r.id, rating: r.rating, body: r.body, author: buyerLabel(r.enrollment.agentProfile.displayName), createdAt: r.createdAt, hidden: !!r.hiddenAt, hiddenReason: r.hiddenReason }));
}
