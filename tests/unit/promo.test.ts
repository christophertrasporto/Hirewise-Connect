import { describe, expect, it } from "vitest";
import { computeDiscount, discountLabel, evaluatePromo, generateCode, isValidCodeFormat, normalizeCode, PROMO_REFUSAL_MESSAGE, type PromoFacts } from "@/lib/promo";

describe("codes", () => {
  it("normalises case and spaces and checks the format", () => {
    expect(normalizeCode(" spring 20 ")).toBe("SPRING20");
    for (const ok of ["ABC", "SPRING-20", "HW-4X7K2P", "A1B"]) expect(isValidCodeFormat(ok), ok).toBe(true);
    for (const bad of ["AB", "-ABC", "ab c", "A".repeat(33), "SPRING_20", "SPRING!"]) expect(isValidCodeFormat(bad), bad).toBe(false);
  });

  it("generates codes that pass the format and avoid look-alike characters", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateCode();
      expect(isValidCodeFormat(c)).toBe(true);
      expect(c.slice(3)).not.toMatch(/[01OI]/);
    }
    expect(generateCode("X", () => 0)).toBe("X-AAAAAA");
  });
});

describe("computeDiscount", () => {
  const php = (listMinor: number) => ({ listMinor, currency: "PHP" });
  it("percent rounds the discount down to the centavo", () => {
    expect(computeDiscount({ type: "PERCENT", percentBps: 2000 }, php(100_000))).toEqual({ discountMinor: 20_000, finalMinor: 80_000 });
    expect(computeDiscount({ type: "PERCENT", percentBps: 3333 }, php(10_000))).toEqual({ discountMinor: 3333, finalMinor: 6667 });
    expect(computeDiscount({ type: "PERCENT", percentBps: 1 }, php(99))).toEqual({ discountMinor: 0, finalMinor: 99 });
    expect(computeDiscount({ type: "PERCENT", percentBps: 10_000 }, php(49_900))).toEqual({ discountMinor: 49_900, finalMinor: 0 });
  });

  it("an amount never exceeds the price and only applies in its currency", () => {
    expect(computeDiscount({ type: "AMOUNT", amountMinor: 20_000, currency: "PHP" }, php(100_000))).toEqual({ discountMinor: 20_000, finalMinor: 80_000 });
    expect(computeDiscount({ type: "AMOUNT", amountMinor: 200_000, currency: "PHP" }, php(100_000))).toEqual({ discountMinor: 100_000, finalMinor: 0 });
    expect(computeDiscount({ type: "AMOUNT", amountMinor: 1000, currency: "USD" }, php(100_000))).toBeNull();
  });

  it("refuses nonsense instead of guessing", () => {
    expect(() => computeDiscount({ type: "PERCENT", percentBps: 0 }, php(100))).toThrow();
    expect(() => computeDiscount({ type: "PERCENT", percentBps: 10_001 }, php(100))).toThrow();
    expect(() => computeDiscount({ type: "PERCENT", percentBps: 1000.5 }, php(100))).toThrow();
    expect(() => computeDiscount({ type: "AMOUNT", amountMinor: 0, currency: "PHP" }, php(100))).toThrow();
    expect(() => computeDiscount({ type: "PERCENT", percentBps: 1000 }, php(-1))).toThrow();
    expect(() => computeDiscount({ type: "PERCENT", percentBps: 1000 }, php(1.5))).toThrow();
  });

  it("the final price plus the discount is always the price, and never negative", () => {
    for (const list of [1, 7, 99, 100, 4999, 49_900, 1_000_000]) {
      for (const bps of [1, 500, 3333, 5000, 9999, 10_000]) {
        const r = computeDiscount({ type: "PERCENT", percentBps: bps }, { listMinor: list, currency: "PHP" })!;
        expect(r.discountMinor + r.finalMinor).toBe(list);
        expect(r.finalMinor).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(r.discountMinor)).toBe(true);
      }
    }
  });
});

