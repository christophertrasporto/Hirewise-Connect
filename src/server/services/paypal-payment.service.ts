import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { NotFoundError, ForbiddenError } from "@/server/policies/authorize";
import { UserMessageError } from "@/server/policies/user-message-error";
import { academyRepository } from "@/server/repositories/academy.repository";
import { onlinePaymentRepository } from "@/server/repositories/online-payment.repository";
import { audit } from "@/server/audit/audit";
import { rateLimit } from "@/server/auth/rate-limit";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { getPayPalGateway, paypalEnabled, PAYPAL_CURRENCIES, type PayPalWebhookHeaders } from "@/server/adapters/paypal";
import { NOT_YET_FINAL, flagProblem, settleConfirmedPayment, type ReconcileResult } from "./online-payment.service";

/**
 * Online course payments through PayPal Checkout. As with Maya, the browser, the redirect, and even the webhook body are
 * only hints: every confirmation is decided by looking the order up at PayPal with the secret key and checking the
 * amount, currency, and reference against the enrolment. PayPal differs in one way: approving does not take the money, so
 * an approved order is CAPTURED here (idempotently) before it is read back. A confirmed payment goes through the shared
 * settlement staff and Maya use, and PayPal's own fee comes with it, so the coach's earning needs no fee entry.
 */

const PROVIDER = "PAYPAL";
const REUSE_WINDOW_MS = 50 * 60_000;

/** Whether this course can be paid with PayPal: PayPal is on, the course costs money, and its currency is one PayPal takes here. */
export function paypalAvailableFor(course: { currency: string; priceCents: number }): boolean {
  return paypalEnabled() && course.priceCents > 0 && (PAYPAL_CURRENCIES as readonly string[]).includes(course.currency);
}

function appUrl() {
  return getEnv().APP_URL.replace(/\/$/, "");
}

/** Learner starts (or resumes) a PayPal checkout for their own pending enrolment. Returns the PayPal page to send them to. */
export async function startPayPalCheckout(db: PrismaClient, actor: Actor, enrollmentId: string): Promise<{ url: string }> {
  if (actor.role !== "AGENT" || !actor.agentProfileId) throw new ForbiddenError("Only talent pay for courses.");
  if (!paypalEnabled()) throw new UserMessageError("PayPal is not available right now. Pay by bank transfer or GCash instead.");
  const e = await academyRepository.findEnrollmentById(db, enrollmentId);
  if (!e || e.agentProfileId !== actor.agentProfileId) throw new NotFoundError();
  if (e.paymentStatus !== "PENDING") throw new UserMessageError("This course does not need a payment.");
  if (!paypalAvailableFor({ currency: e.currency, priceCents: e.priceCents })) throw new UserMessageError("This course cannot be paid with PayPal. Pay by bank transfer or GCash instead.");
  rateLimit(`paypal-start:${actor.userId}`, 10, 60 * 60_000);

  const open = await onlinePaymentRepository.findOpen(db, e.id, new Date(Date.now() - REUSE_WINDOW_MS), PROVIDER);
  if (open?.redirectUrl) return { url: open.redirectUrl };

  const row = await onlinePaymentRepository.create(db, { provider: PROVIDER, enrollmentId: e.id, amountMinor: e.priceCents, currency: e.currency });
  try {
    const order = await getPayPalGateway().createOrder({
      referenceNumber: row.id,
      amountMinor: e.priceCents,
      currency: e.currency,
      description: `Course: ${e.course.title}`,
      returnUrl: `${appUrl()}/courses/${e.courseId}?pay=success`,
      cancelUrl: `${appUrl()}/courses/${e.courseId}?pay=cancelled`,
    });
    await db.$transaction(async (tx) => {
      await onlinePaymentRepository.update(tx, row.id, { status: "PENDING", checkoutId: order.orderId, redirectUrl: order.redirectUrl });
      await audit(tx, { actor, action: "ONLINE_PAYMENT_STARTED", entityType: "OnlinePayment", entityId: row.id, newValue: { provider: PROVIDER, enrollmentId: e.id, amountMinor: e.priceCents, currency: e.currency } });
    });
    return { url: order.redirectUrl };
  } catch (err) {
    logger.error({ err: err instanceof Error ? { name: err.name, message: err.message } : err, onlinePaymentId: row.id }, "paypal order could not be created");
    await onlinePaymentRepository.update(db, row.id, { status: "FAILED", failureReason: "Could not create the order" });
    throw new UserMessageError("PayPal could not start the payment. Try again in a moment, or pay by bank transfer or GCash.");
  }
}

