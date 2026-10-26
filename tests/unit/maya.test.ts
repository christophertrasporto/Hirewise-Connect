import { describe, expect, it, vi, afterEach } from "vitest";
import { createPublicKey, generateKeyPairSync, createSign } from "node:crypto";
import { flattenForSignature, signedString, parseSignatureHeader, verifyMayaSignature, TIMESTAMP_TOLERANCE_MS } from "@/lib/maya-signature";
import { MAYA_WEBHOOK_KEYS } from "@/server/adapters/maya-keys";
import { HttpMayaGateway, FakeMayaGateway, toMajor } from "@/server/adapters/maya";

// The example from https://developers.maya.ph/reference/webhook-security, "Webhook Signature Verification".
const DOC_PAYLOAD = {
  id: "e732f996-cb87-4120-b712-166d8183c01d",
  isPaid: true,
  status: "PAYMENT_SUCCESS",
  amount: 10,
  currency: "PHP",
  canVoid: true,
  canRefund: true,
  canCapture: false,
  createdAt: "2021-07-01T08:26:13.000Z",
  updatedAt: "2021-07-01T08:26:16.000Z",
  fundSource: { type: "paymaya", description: "PayMaya Account", details: { scheme: "master-card", last4: "4154", first6: "545301", masked: "545301******4154", issuer: "Others" } },
};
const DOC_STEP_9 = "amount=10&canCapture=false&canRefund=true&canVoid=true&createdAt=2021-07-01T08:26:13.000Z&currency=PHP&fundSource.description=PayMaya Account&fundSource.details.first6=545301&fundSource.details.issuer=Others&fundSource.details.last4=4154&fundSource.details.masked=545301******4154&fundSource.details.scheme=master-card&fundSource.type=paymaya&id=e732f996-cb87-4120-b712-166d8183c01d&isPaid=true&status=PAYMENT_SUCCESS&updatedAt=2021-07-01T08:26:16.000Z&nonce=4f6e517387d0a3fcb36ec0a15b04c654";

const pair = () => generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
function sign(payload: Record<string, unknown>, nonce: string, privateKey: string) {
  const s = createSign("RSA-SHA256");
  s.update(signedString(payload, nonce));
  return `nonce=${nonce},v1=${s.sign(privateKey, "hex")}`;
}

describe("Maya webhook signature (as documented)", () => {
  it("flattens and signs exactly like the documented example", () => {
    expect(signedString(DOC_PAYLOAD, "4f6e517387d0a3fcb36ec0a15b04c654")).toBe(DOC_STEP_9);
    expect(flattenForSignature(DOC_PAYLOAD)).toHaveLength(17);
  });

  it("skips null, undefined, empty strings, empty arrays, and empty objects; flattens arrays by index", () => {
    expect(flattenForSignature({ a: null, b: undefined, c: "", d: [], e: {}, f: "x", g: [1, { h: 2 }], i: false, j: 0 }).sort()).toEqual(["f=x", "g.0=1", "g.1.h=2", "i=false", "j=0"]);
  });

  it("parses the header on commas and the first equals sign", () => {
    expect(parseSignatureHeader("nonce=abc,v1=ff00==")).toEqual({ nonce: "abc", v1: "ff00==" });
    expect(parseSignatureHeader(null)).toEqual({ nonce: null, v1: null });
    expect(parseSignatureHeader("garbage")).toEqual({ nonce: null, v1: null });
  });

  it("verifies a good signature with the first or the second key, and rejects everything else", () => {
    const k1 = pair();
    const k2 = pair();
    const now = 1_750_000_000_000;
    const body = JSON.stringify(DOC_PAYLOAD);
    const header1 = sign(DOC_PAYLOAD, "n1n1", k1.privateKey);
    const header2 = sign(DOC_PAYLOAD, "n2n2", k2.privateKey);
    const ok = (signatureHeader: string, over: Partial<Parameters<typeof verifyMayaSignature>[0]> = {}) => verifyMayaSignature({ rawBody: body, signatureHeader, timestampHeader: String(now), publicKeys: [k1.publicKey, k2.publicKey], now, ...over });
    expect(ok(header1)).toEqual({ valid: true, reason: "ok" });
    expect(ok(header2)).toEqual({ valid: true, reason: "ok" }); // key rotation: the second key signs
    expect(ok(header1, { publicKeys: [k2.publicKey] }).reason).toBe("bad-signature");
    expect(ok(header1.replace("n1n1", "other")).reason).toBe("bad-signature"); // the nonce is part of what is signed
    expect(ok(header1, { rawBody: JSON.stringify({ ...DOC_PAYLOAD, amount: 1 }) }).reason).toBe("bad-signature");
    expect(ok(header1, { timestampHeader: String(now - TIMESTAMP_TOLERANCE_MS - 1) }).reason).toBe("stale-timestamp");
    expect(ok(header1, { timestampHeader: String(now + TIMESTAMP_TOLERANCE_MS + 1) }).reason).toBe("stale-timestamp");
    expect(ok(header1, { timestampHeader: String(now - TIMESTAMP_TOLERANCE_MS) }).valid).toBe(true);
    expect(ok(header1, { timestampHeader: undefined }).reason).toBe("stale-timestamp");
    expect(ok("", {}).reason).toBe("no-signature");
    expect(ok(header1, { publicKeys: [] }).reason).toBe("no-keys");
    expect(ok(header1, { rawBody: "not json" }).reason).toBe("bad-body");
    expect(ok(header1, { rawBody: "[1,2]" }).reason).toBe("bad-body");
    expect(ok(header1, { publicKeys: ["not a key", k1.publicKey] }).valid).toBe(true); // a malformed key never blocks the next one
  });

  it("ships Maya's four published keys as valid 2048-bit RSA public keys", () => {
    for (const env of ["sandbox", "production"] as const) {
      expect(MAYA_WEBHOOK_KEYS[env]).toHaveLength(2);
      for (const pem of MAYA_WEBHOOK_KEYS[env]) {
        const key = createPublicKey(pem);
        expect(key.asymmetricKeyType).toBe("rsa");
        expect(key.asymmetricKeyDetails?.modulusLength).toBe(2048);
      }
    }
    expect(MAYA_WEBHOOK_KEYS.sandbox[0]).not.toBe(MAYA_WEBHOOK_KEYS.production[0]);
  });
});

