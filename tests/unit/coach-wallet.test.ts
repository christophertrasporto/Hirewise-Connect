import { describe, expect, it } from "vitest";
import { MAX_COACH_SHARE_BPS, availableAtFor, buyerLabel, parseFeeCsv, parseMoneyToMinor, proportionalShare, splitSale } from "@/lib/coach-wallet";

describe("the worked example", () => {
  // Sale 2,499.00, gateway fee 102.47, so net 2,396.53. Rule 7 rounds the coach share DOWN: 60% of 2,396.53 is 1,437.918,
  // which is 1,437.91, and the platform gets the remaining centavo (958.62). (The brief's example showed 1,437.92 / 958.61.)
  it("splits 60/40 of the net and the parts add up exactly", () => {
    const s = splitSale({ saleMinor: 249_900, feeMinor: 10_247, coachBps: 6000 });
    expect(s).toMatchObject({ netMinor: 239_653, coachMinor: 143_791, platformMinor: 95_862, affiliateMinor: 0, platformKeepsMinor: 95_862 });
    expect(s.coachMinor + s.platformMinor).toBe(s.netMinor);
  });

  it("with a referral the affiliate comes out of the platform share and the coach is untouched", () => {
    const affiliate = Math.floor((249_900 * 1500) / 10_000); // 15% of the sale amount = 374.85
    expect(affiliate).toBe(37_485);
    const s = splitSale({ saleMinor: 249_900, feeMinor: 10_247, coachBps: 6000, affiliateMinor: affiliate });
    expect(s.coachMinor).toBe(143_791); // same as without the referral
    expect(s.platformMinor).toBe(95_862);
    expect(s.platformKeepsMinor).toBe(58_377); // 958.62 - 374.85
  });
});

