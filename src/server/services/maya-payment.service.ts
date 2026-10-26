import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { systemActor } from "@/server/auth/actor";
import { NotFoundError, ForbiddenError } from "@/server/policies/authorize";
import { academyRepository } from "@/server/repositories/academy.repository";
import { onlinePaymentRepository } from "@/server/repositories/online-payment.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { rateLimit } from "@/server/auth/rate-limit";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { getMayaGateway, mayaEnabled, mayaWebhookKeys, type MayaPayment } from "@/server/adapters/maya";
import { verifyMayaSignature } from "@/lib/maya-signature";
import { settleEnrollmentPaymentTx } from "./academy.service";

/**
 * Online course payments through Maya Checkout. The browser, the redirect, and even the webhook body are only hints:
 * every confirmation is decided by looking the payment up at Maya with the secret key (by our reference number) and
 * checking the amount, currency, and reference against the enrolment. A confirmed payment goes through the same
 * settlement staff use for offline payments, so access, audit, and referral commissions behave identically.
 */

const PROVIDER = "MAYA";
const REUSE_WINDOW_MS = 50 * 60_000; // Maya checkouts expire after an hour
const PAID_STATUSES = new Set(["PAYMENT_SUCCESS", "CAPTURED"]);
const NOT_YET_FINAL = ["CREATED", "PENDING"] as const;

/** Whether this course can be paid with Maya: Maya is on, the course costs money, and it is priced in PHP. */
export function mayaAvailableFor(course: { currency: string; priceCents: number }): boolean {
  return mayaEnabled() && course.currency === "PHP" && course.priceCents > 0;
}

const isPaid = (p: MayaPayment) => p.isPaid && PAID_STATUSES.has(p.status);

function appUrl() {
  return getEnv().APP_URL.replace(/\/$/, "");
}

/** Learner starts (or resumes) a Maya checkout for their own pending enrolment. Returns the Maya page to send them to. */
export async function startMayaCheckout(db: PrismaClient, actor: Actor, enrollmentId: string): Promise<{ url: string }> {
  if (actor.role !== "AGENT" || !actor.agentProfileId) throw new ForbiddenError("Only talent pay for courses.");
  if (!mayaEnabled()) throw new Error("Online payment is not available right now. Pay by bank transfer or GCash instead.");
  const e = await academyRepository.findEnrollmentById(db, enrollmentId);
  if (!e || e.agentProfileId !== actor.agentProfileId) throw new NotFoundError();
  if (e.paymentStatus !== "PENDING") throw new Error("This course does not need a payment.");
  if (!mayaAvailableFor({ currency: e.currency, priceCents: e.priceCents })) throw new Error("This course cannot be paid with Maya. Pay by bank transfer or GCash instead.");
  rateLimit(`maya-start:${actor.userId}`, 10, 60 * 60_000);

  const open = await onlinePaymentRepository.findOpen(db, e.id, new Date(Date.now() - REUSE_WINDOW_MS));
  if (open?.redirectUrl) return { url: open.redirectUrl };

  const row = await onlinePaymentRepository.create(db, { provider: PROVIDER, enrollmentId: e.id, amountMinor: e.priceCents, currency: e.currency });
  try {
    const checkout = await getMayaGateway().createCheckout({
      requestReferenceNumber: row.id,
      amountMinor: e.priceCents,
      currency: e.currency,
      description: `Course: ${e.course.title}`,
      successUrl: `${appUrl()}/courses/${e.courseId}?pay=success`,
      failureUrl: `${appUrl()}/courses/${e.courseId}?pay=failed`,
      cancelUrl: `${appUrl()}/courses/${e.courseId}?pay=cancelled`,
    });
    await db.$transaction(async (tx) => {
      await onlinePaymentRepository.update(tx, row.id, { status: "PENDING", checkoutId: checkout.checkoutId, redirectUrl: checkout.redirectUrl });
      await audit(tx, { actor, action: "ONLINE_PAYMENT_STARTED", entityType: "OnlinePayment", entityId: row.id, newValue: { provider: PROVIDER, enrollmentId: e.id, amountMinor: e.priceCents, currency: e.currency } });
    });
    return { url: checkout.redirectUrl };
  } catch (err) {
    logger.error({ err: err instanceof Error ? { name: err.name, message: err.message } : err, onlinePaymentId: row.id }, "maya checkout could not be created");
    await onlinePaymentRepository.update(db, row.id, { status: "FAILED", failureReason: "Could not create the checkout" });
    throw new Error("Maya could not start the payment. Try again in a moment, or pay by bank transfer or GCash.");
  }
}