describe("Maya gateway", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a checkout with the public key, decimal amounts, our reference, and the redirect URLs", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ checkoutId: "co-1", redirectUrl: "https://payments-web-sandbox.paymaya.com/v2/checkout?id=co-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const gw = new HttpMayaGateway("sandbox", "pk-test", "sk-test");
    const r = await gw.createCheckout({ requestReferenceNumber: "ref123", amountMinor: 49950, currency: "PHP", description: "Course: Cold Calling", successUrl: "https://x/s", failureUrl: "https://x/f", cancelUrl: "https://x/c" });
    expect(r).toEqual({ checkoutId: "co-1", redirectUrl: "https://payments-web-sandbox.paymaya.com/v2/checkout?id=co-1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://pg-sandbox.paymaya.com/checkout/v1/checkouts");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("pk-test:").toString("base64")}`);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ totalAmount: { value: 499.5, currency: "PHP" }, requestReferenceNumber: "ref123", redirectUrl: { success: "https://x/s", failure: "https://x/f", cancel: "https://x/c" } });
    expect(body.items[0]).toMatchObject({ name: "Course: Cold Calling", quantity: 1, totalAmount: { value: 499.5 } });
    // The secret key is never used to create a checkout.
    expect(JSON.stringify(init)).not.toContain("sk-test");
  });

  it("uses the production host in production mode and surfaces a failed checkout", async () => {
    const fetchMock = vi.fn(async () => new Response("bad", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const gw = new HttpMayaGateway("production", "pk-live", "sk-live");
    await expect(gw.createCheckout({ requestReferenceNumber: "r", amountMinor: 100, currency: "PHP", description: "x", successUrl: "u", failureUrl: "u", cancelUrl: "u" })).rejects.toThrow(/Maya checkout failed \(400\)/);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://pg.paymaya.com/checkout/v1/checkouts");
  });

  it("looks payments up with the secret key and converts amounts to minor units", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: "p1", isPaid: true, status: "PAYMENT_SUCCESS", amount: "499.50", currency: "PHP", requestReferenceNumber: "ref123" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const gw = new HttpMayaGateway("sandbox", "pk-test", "sk-test");
    const [p] = await gw.paymentsByReference("ref 123");
    expect(p).toMatchObject({ id: "p1", isPaid: true, status: "PAYMENT_SUCCESS", amountMinor: 49950, currency: "PHP", requestReferenceNumber: "ref123" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://pg-sandbox.paymaya.com/payments/v1/payment-rrns/ref%20123");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("sk-test:").toString("base64")}`);
  });

  it("treats a 404 as no payment and accepts either status field name", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const gw = new HttpMayaGateway("sandbox", "pk", "sk");
    expect(await gw.paymentsByReference("none")).toEqual([]);
    expect(await gw.paymentById("none")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "p2", paymentStatus: "PAYMENT_FAILED", amount: 10, currency: "PHP" }), { status: 200 })));
    expect((await gw.paymentById("p2"))?.status).toBe("PAYMENT_FAILED");
  });

  it("converts minor units to decimal major units", () => {
    expect(toMajor(49950)).toBe(499.5);
    expect(toMajor(1)).toBe(0.01);
    expect(toMajor(100)).toBe(1);
  });

  it("the fake gateway reports what it was told and starts every payment unpaid", async () => {
    const fake = new FakeMayaGateway();
    const co = await fake.createCheckout({ requestReferenceNumber: "abc", amountMinor: 5000, currency: "PHP", description: "x", successUrl: "s", failureUrl: "f", cancelUrl: "c" });
    expect(co.checkoutId).toBe("fake_co_abc");
    expect((await fake.paymentsByReference("abc"))[0]).toMatchObject({ status: "PENDING_PAYMENT", isPaid: false, amountMinor: 5000 });
    fake.setStatus("abc", "PAYMENT_SUCCESS");
    expect((await fake.paymentsByReference("abc"))[0]).toMatchObject({ status: "PAYMENT_SUCCESS", isPaid: true });
    expect(await fake.paymentsByReference("missing")).toEqual([]);
    expect((await fake.paymentById("fake_pay_abc"))?.requestReferenceNumber).toBe("abc");
  });
});
