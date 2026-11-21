import { purchaseMethod, type PurchaseMethod, type PurchaseStatus } from "@/lib/purchases";

/**
 * What staff see for one purchase. An allow-list: the buyer's professional name and profile link, the course, the money and
 * how it was paid. No email, phone, storage key, gateway payload, or payout detail ever appears here.
 */
type PurchaseRecord = {
  id: string;
  enrolledAt: Date;
  paidAt: Date | null;
  paymentStatus: string;
  currency: string;
  priceCents: number;
  listPriceCents: number | null;
  paidCents: number | null;
  refundedCents: number;
  paymentReference: string | null;
  courseSeatAssignmentId: string | null;
  course: { id: string; title: string };
  agentProfile: { id: string; displayName: string };
  accessCode: { id: string } | null;
  onlinePayments: { provider: string }[];
};

export type PurchaseView = {
  id: string;
  purchasedAt: Date;
  paidAt: Date | null;
  buyerName: string;
  buyerProfileId: string;
  courseId: string;
  courseTitle: string;
  currency: string;
  amountCents: number;
  listPriceCents: number | null;
  paidCents: number | null;
  refundedCents: number;
  status: PurchaseStatus;
  method: PurchaseMethod;
  reference: string | null;
};

export function toPurchaseView(r: PurchaseRecord): PurchaseView {
  return {
    id: r.id,
    purchasedAt: r.enrolledAt,
    paidAt: r.paidAt,
    buyerName: r.agentProfile.displayName,
    buyerProfileId: r.agentProfile.id,
    courseId: r.course.id,
    courseTitle: r.course.title,
    currency: r.currency,
    amountCents: r.priceCents,
    listPriceCents: r.listPriceCents,
    paidCents: r.paidCents,
    refundedCents: r.refundedCents,
    status: r.paymentStatus as PurchaseStatus,
    method: purchaseMethod({ paymentStatus: r.paymentStatus, hasPaidOnlinePayment: r.onlinePayments[0]?.provider ?? null, hasAccessCode: !!r.accessCode, hasCourseSeat: !!r.courseSeatAssignmentId }),
    reference: r.paymentReference,
  };
}

type FailedRecord = {
  id: string;
  provider: string;
  status: string;
  amountMinor: number;
  currency: string;
  failureReason: string | null;
  createdAt: Date;
  enrollment: { course: { id: string; title: string }; agentProfile: { id: string; displayName: string } };
};

export type FailedAttemptView = { id: string; provider: string; status: string; amountMinor: number; currency: string; reason: string | null; at: Date; courseTitle: string; buyerName: string; buyerProfileId: string };

/** A failed or abandoned online attempt. The reason is the gateway's own message, which carries no key or card detail. */
export function toFailedAttemptView(r: FailedRecord): FailedAttemptView {
  return { id: r.id, provider: r.provider, status: r.status, amountMinor: r.amountMinor, currency: r.currency, reason: r.failureReason, at: r.createdAt, courseTitle: r.enrollment.course.title, buyerName: r.enrollment.agentProfile.displayName, buyerProfileId: r.enrollment.agentProfile.id };
}
