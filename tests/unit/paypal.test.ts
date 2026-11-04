import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpPayPalGateway, FakePayPalGateway, parseOrder } from "@/server/adapters/paypal";
import { getEnv, resetEnvCache } from "@/server/env";

const order = (o: Record<string, unknown>) => ({ id: "ORD1", status: "CREATED", purchase_units: [{ reference_id: "ref1", custom_id: "ref1", amount: { currency_code: "PHP", value: "499.00" } }], ...o });
const capture = (status: string, extra: Record<string, unknown> = {}) => ({ payments: { captures: [{ id: "CAP1", status, amount: { currency_code: "PHP", value: "499.00" }, seller_receivable_breakdown: { paypal_fee: { currency_code: "PHP", value: "21.96" }, net_amount: { currency_code: "PHP", value: "477.04" } }, ...extra }] } });

describe("parseOrder", () => {
  it("reads an order that has not been approved", () => {
    expect(parseOrder(order({ status: "PAYER_ACTION_REQUIRED" }))).toMatchObject({ orderId: "ORD1", reference: "ref1", state: "WAITING", captureId: null, amountMinor: 49900, currency: "PHP", feeMinor: null });
  });

  it("reads an approved order as ready to capture", () => {
    expect(parseOrder(order({ status: "APPROVED" }))?.state).toBe("APPROVED");
  });

  it("reads a completed capture as paid, with the capture amount and PayPal's fee", () => {
    const p = parseOrder(order({ status: "COMPLETED", purchase_units: [{ custom_id: "ref1", amount: { currency_code: "PHP", value: "499.00" }, ...capture("COMPLETED") }] }));
    expect(p).toMatchObject({ state: "PAID", captureId: "CAP1", amountMinor: 49900, currency: "PHP", feeMinor: 2196 });
  });

  it("takes the amount PayPal actually captured, not the amount asked for", () => {
    const p = parseOrder(order({ status: "COMPLETED", purchase_units: [{ custom_id: "ref1", amount: { currency_code: "PHP", value: "499.00" }, payments: { captures: [{ id: "CAP2", status: "COMPLETED", amount: { currency_code: "PHP", value: "1.00" } }] } }] }));
    expect(p).toMatchObject({ state: "PAID", amountMinor: 100, feeMinor: null });
  });

  it("ignores a fee quoted in a different currency", () => {
    const p = parseOrder(order({ status: "COMPLETED", purchase_units: [{ custom_id: "ref1", ...capture("COMPLETED", { seller_receivable_breakdown: { paypal_fee: { currency_code: "USD", value: "0.40" } } }) }] }));
    expect(p?.feeMinor).toBeNull();
  });

  it("maps pending, declined, failed and refunded captures, and a voided order", () => {
    const state = (s: string) => parseOrder(order({ status: "COMPLETED", purchase_units: [{ custom_id: "ref1", ...capture(s) }] }))?.state;
    expect(state("PENDING")).toBe("PENDING");
    expect(state("DECLINED")).toBe("FAILED");
    expect(state("FAILED")).toBe("FAILED");
    expect(state("REFUNDED")).toBe("REFUNDED");
    expect(state("PARTIALLY_REFUNDED")).toBe("REFUNDED");
    expect(parseOrder(order({ status: "VOIDED" }))?.state).toBe("FAILED");
  });

  it("falls back to reference_id when there is no custom_id, and rejects junk", () => {
    expect(parseOrder(order({ purchase_units: [{ reference_id: "only-ref", amount: { currency_code: "USD", value: "49.00" } }] }))?.reference).toBe("only-ref");
    for (const bad of [null, undefined, "x", [], {}, { status: "COMPLETED" }]) expect(parseOrder(bad)).toBeNull();
  });
});

