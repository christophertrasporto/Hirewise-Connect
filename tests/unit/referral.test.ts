import { describe, expect, it } from "vitest";
import { randomInt } from "node:crypto";
import { codePrefix, makeReferralCode, isReferralCodeShape, normalizeEmail, firstNameLastInitial, commissionBase, commissionAmount, rateLabel, digitsOnly } from "@/lib/referral";
import { maskAccount } from "@/server/views/referral.views";

describe("referral codes", () => {
  it("builds FIRSTNAME-XXXXXX from a name and six unambiguous characters", () => {
    const code = makeReferralCode("Maria Santos", randomInt);
    expect(code).toMatch(/^MARIA-[A-HJ-KM-NP-Z2-9]{6}$/);
    expect(isReferralCodeShape(code)).toBe(true);
    for (let i = 0; i < 300; i++) expect(makeReferralCode("Jo", randomInt)).not.toMatch(/-[^-]*[01ILO]/);
  });

  it("falls back to HIRE and strips accents, symbols, and long names", () => {
    expect(codePrefix(null)).toBe("HIRE");
    expect(codePrefix("名前")).toBe("HIRE");
    expect(codePrefix("José R.")).toBe("JOSE");
    expect(codePrefix("Bartholomew-Alexander Q")).toBe("BARTHOLO");
    expect(codePrefix("X")).toBe("HIRE");
  });

  it("rejects malformed codes before any database lookup", () => {
    for (const bad of ["", null, undefined, "maria-7k2qx9", "MARIA7K2QX9", "MARIA-7K2Q", "MARIA-7K2QX90", "A-7K2QX9", "MARIA-0OIL11", "MARIA-7K2QX9'; DROP TABLE"]) expect(isReferralCodeShape(bad as string)).toBe(false);
  });

  it("makes different codes for the same name", () => {
    expect(new Set(Array.from({ length: 200 }, () => makeReferralCode("Maria", randomInt))).size).toBe(200);
  });
});

describe("email and phone normalization (fraud flags)", () => {
  it("collapses plus tags, case, and Gmail dots", () => {
    expect(normalizeEmail("Maria@Talent.Example")).toBe("maria@talent.example");
    expect(normalizeEmail("maria+promo@talent.example")).toBe("maria@talent.example");
    expect(normalizeEmail("m.a.r.i.a+x@gmail.com")).toBe("maria@gmail.com");
    expect(normalizeEmail("maria@googlemail.com")).toBe("maria@gmail.com");
    // Dots matter on other domains.
    expect(normalizeEmail("m.aria@talent.example")).toBe("m.aria@talent.example");
  });

  it("keeps digits only for phone comparison", () => {
    expect(digitsOnly("+63 (917) 555-0100")).toBe("639175550100");
    expect(digitsOnly(null)).toBe("");
  });
});

describe("buyer privacy", () => {
  it("shows first name and last initial only", () => {
    expect(firstNameLastInitial("Maria Santos Cruz")).toBe("Maria C.");
    expect(firstNameLastInitial("Jose R.")).toBe("Jose R.");
    expect(firstNameLastInitial("Madonna")).toBe("Madonna");
    expect(firstNameLastInitial("  ")).toBe("Member");
    expect(firstNameLastInitial(null)).toBe("Member");
  });

  it("masks payout account numbers", () => {
    expect(maskAccount("09171234567")).toBe("*******4567");
    expect(maskAccount("12")).toBe("****");
  });
});

describe("commission math (integer minor units)", () => {
  it("is the rate times the amount actually paid, rounded down", () => {
    expect(commissionAmount(4900, 1500)).toBe(735);
    expect(commissionAmount(4999, 1500)).toBe(749); // 749.85 never rounds up
    expect(commissionAmount(1, 1500)).toBe(0);
    expect(commissionAmount(10_000, 0)).toBe(0);
    expect(commissionAmount(10_000, 10_000)).toBe(10_000);
    expect(commissionAmount(123_456_789, 1500)).toBe(18_518_518);
  });

  it("works on what was paid after discounts, minus taxes and fees, and never above the list price", () => {
    // A coupon took 10000 down to 8000, the processor kept 200, tax collected 500: earn on 7300.
    expect(commissionBase({ paid: 8000, taxes: 500, fees: 200, listPrice: 10_000 })).toBe(7300);
    expect(commissionAmount(7300, 1500)).toBe(1095);
    // Paying more than the list price earns on the price.
    expect(commissionBase({ paid: 12_000, listPrice: 10_000 })).toBe(10_000);
    // Taxes and fees can never push the base below zero.
    expect(commissionBase({ paid: 100, taxes: 80, fees: 80 })).toBe(0);
    expect(commissionBase({ paid: 0 })).toBe(0);
  });

  it("refuses floats, negatives, and out-of-range rates", () => {
    expect(() => commissionBase({ paid: 49.99 })).toThrow(/integers/);
    expect(() => commissionBase({ paid: -1 })).toThrow();
    expect(() => commissionBase({ paid: 100, fees: 0.5 })).toThrow();
    expect(() => commissionAmount(49.5, 1500)).toThrow();
    expect(() => commissionAmount(100, 15.5)).toThrow();
    expect(() => commissionAmount(100, -1)).toThrow();
    expect(() => commissionAmount(100, 10_001)).toThrow();
  });

  it("labels rates", () => {
    expect(rateLabel(1500)).toBe("15%");
    expect(rateLabel(1250)).toBe("12.5%");
    expect(rateLabel(0)).toBe("0%");
  });
});
