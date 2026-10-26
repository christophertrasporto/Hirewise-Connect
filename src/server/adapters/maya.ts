import { getEnv } from "@/server/env";
import { MAYA_WEBHOOK_KEYS } from "./maya-keys";

/**
 * Maya Checkout behind an interface, with a local fake for development and tests (like the other adapters).
 * Docs: https://developers.maya.ph (Create Checkout with the PUBLIC key; payment lookups with the SECRET key).
 * Money here is integer minor units; Maya speaks decimal major units, converted only at this boundary.
 */

export type MayaCheckoutRequest = { requestReferenceNumber: string; amountMinor: number; currency: string; description: string; successUrl: string; failureUrl: string; cancelUrl: string };
export type MayaCheckout = { checkoutId: string; redirectUrl: string };
export type MayaPayment = { id: string; requestReferenceNumber: string | null; status: string; isPaid: boolean; amountMinor: number | null; currency: string | null; raw: unknown };

export interface MayaGateway {
  readonly mode: "fake" | "sandbox" | "production";
  createCheckout(req: MayaCheckoutRequest): Promise<MayaCheckout>;
  /** The authoritative status of every payment attempt for one of our reference numbers. */
  paymentsByReference(requestReferenceNumber: string): Promise<MayaPayment[]>;
  paymentById(id: string): Promise<MayaPayment | null>;
}

export type MayaMode = "off" | "fake" | "sandbox" | "production";
export const mayaMode = (): MayaMode => getEnv().MAYA_MODE;
export const mayaEnabled = (): boolean => mayaMode() !== "off";

/** Public keys Maya signs webhooks with: the environment's two published keys, or the configured override. */
export function mayaWebhookKeys(): string[] {
  const env = getEnv();
  const override = [env.MAYA_WEBHOOK_PUBLIC_KEY_1, env.MAYA_WEBHOOK_PUBLIC_KEY_2].filter((k): k is string => !!k).map((k) => k.replace(/\\n/g, "\n"));
  if (override.length) return override;
  return env.MAYA_MODE === "production" ? [...MAYA_WEBHOOK_KEYS.production] : [...MAYA_WEBHOOK_KEYS.sandbox];
}

/** "49.00" style major units to minor, and back. */
export const toMajor = (minor: number) => Number((minor / 100).toFixed(2));
const toMinor = (major: unknown): number | null => {
  const n = typeof major === "string" ? Number(major) : typeof major === "number" ? major : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

function parsePayment(raw: unknown): MayaPayment | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : null;
  if (!id) return null;
  // The docs show both "status" and "paymentStatus"; accept either.
  const status = String(o.status ?? o.paymentStatus ?? "UNKNOWN");
  return { id, requestReferenceNumber: typeof o.requestReferenceNumber === "string" ? o.requestReferenceNumber : null, status, isPaid: o.isPaid === true, amountMinor: toMinor(o.amount ?? (o.totalAmount as { value?: unknown } | undefined)?.value), currency: typeof o.currency === "string" ? o.currency : typeof (o.totalAmount as { currency?: unknown } | undefined)?.currency === "string" ? String((o.totalAmount as { currency: string }).currency) : null, raw };
}

