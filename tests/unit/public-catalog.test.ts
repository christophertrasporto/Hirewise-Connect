import { afterEach, describe, expect, it } from "vitest";
import { CATALOG_PAGE_SIZE, DEFAULT_CATALOG_QUERY, clipText, catalogHref, courseMinutes, durationLabel, isPreviewable, isUnfiltered, pageCount, parseCatalogQuery, sortCatalog, type CatalogSortable } from "@/lib/public-catalog";
import { breadcrumbLd, courseLd, jsonLd, publicMetadata } from "@/lib/seo";
import { absoluteUrl, siteUrl } from "@/lib/site-url";
import { courseCta } from "@/lib/course-cta";

describe("parseCatalogQuery", () => {
  it("falls back to the defaults for an empty or hand-edited address", () => {
    expect(parseCatalogQuery({})).toEqual(DEFAULT_CATALOG_QUERY);
    expect(parseCatalogQuery({ sort: "bogus", level: "expert", price: "cheap", page: "-3", category: "Bad Slug!", preview: "yes" })).toEqual(DEFAULT_CATALOG_QUERY);
    expect(parseCatalogQuery({ page: "abc" }).page).toBe(1);
    expect(parseCatalogQuery({ page: "9999" }).page).toBe(1);
  });

  it("reads every choice", () => {
    expect(parseCatalogQuery({ q: "  cold  ", category: "sales", price: "paid", min: "100", max: "2500.50", level: "intermediate", preview: "1", sort: "rating", page: "3" })).toEqual({
      q: "cold",
      category: "sales",
      price: "paid",
      min: 100,
      max: 2500.5,
      level: "INTERMEDIATE",
      preview: true,
      sort: "rating",
      page: 3,
    });
  });

  it("keeps a price range only for paid courses, and ignores nonsense amounts", () => {
    expect(parseCatalogQuery({ price: "free", min: "100", max: "200" })).toMatchObject({ price: "free", min: null, max: null });
    expect(parseCatalogQuery({ price: "paid", min: "-5", max: "1e9" })).toMatchObject({ min: null, max: null });
  });

  it("takes the first value of a repeated parameter and caps the search text", () => {
    expect(parseCatalogQuery({ sort: ["newest", "rating"] }).sort).toBe("newest");
    expect(parseCatalogQuery({ q: "x".repeat(500) }).q).toHaveLength(80);
  });
});

describe("catalogHref", () => {
  it("leaves out defaults so the plain catalog has the plain address", () => {
    expect(catalogHref("/academy", {})).toBe("/academy");
    expect(catalogHref("/academy", { page: 1, sort: "popular" })).toBe("/academy");
  });

  it("round-trips a query through the address", () => {
    const query = { ...DEFAULT_CATALOG_QUERY, q: "cold calling", category: "sales", price: "paid" as const, min: 100, max: 900, level: "ADVANCED" as const, preview: true, sort: "price-low" as const, page: 2 };
    const href = catalogHref("/academy", query);
    const sp = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseCatalogQuery(sp)).toEqual(query);
  });

  it("never writes a ref code, and a price range only for paid", () => {
    expect(catalogHref("/academy", { price: "free", min: 5 })).toBe("/academy?price=free");
    expect(catalogHref("/academy", {})).not.toContain("ref");
  });

  it("knows an unfiltered view", () => {
    expect(isUnfiltered(parseCatalogQuery({}))).toBe(true);
    expect(isUnfiltered(parseCatalogQuery({ page: "2" }))).toBe(true);
    for (const p of [{ q: "x" }, { category: "sales" }, { price: "free" }, { level: "BEGINNER" }, { preview: "1" }, { sort: "newest" }]) expect(isUnfiltered(parseCatalogQuery(p))).toBe(false);
  });
});