describe("HttpPayPalGateway", () => {
  type Call = { url: string; init: RequestInit };
  let calls: Call[];
  let responses: Array<{ status: number; body: unknown }>;
  const gw = () => new HttpPayPalGateway("sandbox", "client-id", "client-secret", "WH-ID");

  beforeEach(() => {
    calls = [];
    responses = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = url.endsWith("/v1/oauth2/token") ? { status: 200, body: { access_token: "tok", expires_in: 3000 } } : (responses.shift() ?? { status: 500, body: {} });
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const api = () => calls.filter((c) => !c.url.endsWith("/v1/oauth2/token"));
  const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

  it("signs in once with the client credentials and reuses the token", async () => {
    responses.push({ status: 200, body: order({}) }, { status: 200, body: order({}) });
    const g = gw();
    await g.getOrder("A");
    await g.getOrder("B");
    const logins = calls.filter((c) => c.url.endsWith("/v1/oauth2/token"));
    expect(logins).toHaveLength(1);
    expect(logins[0].url).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(header(logins[0], "Authorization")).toBe(`Basic ${Buffer.from("client-id:client-secret").toString("base64")}`);
    expect(header(api()[0], "Authorization")).toBe("Bearer tok");
  });

  it("creates an order for exactly the amount, currency and reference, and returns the buyer approval link", async () => {
    responses.push({ status: 201, body: { id: "ORD9", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "self", href: "https://api/self" }, { rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORD9" }] } });
    const r = await gw().createOrder({ referenceNumber: "row1", amountMinor: 49900, currency: "PHP", description: "Course: Cold Calling", returnUrl: "https://app/courses/c?pay=success", cancelUrl: "https://app/courses/c?pay=cancelled" });
    expect(r).toEqual({ orderId: "ORD9", redirectUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORD9" });
    const c = api()[0];
    expect(c.url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    expect(header(c, "PayPal-Request-Id")).toBe("row1");
    const body = JSON.parse(String(c.init.body));
    expect(body.intent).toBe("CAPTURE");
    expect(body.purchase_units[0]).toMatchObject({ reference_id: "row1", custom_id: "row1", amount: { currency_code: "PHP", value: "499.00" } });
    expect(body.payment_source.paypal.experience_context).toMatchObject({ user_action: "PAY_NOW", return_url: "https://app/courses/c?pay=success", cancel_url: "https://app/courses/c?pay=cancelled" });
  });

  it("falls back to the approve link, and fails with PayPal's reason when there is none", async () => {
    responses.push({ status: 201, body: { id: "O", links: [{ rel: "approve", href: "https://pay/approve" }] } });
    expect((await gw().createOrder({ referenceNumber: "r", amountMinor: 100, currency: "USD", description: "d", returnUrl: "u", cancelUrl: "c" })).redirectUrl).toBe("https://pay/approve");
    responses.push({ status: 422, body: { name: "UNPROCESSABLE_ENTITY" } });
    await expect(gw().createOrder({ referenceNumber: "r", amountMinor: 100, currency: "USD", description: "d", returnUrl: "u", cancelUrl: "c" })).rejects.toThrow(/PayPal order failed \(422\)/);
  });

  it("captures with a request id so a repeat returns the same result", async () => {
    responses.push({ status: 201, body: order({ status: "COMPLETED", purchase_units: [{ custom_id: "ref1", ...capture("COMPLETED") }] }) });
    const p = await gw().captureOrder("ORD1", "capture-row1");
    expect(p.state).toBe("PAID");
    expect(api()[0].url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders/ORD1/capture");
    expect(header(api()[0], "PayPal-Request-Id")).toBe("capture-row1");
  });

  it("reads the order instead when it was already captured or is not approved yet", async () => {
    for (const issue of ["ORDER_ALREADY_CAPTURED", "ORDER_NOT_APPROVED"]) {
      calls.length = 0;
      responses.push({ status: 422, body: { details: [{ issue }] } }, { status: 200, body: order({ status: issue === "ORDER_NOT_APPROVED" ? "CREATED" : "COMPLETED", purchase_units: [{ custom_id: "ref1", ...(issue === "ORDER_NOT_APPROVED" ? {} : capture("COMPLETED")) }] }) });
      const p = await gw().captureOrder("ORD1", "capture-row1");
      expect(p.state).toBe(issue === "ORDER_NOT_APPROVED" ? "WAITING" : "PAID");
      expect(api()).toHaveLength(2);
    }
  });

  it("fails loudly on any other capture error", async () => {
    responses.push({ status: 500, body: { name: "INTERNAL_SERVER_ERROR" } });
    await expect(gw().captureOrder("ORD1", "x")).rejects.toThrow(/PayPal capture failed \(500\)/);
  });

  it("answers null for an unknown order and throws on other lookup errors", async () => {
    responses.push({ status: 404, body: {} }, { status: 503, body: {} });
    expect(await gw().getOrder("nope")).toBeNull();
    await expect(gw().getOrder("x")).rejects.toThrow(/lookup failed \(503\)/);
  });

  it("has PayPal verify a webhook with the webhook id, and refuses one with missing headers without calling PayPal", async () => {
    const h = { transmissionId: "t", transmissionTime: "2026-01-01T00:00:00Z", transmissionSig: "s", certUrl: "https://api.paypal.com/c", authAlgo: "SHA256withRSA" };
    responses.push({ status: 200, body: { verification_status: "SUCCESS" } }, { status: 200, body: { verification_status: "FAILURE" } });
    expect(await gw().verifyWebhook(h, { id: "E" })).toBe(true);
    expect(JSON.parse(String(api()[0].init.body))).toMatchObject({ webhook_id: "WH-ID", transmission_id: "t", transmission_sig: "s", cert_url: "https://api.paypal.com/c", auth_algo: "SHA256withRSA", webhook_event: { id: "E" } });
    expect(await gw().verifyWebhook(h, { id: "E" })).toBe(false);
    calls.length = 0;
    expect(await gw().verifyWebhook({ ...h, transmissionSig: null }, {})).toBe(false);
    expect(await new HttpPayPalGateway("sandbox", "a", "b", undefined).verifyWebhook(h, {})).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("talks to the live PayPal only in production mode", async () => {
    responses.push({ status: 200, body: order({}) });
    await new HttpPayPalGateway("production", "a", "b", undefined).getOrder("X");
    expect(calls[0].url).toBe("https://api-m.paypal.com/v1/oauth2/token");
  });
});

describe("FakePayPalGateway", () => {
  it("captures only an approved order, with a fee, and keeps a repeat capture the same", async () => {
    const f = new FakePayPalGateway();
    const o = await f.createOrder({ referenceNumber: "r1", amountMinor: 10_000, currency: "PHP", description: "d", returnUrl: "http://r", cancelUrl: "http://c" });
    expect((await f.captureOrder(o.orderId, "x")).state).toBe("WAITING");
    f.setState("r1", "APPROVED");
    const paid = await f.captureOrder(o.orderId, "x");
    expect(paid).toMatchObject({ state: "PAID", feeMinor: 440 });
    expect(await f.captureOrder(o.orderId, "x")).toEqual(paid);
    expect(await f.getOrder("missing")).toBeNull();
  });
});

describe("PayPal settings", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    resetEnvCache();
  });
  const base = () => {
    process.env.DATABASE_URL = "postgresql://x";
  };

  it("is off by default", () => {
    base();
    delete process.env.PAYPAL_MODE;
    expect(getEnv().PAYPAL_MODE).toBe("off");
  });

  it("needs the client id and secret to go live or to sandbox", () => {
    base();
    for (const mode of ["sandbox", "production"]) {
      process.env.PAYPAL_MODE = mode;
      delete process.env.PAYPAL_CLIENT_ID;
      delete process.env.PAYPAL_CLIENT_SECRET;
      resetEnvCache();
      expect(() => getEnv()).toThrow(/PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET/);
      process.env.PAYPAL_CLIENT_ID = "id";
      process.env.PAYPAL_CLIENT_SECRET = "secret";
      resetEnvCache();
      expect(getEnv().PAYPAL_MODE).toBe(mode);
    }
  });

  it("refuses the fake in production", () => {
    base();
    Object.assign(process.env, { NODE_ENV: "production", PAYPAL_MODE: "fake" });
    expect(() => getEnv()).toThrow(/PAYPAL_MODE=fake is not allowed in production/);
  });
});