/**
 * Decides the true state of one PayPal attempt by asking PayPal, capturing an approved order first. Safe to call any number
 * of times, from the webhook, the return page, or the maintenance pass: a payment is settled once, and a payment that is
 * already settled is left alone.
 */
export async function reconcilePayPalPayment(db: PrismaClient, id: string, hint: { signatureValid?: boolean | null; payload?: unknown } = {}): Promise<ReconcileResult> {
  const row = await onlinePaymentRepository.findById(db, id);
  if (!row || row.provider !== PROVIDER) return { status: "NOT_FOUND" };
  if (row.status === "PAID" || row.status === "MISMATCH") return { status: row.status };
  if (hint.signatureValid !== undefined || hint.payload !== undefined) await onlinePaymentRepository.update(db, row.id, { signatureValid: hint.signatureValid ?? undefined, lastPayload: hint.payload === undefined ? undefined : (hint.payload as never) });
  if (!row.checkoutId) return { status: "PENDING" };

  const gateway = getPayPalGateway();
  let order = await gateway.getOrder(row.checkoutId);
  if (!order) return { status: "PENDING" };
  if (order.state === "APPROVED") order = await gateway.captureOrder(row.checkoutId, `capture-${row.id}`);

  switch (order.state) {
    case "PAID":
      return settleConfirmedPayment(db, row, PROVIDER, { providerPaymentId: order.captureId ?? order.orderId, amountMinor: order.amountMinor, currency: order.currency, reference: order.reference, feeMinor: order.feeMinor });
    case "FAILED": {
      await onlinePaymentRepository.transition(db, row.id, [...NOT_YET_FINAL], { status: "FAILED", failureReason: "PayPal declined or voided the order" });
      return { status: "FAILED" };
    }
    case "REFUNDED": {
      // Paid and refunded before we ever settled it: nothing to unlock, but staff should know money moved.
      const changed = await onlinePaymentRepository.transition(db, row.id, [...NOT_YET_FINAL], { status: "FAILED", failureReason: "Refunded at PayPal before it was confirmed", providerPaymentId: order.captureId ?? order.orderId });
      if (changed === 1) await flagProblem(db, row, "PayPal reports this payment was refunded before the course was unlocked. No access was given. Check it in PayPal.");
      return { status: "FAILED" };
    }
    default:
      return { status: "PENDING" };
  }
}

/** A learner back from PayPal (or just opening the course): capture and confirm any open payment of theirs so the course unlocks at once. */
export async function reconcileMyPayPalPayment(db: PrismaClient, actor: Actor, courseId: string): Promise<ReconcileResult | null> {
  if (actor.role !== "AGENT" || !actor.agentProfileId || !paypalEnabled()) return null;
  const e = await academyRepository.findEnrollment(db, courseId, actor.agentProfileId);
  if (!e || e.paymentStatus !== "PENDING") return null;
  const open = await onlinePaymentRepository.latestOpenForEnrollment(db, e.id, PROVIDER);
  if (!open) return null;
  try {
    return await reconcilePayPalPayment(db, open.id);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? { name: err.name, message: err.message } : err, onlinePaymentId: open.id }, "paypal payment could not be confirmed yet");
    return { status: "PENDING" };
  }
}