describe("sortCatalog", () => {
  const row = (title: string, o: Partial<CatalogSortable> = {}): CatalogSortable => ({ title, sortEnrolled: 0, ratingAverage: null, ratingCount: 0, priceCents: 0, publishedAt: null, ...o });
  const rows = [
    row("B", { sortEnrolled: 5, ratingAverage: 4, ratingCount: 2, priceCents: 500, publishedAt: "2026-01-01T00:00:00Z" }),
    row("A", { sortEnrolled: 5, priceCents: 500, publishedAt: "2026-03-01T00:00:00Z" }),
    row("C", { sortEnrolled: 9, ratingAverage: 5, ratingCount: 1, priceCents: 100, publishedAt: "2026-02-01T00:00:00Z" }),
  ];
  const order = (s: Parameters<typeof sortCatalog>[1]) => sortCatalog(rows, s).map((r) => r.title);

  it("orders each way, breaking ties by title so pages are stable", () => {
    expect(order("popular")).toEqual(["C", "B", "A"]);
    expect(order("newest")).toEqual(["A", "C", "B"]);
    expect(order("rating")).toEqual(["B", "C", "A"]);
    expect(order("price-low")).toEqual(["C", "A", "B"]);
    expect(order("price-high")).toEqual(["A", "B", "C"]);
  });

  it("does not change the input", () => {
    const before = rows.map((r) => r.title);
    sortCatalog(rows, "price-high");
    expect(rows.map((r) => r.title)).toEqual(before);
  });
});

