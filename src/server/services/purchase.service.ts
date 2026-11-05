import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { UserMessageError } from "@/server/policies/user-message-error";
import { entitledToCourse } from "@/server/policies/lesson-access";
import { academyRepository } from "@/server/repositories/academy.repository";
import { enrol } from "./academy.service";
import { startMayaCheckout } from "./maya-payment.service";
import { startPayPalCheckout } from "./paypal-payment.service";

/**
 * The one-press purchase behind the checkout screen (`/courses/<id>/buy`): enrol the learner (with a promo code, when
 * given), then start the chosen checkout. It adds no new way to become paid: an enrolment is settled only by a verified
 * payment or by staff, exactly as before, and a free course (or a promo that makes it free) opens at once.
 *
 * If the checkout cannot be created, the learner is left with a pending enrolment and nothing charged, and can try again
 * from this screen or the course page.
 */

export type PurchaseMethod = "MAYA" | "PAYPAL" | "OFFLINE";
export type PurchaseResult =
  /** Send the learner to the gateway. */
  | { kind: "REDIRECT"; url: string }
  /** The course is theirs (free, a free promo result, or already paid): open it. */
  | { kind: "OPEN_COURSE" }
  /** They chose to pay Hirewise offline: the course page shows the bank transfer and GCash instructions. */
  | { kind: "OFFLINE" };

export async function startPurchase(db: PrismaClient, actor: Actor, p: { courseId: string; promoCode?: string; method: PurchaseMethod }): Promise<PurchaseResult> {
  if (actor.role !== "AGENT" || !actor.agentProfileId) throw new ForbiddenError("Only talent buy courses.");
  await enrol(db, actor, p.courseId, p.promoCode);
  const e = await academyRepository.findEnrollment(db, p.courseId, actor.agentProfileId);
  if (!e) throw new NotFoundError();
  if (entitledToCourse(e)) return { kind: "OPEN_COURSE" };
  if (e.paymentStatus !== "PENDING") throw new UserMessageError("Your access to this course has ended. Contact your account manager.");
  if (p.method === "OFFLINE") return { kind: "OFFLINE" };
  const { url } = p.method === "MAYA" ? await startMayaCheckout(db, actor, e.id) : await startPayPalCheckout(db, actor, e.id);
  return { kind: "REDIRECT", url };
}