describe("evaluatePromo", () => {
  const facts = (over: Partial<PromoFacts> = {}): PromoFacts => ({ status: "ACTIVE", startsAt: null, endsAt: null, maxRedemptions: null, perLearnerLimit: 1, minPriceMinor: 0, appliesTo: "ALL_COURSES", courseIds: [], discount: { type: "PERCENT", percentBps: 2000 }, ...over });
  const ctx = (over: Partial<Parameters<typeof evaluatePromo>[1]> = {}) => ({ now: new Date("2026-11-15T00:00:00Z"), courseId: "c1", listMinor: 100_000, currency: "PHP", usedTotal: 0, usedByLearner: 0, ...over });
  const reason = (p: PromoFacts, c = ctx()) => {
    const r = evaluatePromo(p, c);
    return r.ok ? "ok" : r.reason;
  };

  it("accepts a valid code and returns the price", () => {
    expect(evaluatePromo(facts(), ctx())).toEqual({ ok: true, discountMinor: 20_000, finalMinor: 80_000 });
  });

  it("refuses each way a code can be unusable", () => {
    expect(reason(facts({ status: "PAUSED" }))).toBe("NOT_ACTIVE");
    expect(reason(facts({ status: "ARCHIVED" }))).toBe("NOT_ACTIVE");
    expect(reason(facts({ startsAt: new Date("2026-12-01T00:00:00Z") }))).toBe("NOT_STARTED");
    expect(reason(facts({ endsAt: new Date("2026-11-01T00:00:00Z") }))).toBe("EXPIRED");
    expect(reason(facts({ appliesTo: "SELECTED_COURSES", courseIds: ["c2"] }))).toBe("NOT_FOR_COURSE");
    expect(reason(facts({ minPriceMinor: 200_000 }))).toBe("BELOW_MINIMUM");
    expect(reason(facts({ discount: { type: "AMOUNT", amountMinor: 100, currency: "USD" } }))).toBe("CURRENCY_MISMATCH");
    expect(reason(facts({ maxRedemptions: 5 }), ctx({ usedTotal: 5 }))).toBe("FULLY_USED");
    expect(reason(facts({ perLearnerLimit: 2 }), ctx({ usedByLearner: 2 }))).toBe("LEARNER_LIMIT");
    expect(reason(facts(), ctx({ listMinor: 0 }))).toBe("NOTHING_TO_DISCOUNT");
  });

  it("boundaries: the end instant is exclusive, the start instant is inclusive, the last use is allowed", () => {
    const at = new Date("2026-11-15T00:00:00Z");
    expect(reason(facts({ endsAt: at }), ctx({ now: at }))).toBe("EXPIRED");
    expect(reason(facts({ startsAt: at }), ctx({ now: at }))).toBe("ok");
    expect(reason(facts({ maxRedemptions: 5 }), ctx({ usedTotal: 4 }))).toBe("ok");
    expect(reason(facts({ minPriceMinor: 100_000 }))).toBe("ok");
    expect(reason(facts({ appliesTo: "SELECTED_COURSES", courseIds: ["c1", "c2"] }))).toBe("ok");
  });

  it("the learner-facing message is the same whatever the reason", () => {
    expect(PROMO_REFUSAL_MESSAGE).toBe("This code isn't valid for this course.");
  });
});

describe("labels", () => {
  it("describes a discount for staff and learners", () => {
    expect(discountLabel({ type: "PERCENT", percentBps: 2000 })).toBe("20% off");
    expect(discountLabel({ type: "PERCENT", percentBps: 1250 })).toBe("12.5% off");
    expect(discountLabel({ type: "PERCENT", percentBps: 10_000 })).toBe("100% off");
    expect(discountLabel({ type: "AMOUNT", amountMinor: 20_000, currency: "PHP" })).toContain("200.00 off");
  });
});
