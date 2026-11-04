import { getEnv } from "@/server/env";
import { toMajor } from "./maya";

/**
 * PayPal Checkout (Orders v2) behind an interface, with a local fake for development and tests (like the other adapters).
 * Docs: https://developer.paypal.com/docs/api/orders/v2/. Unlike Maya, PayPal does not take the money when the buyer
 * approves: we must CAPTURE the approved order. Money here is integer minor units; PayPal speaks decimal strings,
 * converted only at this boundary.
 */

/** Currencies a course may be sold in through PayPal (both have two decimals). */
export const PAYPAL_CURRENCIES = ["PHP", "USD"] as const;

export type PayPalOrderRequest = { referenceNumber: string; amountMinor: number; currency: string; description: string; returnUrl: string; cancelUrl: string };
export type PayPalOrder = { orderId: string; redirectUrl: string };

/**
 * Where an order stands, in our terms:
 * WAITING   created, the buyer has not approved it yet
 * APPROVED  the buyer approved it; we still have to capture
 * PAID      captured and completed: the money is ours
 * PENDING   captured but PayPal is holding it (review); not final
 * FAILED    declined, failed, or voided
 * REFUNDED  captured, then refunded
 */
export type PayPalState = "WAITING" | "APPROVED" | "PAID" | "PENDING" | "FAILED" | "REFUNDED";

export type PayPalPayment = {
  orderId: string;
  /** Our reference number, echoed back by PayPal from `custom_id`. */
  reference: string | null;
  state: PayPalState;
  captureId: string | null;
  /** What PayPal says was (or will be) charged: the capture amount once captured, otherwise the order amount. */
  amountMinor: number | null;
  currency: string | null;
  /** PayPal's own fee, only once captured. */
  feeMinor: number | null;
  raw: unknown;
};

export type PayPalWebhookHeaders = { transmissionId: string | null; transmissionTime: string | null; transmissionSig: string | null; certUrl: string | null; authAlgo: string | null };

export interface PayPalGateway {
  readonly mode: "fake" | "sandbox" | "production";
  createOrder(req: PayPalOrderRequest): Promise<PayPalOrder>;
  /** The authoritative state of an order, or null when PayPal does not know it. */
  getOrder(orderId: string): Promise<PayPalPayment | null>;
  /** Captures an approved order. `requestId` makes a repeat call return the same result. Returns the order as it stands afterwards. */
  captureOrder(orderId: string, requestId: string): Promise<PayPalPayment>;
  /** Asks PayPal whether a webhook really came from PayPal. */
  verifyWebhook(headers: PayPalWebhookHeaders, event: unknown): Promise<boolean>;
}

export type PayPalMode = "off" | "fake" | "sandbox" | "production";
export const paypalMode = (): PayPalMode => getEnv().PAYPAL_MODE;
export const paypalEnabled = (): boolean => paypalMode() !== "off";

const toMinor = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const money = (m: unknown): { minor: number | null; currency: string | null } => {
  const o = (m ?? {}) as { value?: unknown; currency_code?: unknown };
  return { minor: toMinor(o.value), currency: typeof o.currency_code === "string" ? o.currency_code : null };
};

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);

/** Reads a PayPal order (create, get, or capture response) into our shape. Exported for tests. */
export function parseOrder(raw: unknown): PayPalPayment | null {
  const o = asObj(raw);
  const orderId = typeof o?.id === "string" ? o.id : null;
  if (!o || !orderId) return null;
  const unit = asObj(Array.isArray(o.purchase_units) ? o.purchase_units[0] : null);
  const captures = (Array.isArray(asObj(unit?.payments)?.captures) ? (asObj(unit?.payments)!.captures as unknown[]) : []).map(asObj).filter((c): c is Obj => !!c);
  const cap = captures[captures.length - 1] ?? null;
  const reference = typeof unit?.custom_id === "string" ? unit.custom_id : typeof unit?.reference_id === "string" ? unit.reference_id : null;

  let state: PayPalState = "WAITING";
  const orderStatus = String(o.status ?? "");
  if (cap) {
    const c = String(cap.status ?? "");
    state = c === "COMPLETED" ? "PAID" : c === "PENDING" ? "PENDING" : c === "REFUNDED" || c === "PARTIALLY_REFUNDED" ? "REFUNDED" : "FAILED";
  } else if (orderStatus === "APPROVED") state = "APPROVED";
  else if (orderStatus === "VOIDED") state = "FAILED";

  const amount = money(cap?.amount ?? unit?.amount);
  const fee = money(asObj(cap?.seller_receivable_breakdown)?.paypal_fee);
  return { orderId, reference, state, captureId: typeof cap?.id === "string" ? cap.id : null, amountMinor: amount.minor, currency: amount.currency, feeMinor: cap && fee.minor !== null && (fee.currency === null || fee.currency === amount.currency) ? fee.minor : null, raw };
}

