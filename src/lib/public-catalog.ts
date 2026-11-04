/**
 * The public catalog's query: what the visitor typed or picked, parsed from the address, and the address built back from
 * it. Every choice lives in the URL so a filtered view can be shared. Unknown or malformed values fall back to the default
 * instead of failing, so a hand-edited address never errors.
 */

export const CATALOG_PAGE_SIZE = 12;

/** Lesson types a visitor can open as a free preview. Quizzes, assignments and assessments need an enrolment. */
export const PREVIEWABLE_TYPES = ["VIDEO", "AUDIO", "TEXT", "DOCUMENT", "LINK"] as const;
export function isPreviewable(contentType: string): boolean {
  return (PREVIEWABLE_TYPES as readonly string[]).includes(contentType);
}

export const CATALOG_SORTS = ["popular", "newest", "rating", "price-low", "price-high"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];
export const CATALOG_SORT_LABELS: Record<CatalogSort, string> = {
  popular: "Most popular",
  newest: "Newest",
  rating: "Highest rated",
  "price-low": "Price: low to high",
  "price-high": "Price: high to low",
};

export const CATALOG_LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;
export type CatalogLevel = (typeof CATALOG_LEVELS)[number];

export type CatalogPrice = "any" | "free" | "paid";

export type CatalogQuery = {
  q: string;
  /** Category slug. */
  category: string | null;
  price: CatalogPrice;
  /** Paid range in whole currency units (so 500 means 500.00); only used when `price` is "paid". */
  min: number | null;
  max: number | null;
  level: CatalogLevel | null;
  /** Only courses with at least one free-preview lesson. */
  preview: boolean;
  sort: CatalogSort;
  page: number;
};

export const DEFAULT_CATALOG_QUERY: CatalogQuery = { q: "", category: null, price: "any", min: null, max: null, level: null, preview: false, sort: "popular", page: 1 };

type Params = Record<string, string | string[] | undefined>;

function one(p: Params, key: string): string {
  const v = p[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

function amount(raw: string): number | null {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(raw)) return null;
  return Number(raw);
}

export function parseCatalogQuery(p: Params): CatalogQuery {
  const price = one(p, "price");
  const level = one(p, "level").toUpperCase();
  const sort = one(p, "sort");
  const page = Number.parseInt(one(p, "page"), 10);
  const category = one(p, "category").toLowerCase();
  const kind: CatalogPrice = price === "free" || price === "paid" ? price : "any";
  return {
    q: one(p, "q").slice(0, 80),
    category: /^[a-z0-9-]{1,60}$/.test(category) ? category : null,
    price: kind,
    min: kind === "paid" ? amount(one(p, "min")) : null,
    max: kind === "paid" ? amount(one(p, "max")) : null,
    level: (CATALOG_LEVELS as readonly string[]).includes(level) ? (level as CatalogLevel) : null,
    preview: one(p, "preview") === "1",
    sort: (CATALOG_SORTS as readonly string[]).includes(sort) ? (sort as CatalogSort) : "popular",
    page: Number.isInteger(page) && page >= 1 && page <= 500 ? page : 1,
  };
}

/** The address for `base` with `query` applied; values equal to the default are left out so addresses stay short. */
export function catalogHref(base: string, query: Partial<CatalogQuery>): string {
  const q = { ...DEFAULT_CATALOG_QUERY, ...query };
  const sp = new URLSearchParams();
  if (q.q) sp.set("q", q.q);
  if (q.category) sp.set("category", q.category);
  if (q.price !== "any") sp.set("price", q.price);
  if (q.price === "paid" && q.min !== null) sp.set("min", String(q.min));
  if (q.price === "paid" && q.max !== null) sp.set("max", String(q.max));
  if (q.level) sp.set("level", q.level);
  if (q.preview) sp.set("preview", "1");
  if (q.sort !== "popular") sp.set("sort", q.sort);
  if (q.page > 1) sp.set("page", String(q.page));
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

/** True when the visitor has not searched, filtered, or reordered (the page then shows the featured row). */
export function isUnfiltered(q: CatalogQuery): boolean {
  return !q.q && !q.category && q.price === "any" && !q.level && !q.preview && q.sort === "popular";
}

export type CatalogSortable = { sortEnrolled: number; ratingAverage: number | null; ratingCount: number; priceCents: number; publishedAt: string | null; title: string };

function byTitle(a: CatalogSortable, b: CatalogSortable) {
  return a.title.localeCompare(b.title);
}

/** Orders cards for a sort choice. Ties fall back to the title so the order is stable between requests. */
export function sortCatalog<T extends CatalogSortable>(rows: T[], sort: CatalogSort): T[] {
  const out = [...rows];
  const when = (r: T) => (r.publishedAt ? Date.parse(r.publishedAt) : 0);
  const rank = (r: T) => (r.ratingAverage ?? 0) * Math.log10(r.ratingCount + 1);
  out.sort((a, b) => {
    switch (sort) {
      case "newest":
        return when(b) - when(a) || byTitle(a, b);
      case "rating":
        return rank(b) - rank(a) || b.sortEnrolled - a.sortEnrolled || byTitle(a, b);
      case "price-low":
        return a.priceCents - b.priceCents || byTitle(a, b);
      case "price-high":
        return b.priceCents - a.priceCents || byTitle(a, b);
      default:
        return b.sortEnrolled - a.sortEnrolled || rank(b) - rank(a) || byTitle(a, b);
    }
  });
  return out;
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
}

/** Course length for a card: summed lesson durations when they are known, otherwise the coach's estimate. */
export function courseMinutes(lessonSeconds: number, estimatedMinutes: number | null): number | null {
  if (lessonSeconds > 0) return Math.max(1, Math.round(lessonSeconds / 60));
  return estimatedMinutes && estimatedMinutes > 0 ? estimatedMinutes : null;
}

export function durationLabel(minutes: number | null): string | null {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