describe("rounding", () => {
  it("coach plus platform is always exactly the net, the coach share is rounded down, and the remainder goes to the platform", () => {
    let checked = 0;
    for (const sale of [1, 2, 3, 99, 100, 101, 4999, 12_345, 249_900, 1_000_001, 987_654_321]) {
      for (const fee of [0, 1, Math.floor(sale / 3), Math.floor(sale / 20), sale]) {
        for (const bps of [0, 1, 3333, 5000, 6000, 6667, 7999, 8000, 10_000]) {
          const s = splitSale({ saleMinor: sale, feeMinor: Math.min(fee, sale), coachBps: bps });
          expect(s.coachMinor + s.platformMinor).toBe(s.netMinor);
          expect(s.coachMinor).toBe(Math.floor((s.netMinor * bps) / 10_000));
          expect(s.platformMinor).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(s.coachMinor) && Number.isInteger(s.platformMinor)).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it("a one-centavo remainder goes to the platform", () => {
    const s = splitSale({ saleMinor: 101, feeMinor: 0, coachBps: 5000 }); // 50.5 centavos each
    expect([s.coachMinor, s.platformMinor]).toEqual([50, 51]);
  });
});

describe("refusing nonsense", () => {
  it("rejects a fee above the sale, a negative fee, a bad rate, non-integers, and a zero sale", () => {
    const ok = { saleMinor: 10_000, feeMinor: 100, coachBps: 6000 };
    expect(() => splitSale({ ...ok, feeMinor: 10_001 })).toThrow(/fee/);
    expect(() => splitSale({ ...ok, feeMinor: -1 })).toThrow(/fee/);
    expect(() => splitSale({ ...ok, coachBps: 10_001 })).toThrow(/coach share/);
    expect(() => splitSale({ ...ok, coachBps: -1 })).toThrow(/coach share/);
    expect(() => splitSale({ ...ok, saleMinor: 0 })).toThrow(/sale/);
    expect(() => splitSale({ ...ok, saleMinor: 100.5 })).toThrow(/sale/);
    expect(() => splitSale({ ...ok, feeMinor: 1.5 })).toThrow(/fee/);
    expect(() => splitSale({ ...ok, affiliateMinor: -5 })).toThrow(/affiliate/);
  });

  it("the special-rate cap leaves the platform enough to pay a 15% affiliate commission", () => {
    // At the cap, on a fee-free sale the platform keeps 20% of the net, more than the 15% commission.
    const s = splitSale({ saleMinor: 249_900, feeMinor: 0, coachBps: MAX_COACH_SHARE_BPS, affiliateMinor: 37_485 });
    expect(s.platformKeepsMinor).toBeGreaterThan(0);
    // Even with a 4% gateway fee on top.
    const withFee = splitSale({ saleMinor: 249_900, feeMinor: 9_996, coachBps: MAX_COACH_SHARE_BPS, affiliateMinor: 37_485 });
    expect(withFee.platformKeepsMinor).toBeGreaterThan(0);
  });
});

describe("proportional shares (partial refunds)", () => {
  it("rounds down, and a refund of the whole sale returns the whole part", () => {
    expect(proportionalShare(143_791, 249_900, 249_900)).toBe(143_791);
    expect(proportionalShare(143_791, 124_950, 249_900)).toBe(71_895); // half, rounded down
    expect(proportionalShare(100, 1, 3)).toBe(33);
    expect(proportionalShare(0, 50, 100)).toBe(0);
  });

  it("cumulative part-refunds never reverse more than the part", () => {
    const part = 143_791;
    const sale = 249_900;
    let refunded = 0;
    let reversed = 0;
    for (const step of [10_000, 33_333, 50_001, 1, 99_999]) {
      refunded += step;
      const target = proportionalShare(part, refunded, sale);
      expect(target).toBeGreaterThanOrEqual(reversed);
      reversed = target;
    }
    expect(refunded).toBeLessThan(sale);
    expect(reversed).toBeLessThanOrEqual(part);
    expect(proportionalShare(part, sale, sale)).toBe(part);
  });

  it("is exact for large amounts that would overflow a float multiplication", () => {
    expect(proportionalShare(9_007_199_254_740_000, 3, 4)).toBe(6_755_399_441_055_000);
  });

  it("refuses bad input", () => {
    expect(() => proportionalShare(-1, 1, 1)).toThrow();
    expect(() => proportionalShare(1, 1, 0)).toThrow();
    expect(() => proportionalShare(1.5, 1, 1)).toThrow();
  });
});

describe("when an earning becomes available", () => {
  it("is the sale date plus the refund window plus the buffer", () => {
    const paid = new Date("2026-11-01T10:00:00Z");
    expect(availableAtFor(paid, 14, 7).toISOString()).toBe("2026-11-22T10:00:00.000Z"); // 21 days
    expect(availableAtFor(paid, 0, 0).getTime()).toBe(paid.getTime());
    expect(availableAtFor(paid, 30, 0).toISOString()).toBe("2026-12-01T10:00:00.000Z");
  });
});

describe("what a coach sees of the buyer", () => {
  it("is the first name and last initial, nothing more", () => {
    expect(buyerLabel("Maria Santos")).toBe("Maria S.");
    expect(buyerLabel("  maria   de la cruz ")).toBe("maria C.");
    expect(buyerLabel("Maria")).toBe("Maria");
    expect(buyerLabel("")).toBe("A learner");
    expect(buyerLabel(null)).toBe("A learner");
  });
});

describe("reading amounts without floats", () => {
  it("parses plain, formatted, and prefixed amounts to minor units", () => {
    expect(parseMoneyToMinor("102.47")).toBe(10_247);
    expect(parseMoneyToMinor("₱1,250.00")).toBe(125_000);
    expect(parseMoneyToMinor("PHP 12")).toBe(1200);
    expect(parseMoneyToMinor("0.5")).toBe(50);
    expect(parseMoneyToMinor("1,234,567.89")).toBe(123_456_789);
    for (const bad of ["", "abc", "-5", "1.234", "12.", ".5", "1e3"]) expect(parseMoneyToMinor(bad), bad).toBeNull();
  });
});

describe("reading a settlement report", () => {
  it("finds the reference and fee columns by loose header names and reads every row", () => {
    const csv = "Settlement date,Payment ID,Gross,MDR\n2026-11-02,pay_1,2499.00,102.47\n2026-11-02,pay_2,\"1,000.00\",\"41.00\"\n";
    const r = parseFeeCsv(csv);
    expect(r.error).toBeUndefined();
    expect(r.rows).toEqual([
      { line: 2, reference: "pay_1", feeMinor: 10_247 },
      { line: 3, reference: "pay_2", feeMinor: 4100 },
    ]);
  });

  it("accepts other header spellings and a byte-order mark", () => {
    const r = parseFeeCsv("﻿request reference number,Transaction Fee\r\nrrn1,5.00\r\n");
    expect(r.rows).toEqual([{ line: 2, reference: "rrn1", feeMinor: 500 }]);
  });

  it("reports unusable rows without dropping the good ones", () => {
    const r = parseFeeCsv("reference,fee\nok,1.00\n,2.00\nbad,abc\n");
    expect(r.rows[0]).toEqual({ line: 2, reference: "ok", feeMinor: 100 });
    expect(r.rows[1]).toMatchObject({ line: 3, feeMinor: null, error: "No reference." });
    expect(r.rows[2]).toMatchObject({ line: 4, feeMinor: null });
    expect(r.rows[2].error).toContain("not an amount");
  });

  it("explains a missing column or an empty file", () => {
    expect(parseFeeCsv("date,amount\n2026-01-01,5\n").error).toMatch(/Could not find the columns/);
    expect(parseFeeCsv("reference,fee\n").error).toMatch(/header row and at least one data row/);
    expect(parseFeeCsv("").error).toMatch(/header row/);
  });
});
