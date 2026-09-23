import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/server/env";

/**
 * Payment provider behind an interface (Section 8.6, ASSUMPTION A5; Section 14 Q8).
 * - manual: staff record offline payments (Phase 4).
 * - fake: local stand-in that "pays" through a dev-only route, for demos and tests.
 * - stripe: Stripe Checkout Sessions via the REST API; the webhook records the payment.
 * Recording always goes through billing.service so the deposit and placement stay consistent.
 */
export type CheckoutRequest = { invoiceId: string; number: string; amount: number; currency: string; description: string; clientEmail: string | null; successUrl: string; cancelUrl: string };
export type Checkout = { url: string; sessionId: string };
export type WebhookEvent = { type: string; sessionId: string | null; invoiceId: string | null; amount: number | null; currency: string | null; reference: string | null; raw: unknown };

export interface PaymentProvider {
  readonly name: "manual" | "fake" | "stripe";
  /** Hosted checkout for online payment, or null when the provider has none. */
  createCheckout(req: CheckoutRequest): Promise<Checkout | null>;
  /** Verify and parse an inbound webhook. Throws on a bad signature. */
  parseWebhook(rawBody: string, signature: string | null): WebhookEvent;
  /** Instructions shown to the client on an unpaid invoice. */
  paymentInstructions(): string;
}

export class ManualPaymentProvider implements PaymentProvider {
  readonly name = "manual" as const;
  async createCheckout(): Promise<null> {
    return null;
  }
  parseWebhook(): never {
    throw new Error("The manual provider has no webhook.");
  }
  paymentInstructions() {
    return "Pay by bank transfer or PayPal using the invoice number as the reference. Your account manager records the payment, usually within one business day.";
  }
}

/** Local fake: checkout goes to an in-app route that records the payment (dev and tests only). */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake" as const;
  readonly sessions: CheckoutRequest[] = [];
  async createCheckout(req: CheckoutRequest): Promise<Checkout> {
    this.sessions.push(req);
    const sessionId = `fake_${req.invoiceId}`;
    return { url: `${getEnv().APP_URL}/api/payments/fake/${req.invoiceId}?session=${sessionId}`, sessionId };
  }
  parseWebhook(rawBody: string): WebhookEvent {
    const json = JSON.parse(rawBody) as { invoiceId: string; amount: number; currency: string; sessionId: string };
    return { type: "checkout.session.completed", sessionId: json.sessionId, invoiceId: json.invoiceId, amount: json.amount, currency: json.currency, reference: json.sessionId, raw: json };
  }
  paymentInstructions() {
    return "Pay online with the button above (local fake provider), or by bank transfer using the invoice number as the reference.";
  }
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  constructor(private secretKey: string, private webhookSecret: string) {}

  async createCheckout(req: CheckoutRequest): Promise<Checkout> {
    const form = new URLSearchParams({
      mode: "payment",
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": req.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(req.amount),
      "line_items[0][price_data][product_data][name]": `Invoice ${req.number}`,
      "line_items[0][price_data][product_data][description]": req.description.slice(0, 500),
      "metadata[invoiceId]": req.invoiceId,
      client_reference_id: req.invoiceId,
      ...(req.clientEmail ? { customer_email: req.clientEmail } : {}),
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
    if (!res.ok) throw new Error(`Stripe checkout failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { id: string; url: string };
    return { url: json.url, sessionId: json.id };
  }

  /** Stripe-Signature: t=<ts>,v1=<hmac_sha256(webhookSecret, `${ts}.${rawBody}`)>. */
  parseWebhook(rawBody: string, signature: string | null): WebhookEvent {
    if (!signature) throw new Error("Missing Stripe-Signature");
    const parts = Object.fromEntries(signature.split(",").map((kv) => kv.split("=") as [string, string]));
    const ts = parts.t;
    const v1 = parts.v1;
    if (!ts || !v1) throw new Error("Malformed Stripe-Signature");
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw new Error("Stale webhook");
    const expected = createHmac("sha256", this.webhookSecret).update(`${ts}.${rawBody}`).digest("hex");
    if (expected.length !== v1.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(v1))) throw new Error("Bad Stripe signature");
    const event = JSON.parse(rawBody) as { type: string; data: { object: { id: string; amount_total?: number; currency?: string; payment_intent?: string; metadata?: { invoiceId?: string }; client_reference_id?: string } } };
    const o = event.data.object;
    return { type: event.type, sessionId: o.id ?? null, invoiceId: o.metadata?.invoiceId ?? o.client_reference_id ?? null, amount: o.amount_total ?? null, currency: o.currency?.toUpperCase() ?? null, reference: o.payment_intent ?? o.id ?? null, raw: event };
  }

  paymentInstructions() {
    return "Pay online by card with the button above, or by bank transfer using the invoice number as the reference.";
  }
}

let provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (provider) return provider;
  const env = getEnv();
  provider = env.PAYMENT_PROVIDER === "stripe" ? new StripePaymentProvider(env.STRIPE_SECRET_KEY!, env.STRIPE_WEBHOOK_SECRET!) : env.PAYMENT_PROVIDER === "fake" ? new FakePaymentProvider() : new ManualPaymentProvider();
  return provider;
}

export function setPaymentProviderForTests(p: PaymentProvider | null) {
  provider = p;
}