export type WebhookOutcome = { status: number; body: Record<string, unknown> };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * Inbound PayPal webhook. PayPal's own verify-signature call checks it came from PayPal and the result is recorded; with
 * PAYPAL_WEBHOOK_STRICT=true a bad signature is rejected. Either way nothing is believed from the body: the order is looked
 * up at PayPal before anything changes. A refund event for a payment we settled raises a flag for staff and changes nothing
 * by itself (staff record the refund in the app). Retries are harmless.
 */
export async function handlePayPalWebhook(db: PrismaClient, p: { rawBody: string; headers: PayPalWebhookHeaders; ip: string | null }): Promise<WebhookOutcome> {
  if (!paypalEnabled()) return { status: 404, body: { error: "PayPal is not enabled" } };
  rateLimit(`paypal-webhook:${p.ip ?? "unknown"}`, 300, 60_000);
  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(p.rawBody);
    const o = obj(parsed);
    if (!o) throw new Error("not an object");
    event = o;
  } catch {
    return { status: 400, body: { error: "Invalid body" } };
  }
  let signatureValid = false;
  try {
    signatureValid = await getPayPalGateway().verifyWebhook(p.headers, event);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? { name: err.name, message: err.message } : err }, "paypal webhook signature could not be checked");
  }
  if (!signatureValid) logger.warn({ ip: p.ip }, "paypal webhook signature did not verify");
  if (!signatureValid && getEnv().PAYPAL_WEBHOOK_STRICT === "true") return { status: 400, body: { error: "Invalid signature" } };

  const type = str(event.event_type) ?? "";
  const resource = obj(event.resource) ?? {};
  const orderId = str(obj(obj(resource.supplementary_data)?.related_ids)?.order_id) ?? (type.startsWith("CHECKOUT.ORDER") ? str(resource.id) : null);
  const reference = str(resource.custom_id) ?? str(obj((Array.isArray(resource.purchase_units) ? resource.purchase_units[0] : null))?.custom_id);
  let row = reference ? await onlinePaymentRepository.findById(db, reference) : null;
  if (row && row.provider !== PROVIDER) row = null;
  if (!row && orderId) row = await onlinePaymentRepository.findByProviderId(db, PROVIDER, orderId);
  if (!row) return { status: 200, body: { received: true, ignored: true } };

  const summary = { eventType: type, eventId: str(event.id), resourceId: str(resource.id), status: str(resource.status), signatureValid };
  if (type === "PAYMENT.CAPTURE.REFUNDED" && row.status === "PAID") {
    const already = obj(row.lastPayload)?.eventType === "PAYMENT.CAPTURE.REFUNDED";
    await onlinePaymentRepository.update(db, row.id, { signatureValid, lastPayload: summary });
    if (!already) await flagProblem(db, row, "PayPal reports this payment was refunded. Record the refund in Staff, Academy, Payments so access, the coach wallet, and the referral commission are reversed.");
    return { status: 200, body: { received: true, status: "REFUND_FLAGGED" } };
  }
  const result = await reconcilePayPalPayment(db, row.id, { signatureValid, payload: summary });
  return { status: 200, body: { received: true, status: result.status } };
}

/** Maintenance: payments still open after a couple of minutes (a lost or late webhook, a closed tab) are confirmed by lookup. */
export async function reconcilePendingPayPalPayments(db: PrismaClient, now = new Date()): Promise<number> {
  if (!paypalEnabled()) return 0;
  const rows = await onlinePaymentRepository.listToReconcile(db, new Date(now.getTime() - 2 * 60_000), new Date(now.getTime() - 24 * 3_600_000), 25, PROVIDER);
  let confirmed = 0;
  for (const r of rows) {
    try {
      if ((await reconcilePayPalPayment(db, r.id)).status === "PAID") confirmed++;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? { name: err.name, message: err.message } : err, onlinePaymentId: r.id }, "paypal reconciliation skipped");
    }
  }
  return confirmed;
}