describe("clipText", () => {
  it("collapses whitespace without touching any letter", () => {
    expect(clipText("  Tier-1   support\n fundamentals for US and Australian accounts ", 200)).toBe("Tier-1 support fundamentals for US and Australian accounts");
  });

  it("cuts long text to the limit with an ellipsis, and leaves short text alone", () => {
    expect(clipText("short", 10)).toBe("short");
    const cut = clipText("word ".repeat(100), 20);
    expect(cut.length).toBeLessThanOrEqual(20);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("paging and durations", () => {
  it("pages of 12", () => {
    expect(CATALOG_PAGE_SIZE).toBe(12);
    expect([0, 1, 12, 13, 24, 25].map(pageCount)).toEqual([1, 1, 1, 2, 2, 3]);
  });

  it("uses lesson time when known, otherwise the coach's estimate", () => {
    expect(courseMinutes(600, 99)).toBe(10);
    expect(courseMinutes(20, null)).toBe(1);
    expect(courseMinutes(0, 45)).toBe(45);
    expect(courseMinutes(0, null)).toBeNull();
    expect([null, 5, 60, 95, 120].map(durationLabel)).toEqual([null, "5 min", "1 h", "1 h 35 min", "2 h"]);
  });

  it("previews are limited to content a visitor can open without enrolling", () => {
    for (const t of ["VIDEO", "AUDIO", "TEXT", "DOCUMENT", "LINK"]) expect(isPreviewable(t)).toBe(true);
    for (const t of ["QUIZ", "ASSESSMENT", "ASSIGNMENT"]) expect(isPreviewable(t)).toBe(false);
  });
});

type Ld = { "@type": string; offers: { category: string }; aggregateRating?: unknown; instructor?: unknown; image?: unknown };

describe("site address and SEO", () => {
  const saved = { app: process.env.APP_URL, vercel: process.env.VERCEL_PROJECT_PRODUCTION_URL };
  afterEach(() => {
    if (saved.app === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = saved.app;
    if (saved.vercel === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    else process.env.VERCEL_PROJECT_PRODUCTION_URL = saved.vercel;
  });

  it("builds absolute addresses from APP_URL, dropping any path or trailing slash", () => {
    process.env.APP_URL = "https://connect.example.com/";
    expect(siteUrl()).toBe("https://connect.example.com");
    expect(absoluteUrl("/academy/x")).toBe("https://connect.example.com/academy/x");
    expect(absoluteUrl("academy")).toBe("https://connect.example.com/academy");
  });

  it("falls back to the Vercel production domain, then to localhost", () => {
    delete process.env.APP_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "hirewise.vercel.app";
    expect(siteUrl()).toBe("https://hirewise.vercel.app");
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    expect(siteUrl()).toBe("http://localhost:3000");
    process.env.APP_URL = "not a url";
    expect(siteUrl()).toBe("http://localhost:3000");
  });

  it("gives a canonical address with no query, noindex when asked, and a share card with the image", () => {
    process.env.APP_URL = "https://connect.example.com";
    const m = publicMetadata({ title: "Cold Calling", description: "Learn.", path: "/academy/cold-calling", image: "/api/academy/thumbnail/abc?v=1", noindex: true });
    expect(m.alternates?.canonical).toBe("https://connect.example.com/academy/cold-calling");
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.openGraph).toMatchObject({ url: "https://connect.example.com/academy/cold-calling", images: [{ url: "https://connect.example.com/api/academy/thumbnail/abc?v=1" }] });
    expect(m.twitter).toMatchObject({ card: "summary_large_image" });
    expect(publicMetadata({ title: "T", description: "D", path: "/academy" }).robots).toBeUndefined();
    expect(publicMetadata({ title: "T", description: "D", path: "/academy" }).twitter).toMatchObject({ card: "summary" });
  });

  it("escapes < in structured data so page text cannot close the script tag", () => {
    expect(jsonLd({ a: "</script><script>alert(1)</script>" })).not.toContain("</script>");
    expect(JSON.parse(jsonLd({ a: "</script>" }))).toEqual({ a: "</script>" });
  });

  it("describes a course with its offer, rating and instructors", () => {
    process.env.APP_URL = "https://connect.example.com";
    const ld = courseLd({ slug: "cold", title: "Cold", description: "D", difficulty: "BEGINNER", priceCents: 150_000, currency: "PHP", image: "/api/academy/thumbnail/x", ratingAverage: 4.5, ratingCount: 10, coaches: [{ name: "Maria", slug: "maria" }, { name: "Private", slug: null }] }) as unknown as Ld;
    expect(ld["@type"]).toBe("Course");
    expect(ld.offers).toMatchObject({ price: "1500.00", priceCurrency: "PHP", category: "Paid" });
    expect(ld.aggregateRating).toMatchObject({ ratingValue: 4.5, ratingCount: 10 });
    expect(ld.instructor).toEqual([{ "@type": "Person", name: "Maria", url: "https://connect.example.com/coaches/maria" }, { "@type": "Person", name: "Private" }]);
    const none = courseLd({ slug: "c", title: "C", description: "D", difficulty: "ADVANCED", priceCents: 0, currency: "PHP", image: null, ratingAverage: null, ratingCount: 0, coaches: [] }) as unknown as Ld;
    expect(none.aggregateRating).toBeUndefined();
    expect(none.image).toBeUndefined();
    expect(none.offers.category).toBe("Free");
    expect((breadcrumbLd([{ name: "A", path: "/a" }]) as unknown as { itemListElement: unknown[] }).itemListElement[0]).toMatchObject({ position: 1, item: "https://connect.example.com/a" });
  });
});

describe("the main button", () => {
  const c = { id: "course_12345678", priceCents: 1000 };
  it("sends a signed-out visitor to the short sign-up with checkout remembered, and talent to checkout", () => {
    expect(courseCta("SIGNED_OUT", c)).toMatchObject({ label: "Buy course", href: "/api/return/start?to=%2Fcourses%2Fcourse_12345678%2Fbuy&next=register", logIn: "/api/return/start?to=%2Fcourses%2Fcourse_12345678%2Fbuy&next=login" });
    expect(courseCta("SIGNED_OUT", { ...c, priceCents: 0 }).label).toBe("Enrol for free");
    expect(courseCta("CAN_BUY", c)).toMatchObject({ label: "Buy course", href: "/courses/course_12345678/buy" });
    expect(courseCta("PENDING", c)).toMatchObject({ label: "Complete your payment", href: "/courses/course_12345678/buy" });
    expect(courseCta("OWNER", c).href).toBe("/courses/course_12345678");
    expect(courseCta("OWNER", c).label).toBe("Continue learning");
    expect(courseCta("ENDED", c).label).toBe("View course");
  });

  it("offers no button to accounts that cannot buy", () => {
    expect(courseCta("NOT_TALENT", c)).toMatchObject({ label: "", href: "" });
  });
});
