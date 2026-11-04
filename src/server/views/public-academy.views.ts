import type { CardRow } from "@/server/repositories/public-catalog.repository";
import { courseMinutes, durationLabel, isPreviewable } from "@/lib/public-catalog";
import { priceLabel } from "@/server/views/academy.views";

/**
 * Allow-list views for the public Academy pages. Visitors may be signed out and the pages are cached and shared by
 * everyone, so these carry no storage key, no email, no user id of a learner, and nothing about the visitor. Every field is
 * a plain value (dates are ISO strings) so a view can pass through the page cache unchanged.
 */

export type PublicCoachRef = { name: string; /** Set only when that coach's page is live. */ slug: string | null };

export type PublicCourseCard = {
  id: string;
  slug: string;
  href: string;
  title: string;
  summary: string;
  category: string;
  categorySlug: string | null;
  difficulty: string;
  priceCents: number;
  currency: string;
  priceLabel: string;
  /** A stable public address for the cover image, or null when the course has none (a generated cover is drawn instead). */
  coverUrl: string | null;
  coaches: PublicCoachRef[];
  lessonCount: number;
  minutes: number | null;
  durationLabel: string | null;
  hasPreview: boolean;
  ratingAverage: number | null;
  ratingCount: number;
  /** Null when the Admin hid the count for this course (it is still used to order "most popular"). */
  enrolled: number | null;
};

/** What the catalog sorts by: the card plus fields that are never shown. */
export type SortableCard = PublicCourseCard & { sortEnrolled: number; publishedAt: string | null; featuredRank: number | null };

export function coverUrlFor(c: { id: string; thumbnailKey: string | null; updatedAt: Date }): string | null {
  return c.thumbnailKey ? `/api/academy/thumbnail/${c.id}?v=${c.updatedAt.getTime()}` : null;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export function toSortableCard(c: CardRow, extra: { enrolled: number; rating: { count: number; average: number } | undefined; coaches: PublicCoachRef[] }): SortableCard {
  const lessons = c.modules.flatMap((m) => m.lessons);
  const seconds = lessons.reduce((n, l) => n + (l.durationSec ?? 0), 0);
  const minutes = courseMinutes(seconds, c.estimatedMinutes);
  const rating = extra.rating && extra.rating.count > 0 ? extra.rating : undefined;
  return {
    id: c.id,
    slug: c.slug,
    href: `/academy/${c.slug}`,
    title: c.title,
    summary: clip(c.pitch || c.description, 160),
    category: c.categoryRef?.name ?? c.category,
    categorySlug: c.categoryRef?.slug ?? null,
    difficulty: c.difficulty,
    priceCents: c.priceCents,
    currency: c.currency,
    priceLabel: priceLabel(c.priceCents, c.currency),
    coverUrl: coverUrlFor(c),
    coaches: extra.coaches,
    lessonCount: lessons.length,
    minutes,
    durationLabel: durationLabel(minutes),
    hasPreview: lessons.some((l) => l.isFreePreview && isPreviewable(l.contentType)),
    ratingAverage: rating ? Math.round(rating.average * 10) / 10 : null,
    ratingCount: rating?.count ?? 0,
    enrolled: c.hideEnrolledCount ? null : extra.enrolled,
    sortEnrolled: extra.enrolled,
    publishedAt: c.publishedAt ? c.publishedAt.toISOString() : null,
    featuredRank: c.featuredRank,
  };
}

export function toCard(s: SortableCard): PublicCourseCard {
  const { sortEnrolled: _e, publishedAt: _p, featuredRank: _f, ...card } = s;
  return card;
}

export type PublicLessonRow = { id: string; title: string; contentType: string; durationSec: number | null; /** True only for a previewable free-preview lesson. */ isFreePreview: boolean };

/** A free-preview lesson as the public page plays it. Only these lessons ever carry a link or text body. */
export type PreviewLesson = {
  id: string;
  title: string;
  contentType: "VIDEO" | "AUDIO" | "TEXT" | "DOCUMENT" | "LINK";
  durationSec: number | null;
  description: string | null;
  /** Markdown, TEXT lessons only. */
  body: string | null;
  /** External address, VIDEO and LINK lessons that are not uploads. */
  url: string | null;
  hasFile: boolean;
  fileName: string | null;
};

export type PublicCoachBlock = PublicCoachRef & { headline: string | null; bio: string | null; photoUrl: string | null };

export type PublicFaq = { question: string; answer: string };

export type PublicCoursePageView = {
  id: string;
  slug: string;
  title: string;
  description: string;
  pitch: string | null;
  category: string;
  categorySlug: string | null;
  difficulty: string;
  priceCents: number;
  currency: string;
  priceLabel: string;
  coverUrl: string | null;
  /** Unlisted courses are reachable by link but must not be indexed. */
  unlisted: boolean;
  lessonCount: number;
  previewCount: number;
  minutes: number | null;
  durationLabel: string | null;
  certification: string | null;
  learningPoints: string[];
  audience: string | null;
  requirements: string | null;
  faq: PublicFaq[];
  enrolled: number | null;
  ratingAverage: number | null;
  ratingCount: number;
  coaches: PublicCoachBlock[];
  curriculum: Array<{ id: string; title: string; lessons: PublicLessonRow[] }>;
  previews: PreviewLesson[];
  reviews: Array<{ id: string; rating: number; body: string | null; author: string; createdAt: string }>;
  related: PublicCourseCard[];
  publishedAt: string | null;
  updatedAt: string;
};

export type PublicCoachPageView = {
  slug: string;
  displayName: string;
  headline: string | null;
  bio: string | null;
  links: Array<{ label: string; url: string }>;
  photoUrl: string | null;
  students: number;
  ratingAverage: number | null;
  ratingCount: number;
  courses: PublicCourseCard[];
  updatedAt: string;
};