export class HttpMayaGateway implements MayaGateway {
  constructor(readonly mode: "sandbox" | "production", private publicKey: string, private secretKey: string) {}
  private get base() {
    return this.mode === "production" ? "https://pg.paymaya.com" : "https://pg-sandbox.paymaya.com";
  }
  private basic(key: string) {
    return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
  }
  private async call(path: string, auth: string, init: { method: string; body?: unknown } = { method: "GET" }) {
    const res = await fetch(`${this.base}${path}`, { method: init.method, headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" }, body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, ok: res.ok, json, text };
  }
  async createCheckout(req: MayaCheckoutRequest): Promise<MayaCheckout> {
    const value = toMajor(req.amountMinor);
    const r = await this.call("/checkout/v1/checkouts", this.basic(this.publicKey), {
      method: "POST",
      body: { totalAmount: { value, currency: req.currency }, items: [{ name: req.description.slice(0, 100), quantity: 1, totalAmount: { value } }], redirectUrl: { success: req.successUrl, failure: req.failureUrl, cancel: req.cancelUrl }, requestReferenceNumber: req.requestReferenceNumber },
    });
    const j = r.json as { checkoutId?: string; redirectUrl?: string } | null;
    if (!r.ok || !j?.checkoutId || !j.redirectUrl) throw new Error(`Maya checkout failed (${r.status}): ${r.text.slice(0, 300)}`);
    return { checkoutId: j.checkoutId, redirectUrl: j.redirectUrl };
  }
  async paymentsByReference(rrn: string): Promise<MayaPayment[]> {
    const r = await this.call(`/payments/v1/payment-rrns/${encodeURIComponent(rrn)}`, this.basic(this.secretKey));
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`Maya payment lookup failed (${r.status})`);
    const items = Array.isArray(r.json) ? r.json : r.json ? [r.json] : [];
    return items.map(parsePayment).filter((p): p is MayaPayment => !!p);
  }
  async paymentById(id: string): Promise<MayaPayment | null> {
    const r = await this.call(`/payments/v1/payments/${encodeURIComponent(id)}`, this.basic(this.secretKey));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Maya payment lookup failed (${r.status})`);
    return parsePayment(r.json);
  }
}

type FakeRecord = { payment: MayaPayment; successUrl: string; failureUrl: string; cancelUrl: string };

/** Local stand-in: checkout goes to an in-app page that "pays". Never available in production. */
export class FakeMayaGateway implements MayaGateway {
  readonly mode = "fake" as const;
  readonly records = new Map<string, FakeRecord>();
  async createCheckout(req: MayaCheckoutRequest): Promise<MayaCheckout> {
    const rrn = req.requestReferenceNumber;
    this.records.set(rrn, { payment: { id: `fake_pay_${rrn}`, requestReferenceNumber: rrn, status: "PENDING_PAYMENT", isPaid: false, amountMinor: req.amountMinor, currency: req.currency, raw: { fake: true } }, successUrl: req.successUrl, failureUrl: req.failureUrl, cancelUrl: req.cancelUrl });
    return { checkoutId: `fake_co_${rrn}`, redirectUrl: `${getEnv().APP_URL.replace(/\/$/, "")}/api/payments/maya-fake/${encodeURIComponent(rrn)}` };
  }
  async paymentsByReference(rrn: string): Promise<MayaPayment[]> {
    const r = this.records.get(rrn);
    return r ? [r.payment] : [];
  }
  async paymentById(id: string): Promise<MayaPayment | null> {
    for (const r of this.records.values()) if (r.payment.id === id) return r.payment;
    return null;
  }
  /** Test and demo control: set what Maya would report. Amount and currency can be overridden to simulate a mismatch. */
  setStatus(rrn: string, status: "PAYMENT_SUCCESS" | "PAYMENT_FAILED" | "PAYMENT_EXPIRED" | "PAYMENT_CANCELLED" | "PENDING_PAYMENT" | "REFUNDED", over: { amountMinor?: number; currency?: string } = {}) {
    const r = this.records.get(rrn);
    if (!r) throw new Error(`Unknown fake payment ${rrn}`);
    r.payment = { ...r.payment, status, isPaid: status === "PAYMENT_SUCCESS", amountMinor: over.amountMinor ?? r.payment.amountMinor, currency: over.currency ?? r.payment.currency };
  }
  redirectsFor(rrn: string) {
    return this.records.get(rrn) ?? null;
  }
}

// One gateway per process. The fake lives on globalThis so route handlers and server actions share it in dev.
const g = globalThis as unknown as { __mayaFake?: FakeMayaGateway };
let override: MayaGateway | null = null;
let http: HttpMayaGateway | null = null;

/** Test helper: replace (or clear) the gateway. */
export function setMayaGatewayForTests(gw: MayaGateway | null) {
  override = gw;
}

export function getMayaGateway(): MayaGateway {
  if (override) return override;
  const env = getEnv();
  if (env.MAYA_MODE === "off") throw new Error("Maya payments are not configured.");
  if (env.MAYA_MODE === "fake") return (g.__mayaFake ??= new FakeMayaGateway());
  http ??= new HttpMayaGateway(env.MAYA_MODE, env.MAYA_PUBLIC_KEY!, env.MAYA_SECRET_KEY!);
  return http;
}
/** The fake gateway, or null. Checked by mode, not instanceof: route handlers and server actions each load their own copy of this module in dev. */
export function getFakeMayaGateway(): FakeMayaGateway | null {
  const gw = getMayaGateway();
  return gw.mode === "fake" ? (gw as FakeMayaGateway) : null;
}
