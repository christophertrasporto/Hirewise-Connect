import { describe, expect, it } from "vitest";
import { csvCell, parsePurchaseQuery, purchaseDateRange, purchaseMethod, purchaseQueryString, purchaseTotals, purchasesCsv } from "@/lib/purchases";

const facts = (o: Partial<Parameters<typeof purchaseMethod>[0]> = {}) => ({ paymentStatus: "PAID", hasPaidOnlinePayment: null, hasAccessCode: false, hasCourseSeat: false, ...o });

describe("how a purchase was paid", () => {
  it("a confirmed online payment wins, then access code, seat, waiver, and finally staff recording", () => {
    expect(purchaseMethod(facts({ hasPaidOnlinePayment: "PAYPAL" }))).toBe("PAYPAL");
    expect(purchaseMethod(facts({ hasPaidOnlinePayment: "MAYA" }))).toBe("MAYA");
    expect(purchaseMethod(facts({ hasAccessCode: true }))).toBe("ACCESS_CODE");
    expect(purchaseMethod(facts({ hasCourseSeat: true }))).toBe("COURSE_SEAT");
    expect(purchaseMethod(facts({ paymentStatus: "WAIVED" }))).toBe("WAIVED");
    expect(purchaseMethod(facts())).toBe("MANUAL");
    expect(purchaseMethod(facts({ paymentStatus: "REFUNDED", hasPaidOnlinePayment: "PAYPAL" }))).toBe("PAYPAL");
  });
});

describe("filters from the address", () => {
  it("blank values mean no filter and the page defaults to 1", () => {
    const r = parsePurchaseQuery({ status: "", method: "", q: "  " });
    expect(r.ok).toBe(true);
    expect(r.query).toMatchObject({ page: 1 });
    expect(r.query.status).toBeUndefined();
    expect(r.query.search).toBeUndefined();
  });

  it("reads each filter and rejects anything it does not understand", () => {
    const ok = parsePurchaseQuery({ status: "PAID", method: "PAYPAL", course: "c1", from: "2026-11-01", to: "2026-11-30", q: "ana", page: "2" });
    expect(ok).toMatchObject({ ok: true, query: { status: "PAID", method: "PAYPAL", courseId: "c1", from: "2026-11-01", to: "2026-11-30", search: "ana", page: 2 } });
    for (const bad of [{ status: "NOPE" }, { method: "CASH" }, { from: "yesterday" }, { page: "0" }, { page: "abc" }, { from: "2026-12-01", to: "2026-11-01" }]) {
      const r = parsePurchaseQuery(bad);
      expect(r.ok).toBe(false);
      expect(r.query.status).toBeUndefined();
    }
  });

  it("round-trips through the address", () => {
    const q = parsePurchaseQuery({ status: "PAID", q: "ana", page: "3" }).query;
    expect(purchaseQueryString(q)).toBe("?status=PAID&q=ana&page=3");
    expect(purchaseQueryString(q, { page: 1 })).toBe("?status=PAID&q=ana");
    expect(purchaseQueryString({})).toBe("");
  });

  it("the last day is included in full", () => {
    const r = purchaseDateRange({ from: "2026-11-01", to: "2026-11-30" });
    expect(r.gte!.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(r.lt!.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(purchaseDateRange({})).toEqual({});
  });
});

describe("totals", () => {
  it("never mix currencies, and refunds come off what was collected", () => {
    const t = purchaseTotals([
      { currency: "USD", paymentStatus: "PAID", count: 2, priceCents: 3800, paidCents: 3800, refundedCents: 0 },
      { currency: "USD", paymentStatus: "REFUNDED", count: 1, priceCents: 1900, paidCents: 1900, refundedCents: 1900 },
      { currency: "USD", paymentStatus: "PENDING", count: 1, priceCents: 1900, paidCents: 0, refundedCents: 0 },
      { currency: "PHP", paymentStatus: "PAID", count: 1, priceCents: 2500, paidCents: 2500, refundedCents: 500 },
      { currency: "PHP", paymentStatus: "WAIVED", count: 3, priceCents: 9900, paidCents: 0, refundedCents: 0 },
    ]);
    expect(t.map((x) => x.currency)).toEqual(["PHP", "USD"]);
    expect(t[0]).toMatchObject({ currency: "PHP", purchases: 4, collectedCents: 2500, refundedCents: 500, netCents: 2000, pendingCents: 0 });
    expect(t[1]).toMatchObject({ currency: "USD", purchases: 4, collectedCents: 5700, refundedCents: 1900, netCents: 3800, pendingCents: 1900, pendingCount: 1 });
  });
});

describe("CSV", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
  });

  it("defuses a leading formula character so a spreadsheet will not run it", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("-12.50")).toBe("-12.50");
  });

  it("writes one row per purchase with a header, money in decimals, and labels", () => {
    const csv = purchasesCsv([{ purchasedAt: new Date("2026-11-20T10:00:00Z"), paidAt: new Date("2026-11-21T10:00:00Z"), buyer: "Ana Cruz", course: "Cold Calling 101", currency: "PHP", amountCents: 2500, listPriceCents: null, paidCents: 2500, refundedCents: 0, status: "PAID", method: "PAYPAL", reference: "ABC123" }]);
    const [head, row] = csv.trim().split("\n");
    expect(head).toBe("Purchased,Paid,Buyer,Course,Currency,Amount due,List price,Amount paid,Refunded,Status,Method,Reference");
    expect(row).toBe("2026-11-20,2026-11-21,Ana Cruz,Cold Calling 101,PHP,25.00,,25.00,,Paid,PayPal,ABC123");
  });
});