export class HttpPayPalGateway implements PayPalGateway {
  private token: { value: string; expiresAt: number } | null = null;
  constructor(readonly mode: "sandbox" | "production", private clientId: string, private secret: string, private webhookId: string | undefined) {}
  private get base() {
    return this.mode === "production" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  }
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!res.ok || !j?.access_token) throw new Error(`PayPal sign-in failed (${res.status})`);
    this.token = { value: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 300) * 1000 };
    return j.access_token;
  }
  private async call(path: string, init: { method: string; body?: unknown; requestId?: string } = { method: "GET" }) {
    const res = await fetch(`${this.base}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json", Accept: "application/json", ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, ok: res.ok, json, text };
  }
  async createOrder(req: PayPalOrderRequest): Promise<PayPalOrder> {
    const r = await this.call("/v2/checkout/orders", {
      method: "POST",
      requestId: req.referenceNumber,
      body: {
        intent: "CAPTURE",
        purchase_units: [{ reference_id: req.referenceNumber, custom_id: req.referenceNumber, description: req.description.slice(0, 127), amount: { currency_code: req.currency, value: toMajor(req.amountMinor).toFixed(2) } }],
        payment_source: { paypal: { experience_context: { brand_name: "Hirewise Connect", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", return_url: req.returnUrl, cancel_url: req.cancelUrl } } },
      },
    });
    const j = asObj(r.json);
    const links = Array.isArray(j?.links) ? (j!.links as Array<{ rel?: string; href?: string }>) : [];
    const href = links.find((l) => l.rel === "payer-action")?.href ?? links.find((l) => l.rel === "approve")?.href;
    if (!r.ok || typeof j?.id !== "string" || !href) throw new Error(`PayPal order failed (${r.status}): ${r.text.slice(0, 300)}`);
    return { orderId: j.id, redirectUrl: href };
  }
  async getOrder(orderId: string): Promise<PayPalPayment | null> {
    const r = await this.call(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`PayPal order lookup failed (${r.status})`);
    return parseOrder(r.json);
  }
  async captureOrder(orderId: string, requestId: string): Promise<PayPalPayment> {
    const r = await this.call(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: "POST", body: {}, requestId });
    if (r.ok) {
      const p = parseOrder(r.json);
      if (p) return p;
    }
    // The buyer has not approved yet, or another request already captured it: either way, the order itself tells the truth.
    const issue = String(asObj(Array.isArray(asObj(r.json)?.details) ? (asObj(r.json)!.details as unknown[])[0] : null)?.issue ?? "");
    if (r.status === 422 && (issue === "ORDER_ALREADY_CAPTURED" || issue === "ORDER_NOT_APPROVED" || issue === "PAYER_ACTION_REQUIRED")) {
      const p = await this.getOrder(orderId);
      if (p) return p;
    }
    throw new Error(`PayPal capture failed (${r.status}): ${r.text.slice(0, 300)}`);
  }
  async verifyWebhook(h: PayPalWebhookHeaders, event: unknown): Promise<boolean> {
    if (!this.webhookId || !h.transmissionId || !h.transmissionTime || !h.transmissionSig || !h.certUrl || !h.authAlgo) return false;
    const r = await this.call("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      body: { auth_algo: h.authAlgo, cert_url: h.certUrl, transmission_id: h.transmissionId, transmission_sig: h.transmissionSig, transmission_time: h.transmissionTime, webhook_id: this.webhookId, webhook_event: event },
    });
    return r.ok && asObj(r.json)?.verification_status === "SUCCESS";
  }
}

type FakeRecord = { payment: PayPalPayment; returnUrl: string; cancelUrl: string };

/** Local stand-in: the approval page is an in-app route that "approves" or cancels. Never available in production. */
export class FakePayPalGateway implements PayPalGateway {
  readonly mode = "fake" as const;
  readonly records = new Map<string, FakeRecord>();
  /** What the fake charges as PayPal's fee when it captures, in basis points of the amount. */
  feeBps = 440;
  /** Set to make the fake report no fee at capture, like a payment PayPal has not finalised. */
  omitFee = false;
  async createOrder(req: PayPalOrderRequest): Promise<PayPalOrder> {
    const orderId = `fake_order_${req.referenceNumber}`;
    this.records.set(req.referenceNumber, { payment: { orderId, reference: req.referenceNumber, state: "WAITING", captureId: null, amountMinor: req.amountMinor, currency: req.currency, feeMinor: null, raw: { fake: true } }, returnUrl: req.returnUrl, cancelUrl: req.cancelUrl });
    return { orderId, redirectUrl: `${getEnv().APP_URL.replace(/\/$/, "")}/api/payments/paypal-fake/${encodeURIComponent(req.referenceNumber)}` };
  }
  private find(orderId: string): FakeRecord | null {
    for (const r of this.records.values()) if (r.payment.orderId === orderId) return r;
    return null;
  }
  async getOrder(orderId: string): Promise<PayPalPayment | null> {
    return this.find(orderId)?.payment ?? null;
  }
  async captureOrder(orderId: string, _requestId?: string): Promise<PayPalPayment> {
    const r = this.find(orderId);
    if (!r) throw new Error(`Unknown fake order ${orderId}`);
    if (r.payment.state === "APPROVED") {
      const fee = this.omitFee ? null : Math.round(((r.payment.amountMinor ?? 0) * this.feeBps) / 10_000);
      r.payment = { ...r.payment, state: "PAID", captureId: `fake_cap_${r.payment.reference}`, feeMinor: fee };
    }
    return r.payment;
  }
  async verifyWebhook(h: PayPalWebhookHeaders): Promise<boolean> {
    return h.transmissionSig === "valid";
  }
  /** Test and demo control: set what PayPal would report. Amount and currency can be overridden to simulate a mismatch. */
  setState(reference: string, state: PayPalState, over: { amountMinor?: number; currency?: string; feeMinor?: number | null } = {}) {
    const r = this.records.get(reference);
    if (!r) throw new Error(`Unknown fake order ${reference}`);
    r.payment = { ...r.payment, state, amountMinor: over.amountMinor ?? r.payment.amountMinor, currency: over.currency ?? r.payment.currency, ...(over.feeMinor !== undefined ? { feeMinor: over.feeMinor } : {}), captureId: state === "PAID" || state === "PENDING" || state === "REFUNDED" ? `fake_cap_${reference}` : r.payment.captureId };
  }
  redirectsFor(reference: string) {
    return this.records.get(reference) ?? null;
  }
}

const g = globalThis as unknown as { __paypalFake?: FakePayPalGateway };
let override: PayPalGateway | null = null;
let http: HttpPayPalGateway | null = null;

/** Test helper: replace (or clear) the gateway. */
export function setPayPalGatewayForTests(gw: PayPalGateway | null) {
  override = gw;
}

export function getPayPalGateway(): PayPalGateway {
  if (override) return override;
  const env = getEnv();
  if (env.PAYPAL_MODE === "off") throw new Error("PayPal payments are not configured.");
  if (env.PAYPAL_MODE === "fake") return (g.__paypalFake ??= new FakePayPalGateway());
  http ??= new HttpPayPalGateway(env.PAYPAL_MODE, env.PAYPAL_CLIENT_ID!, env.PAYPAL_CLIENT_SECRET!, env.PAYPAL_WEBHOOK_ID);
  return http;
}

/** The fake gateway, or null. Checked by mode, not instanceof: route handlers and server actions each load their own copy of this module in dev. */
export function getFakePayPalGateway(): FakePayPalGateway | null {
  const gw = getPayPalGateway();
  return gw.mode === "fake" ? (gw as FakePayPalGateway) : null;
}
