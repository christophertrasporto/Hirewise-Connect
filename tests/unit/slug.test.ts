import { describe, expect, it } from "vitest";
import { baseSlug, firstFreeSlug, isReservedSlug, slugify, slugProblem, SLUG_MAX } from "@/lib/slug";

describe("slugify", () => {
  it("lower-cases, strips accents and punctuation, and joins words with single hyphens", () => {
    expect(slugify("Cold Calling Masterclass!")).toBe("cold-calling-masterclass");
    expect(slugify("  Café  &  Crème -- Brûlée ")).toBe("cafe-creme-brulee");
    expect(slugify("Sales 101: The Basics")).toBe("sales-101-the-basics");
  });

  it("returns an empty string when nothing usable is left", () => {
    expect(slugify("")).toBe("");
    expect(slugify("!!! ???")).toBe("");
    expect(slugify("日本語")).toBe("");
  });

  it("cuts at the limit without leaving a trailing hyphen", () => {
    const s = slugify("word ".repeat(40));
    expect(s.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("baseSlug", () => {
  it("falls back when the text leaves nothing, and never returns a reserved word", () => {
    expect(baseSlug("???", "course")).toBe("course"); // "course" is not reserved (only "courses" is)
    expect(baseSlug("Category", "course")).toBe("category-course");
    expect(baseSlug("New", "coach")).toBe("new-coach");
    expect(baseSlug("Hello World", "course")).toBe("hello-world");
  });
});

describe("slugProblem", () => {
  it("accepts a clean slug and explains each refusal", () => {
    expect(slugProblem("cold-calling-101")).toBeNull();
    expect(slugProblem("ab")).toMatch(/at least 3/);
    expect(slugProblem("a".repeat(SLUG_MAX + 1))).toMatch(/at most/);
    for (const bad of ["Has-Caps", "has space", "-leading", "trailing-", "double--hyphen", "under_score", "dot.dot", "ünï"]) expect(slugProblem(bad), bad).toMatch(/lower-case/);
    for (const word of ["category", "courses", "api", "buy"]) expect(slugProblem(word), word).toMatch(/reserved/);
    expect(isReservedSlug("cold-calling")).toBe(false);
  });
});

describe("firstFreeSlug", () => {
  it("returns the base when free, then numbers upward", async () => {
    const taken = new Set(["a-slug", "a-slug-2", "a-slug-3"]);
    expect(await firstFreeSlug("fresh", async (c) => taken.has(c))).toBe("fresh");
    expect(await firstFreeSlug("a-slug", async (c) => taken.has(c))).toBe("a-slug-4");
  });

  it("keeps the numbered slug inside the length limit", async () => {
    const base = "x".repeat(SLUG_MAX);
    const out = await firstFreeSlug(base, async (c) => c === base);
    expect(out.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(out.endsWith("-2")).toBe(true);
  });
});