export type ReconcileResult = { status: "NOT_FOUND" | "PAID" | "PENDING" | "FAILED" | "EXPIRED" | "CANCELLED" | "MISMATCH" | "PROBLEM" };

async function flagProblem(db: Db, row: { id: string; enrollment: { id: string; course: { title: string }; agentProfile: { user: { email: string } } } }, reason: string) {
  await audit(db, { actor: systemActor(), action: "ONLINE_PAYMENT_PROBLEM", entityType: "OnlinePayment", entityId: row.id, newValue: { enrollmentId: row.enrollment.id }, reason });
  await publishEvent(db, "ONLINE_PAYMENT_PROBLEM", { onlinePaymentId: row.id, enrollmentId: row.enrollment.id, courseTitle: row.enrollment.course.title, learnerEmail: row.enrollment.agentProfile.user.email, reason });
}

/**
 * Decides the true state of one payment attempt by asking Maya. Safe to call any number of times, from the webhook, the
 * return page, or the maintenance pass: a payment is settled once, and a payment that is already settled is left alone.
 */
export async function reconcileOnlinePayment(db: PrismaClient, id: string, hint: { signatureValid?: boolean | null; payload?: unknown } = {}): Promise<ReconcileResult> {
  const row = await onlinePaymentRepository.findById(db, id);
  if (!row) return { status: "NOT_FOUND" };
  if (row.status === "PAID" || row.status === "MISMATCH") return { status: row.status };
  if (hint.signatureValid !== undefined || hint.payload !== undefined) await onlinePaymentRepository.update(db, row.id, { signatureValid: hint.signatureValid ?? undefined, lastPayload: hint.payload === undefined ? undefined : (hint.payload as never) });

  const payments = await getMayaGateway().paymentsByReference(row.id);
  const paid = payments.find(isPaid);
  if (!paid) {
    const last = payments[payments.length - 1];
    const terminal = last && ({ PAYMENT_FAILED: "FAILED", PAYMENT_EXPIRED: "EXPIRED", PAYMENT_CANCELLED: "CANCELLED" } as const)[last.status as "PAYMENT_FAILED"];
    if (terminal) {
      await onlinePaymentRepository.transition(db, row.id, [...NOT_YET_FINAL], { status: terminal, failureReason: last.status });
      return { status: terminal };
    }
    return { status: "PENDING" };
  }

  // Maya says it was paid. Trust it only if it is the amount, currency, and reference we asked for.
  const matches = paid.amountMinor === row.amountMinor && paid.currency === row.currency && (paid.requestReferenceNumber ?? row.id) === row.id && row.amountMinor === row.enrollment.priceCents && row.currency === row.enrollment.currency;
  if (!matches) {
    const changed = await onlinePaymentRepository.transition(db, row.id, [...NOT_YET_FINAL, "FAILED", "EXPIRED", "CANCELLED"], { status: "MISMATCH", providerPaymentId: paid.id, failureReason: `Maya reported ${paid.amountMinor} ${paid.currency}, expected ${row.amountMinor} ${row.currency}` });
    if (changed === 1) await flagProblem(db, row, `Maya reported a payment of ${paid.amountMinor ?? "?"} ${paid.currency ?? "?"} for ${row.amountMinor} ${row.currency}. Check it in Maya and handle it manually.`);
    return { status: "MISMATCH" };
  }

  let problem: string | null = null;
  const settled = await db.$transaction(async (tx) => {
    const claimed = await onlinePaymentRepository.transition(tx, row.id, [...NOT_YET_FINAL, "FAILED", "EXPIRED", "CANCELLED"], { status: "PAID", providerPaymentId: paid.id, paidAt: new Date(), failureReason: null });
    if (claimed !== 1) return false;
    const e = await academyRepository.findEnrollmentById(tx, row.enrollmentId);
    if (!e) return true;
    if (e.paymentStatus !== "PENDING") {
      // The money arrived but the enrolment was already settled another way (staff recorded a bank transfer, or it was refunded).
      problem = `Paid online (${paid.id}) but the enrolment is already ${e.paymentStatus.toLowerCase()}. Refund the Maya payment if it is a duplicate.`;
      return true;
    }
    await settleEnrollmentPaymentTx(tx, systemActor(), e, { paidCents: row.amountMinor, reference: `MAYA:${paid.id}`, waived: false, recordedById: null, channel: "MAYA" });
    await audit(tx, { actor: systemActor(), action: "ONLINE_PAYMENT_CONFIRMED", entityType: "OnlinePayment", entityId: row.id, newValue: { provider: PROVIDER, providerPaymentId: paid.id, amountMinor: row.amountMinor, currency: row.currency, enrollmentId: row.enrollmentId } });
    return true;
  });
  if (settled && problem) await flagProblem(db, row, problem);
  return { status: settled && problem ? "PROBLEM" : "PAID" };
}

/** A learner back from Maya (or just opening the course): confirm any open payment of theirs so the course unlocks at once. */
export async function reconcileMyCourse(db: PrismaClient, actor: Actor, courseId: string): Promise<ReconcileResult | null> {
  if (actor.role !== "AGENT" || !actor.agentProfileId || !mayaEnabled()) return null;
  const e = await academyRepository.findEnrollment(db, courseId, actor.agentProfileId);
  if (!e || e.paymentStatus !== "PENDING") return null;
  const open = await onlinePaymentRepository.latestOpenForEnrollment(db, e.id);
  if (!open) return null;
  try {
    return await reconcileOnlinePayment(db, open.id);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? { name: err.name, message: err.message } : err, onlinePaymentId: open.id }, "maya payment could not be confirmed yet");
    return { status: "PENDING" };
  }
}

export type WebhookOutcome = { status: number; body: Record<string, unknown> };

/**
 * Inbound Maya webhook. The signature (RSA-SHA256 with Maya's public keys, 5-minute window) is checked and recorded;
 * with MAYA_WEBHOOK_STRICT=true a bad signature is rejected. Either way nothing is believed from the body: the payment
 * is looked up at Maya before anything changes. Retries are harmless.
 */
export async function handleMayaWebhook(db: PrismaClient, p: { rawBody: string; signature: string | null; timestamp: string | null; ip: string | null }): Promise<WebhookOutcome> {
  if (!mayaEnabled()) return { status: 404, body: { error: "Maya is not enabled" } };
  rateLimit(`maya-webhook:${p.ip ?? "unknown"}`, 300, 60_000);
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(p.rawBody);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    payload = parsed as Record<string, unknown>;
  } catch {
    return { status: 400, body: { error: "Invalid body" } };
  }
  const sig = verifyMayaSignature({ rawBody: p.rawBody, signatureHeader: p.signature, timestampHeader: p.timestamp, publicKeys: mayaWebhookKeys() });
  if (!sig.valid) logger.warn({ reason: sig.reason, ip: p.ip }, "maya webhook signature did not verify");
  if (!sig.valid && getEnv().MAYA_WEBHOOK_STRICT === "true") return { status: 400, body: { error: "Invalid signature" } };

  const rrn = typeof payload.requestReferenceNumber === "string" ? payload.requestReferenceNumber : null;
  const remoteId = typeof payload.id === "string" ? payload.id : null;
  let row = rrn ? await onlinePaymentRepository.findById(db, rrn) : null;
  if (!row && remoteId) row = await onlinePaymentRepository.findByProviderId(db, PROVIDER, remoteId);
  if (!row && remoteId) {
    const looked = await getMayaGateway().paymentById(remoteId).catch(() => null);
    if (looked?.requestReferenceNumber) row = await onlinePaymentRepository.findById(db, looked.requestReferenceNumber);
  }
  if (!row) return { status: 200, body: { received: true, ignored: true } };

  const summary = { id: remoteId, status: payload.status ?? payload.paymentStatus ?? null, isPaid: payload.isPaid ?? null, amount: payload.amount ?? null, currency: payload.currency ?? null, requestReferenceNumber: rrn };
  const result = await reconcileOnlinePayment(db, row.id, { signatureValid: sig.valid, payload: summary });
  return { status: 200, body: { received: true, status: result.status, signature: sig.reason } };
}

/** Maintenance: payments still open after a couple of minutes (a lost or late webhook) are confirmed by lookup. */
export async function reconcilePendingOnlinePayments(db: PrismaClient, now = new Date()): Promise<number> {
  if (!mayaEnabled()) return 0;
  const rows = await onlinePaymentRepository.listToReconcile(db, new Date(now.getTime() - 2 * 60_000), new Date(now.getTime() - 24 * 3_600_000));
  let confirmed = 0;
  for (const r of rows) {
    try {
      if ((await reconcileOnlinePayment(db, r.id)).status === "PAID") confirmed++;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? { name: err.name, message: err.message } : err, onlinePaymentId: r.id }, "maya reconciliation skipped");
    }
  }
  return confirmed;
}
