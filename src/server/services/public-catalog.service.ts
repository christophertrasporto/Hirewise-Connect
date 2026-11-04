import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { publicAcademyRepository } from "@/server/repositories/public-academy.repository";
import { publicCatalogRepository, type CardRow, type CoachProfileRow } from "@/server/repositories/public-catalog.repository";
import { CATALOG_PAGE_SIZE, pageCount, sortCatalog, courseMinutes, durationLabel, isPreviewable, type CatalogQuery } from "@/lib/public-catalog";
import { siteUrl } from "@/lib/site-url";
import { priceLabel } from "@/server/views/academy.views";
import {
  toCard,
  toSortableCard,
  coverUrlFor,
  type PreviewLesson,
  type PublicCoachBlock,
  type PublicCoachPageView,
  type PublicCoachRef,
  type PublicCourseCard,
  type PublicCoursePageView,
  type PublicFaq,
  type SortableCard,
} from "@/server/views/public-academy.views";
import { coachNamesFor } from "./coach-profile.service";
import { courseRatingSummary, listCourseReviews } from "./review.service";
import { resolveCoachSlug, resolveCourseSlug } from "./slug.service";
import { canRefer, ensureReferralCode } from "./referral.service";
import { viewerStateFor, type ViewerState } from "./course-public.service";

/**
 * The public Academy: catalog, course pages, category pages, coach pages, and the sitemap. These functions take no actor
 * because their output is the same for everyone and is cached; they return only allow-list views of PUBLISHED courses
 * (LISTED ones for every list, search, category, related-course and sitemap query). An unlisted course is returned only
 * by its own address, and a draft or archived course never. Coaches are named only when their public page is live; the
 * part of an email before the `@` is never shown here.
 */

const repo = publicCatalogRepository;

async function liveCoachRefs(db: Db, userIds: string[]): Promise<Map<string, PublicCoachRef>> {
  const names = await coachNamesFor(db, userIds);
  const out = new Map<string, PublicCoachRef>();
  for (const [id, n] of names) if (n.slug) out.set(id, { name: n.name, slug: n.slug });
  return out;
}

function refsFor(row: CardRow, live: Map<string, PublicCoachRef>): PublicCoachRef[] {
  const ids = [...new Set([row.ownerCoachUserId, ...row.coaches.map((c) => c.coachUserId)])];
  return ids.flatMap((id) => live.get(id) ?? []);
}

async function toSortableCards(db: Db, rows: CardRow[]): Promise<SortableCard[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const coachIds = rows.flatMap((r) => [r.ownerCoachUserId, ...r.coaches.map((c) => c.coachUserId)]);
  const [enrolled, ratings, live] = await Promise.all([repo.enrolledCounts(db, ids), repo.ratingStats(db, ids), liveCoachRefs(db, coachIds)]);
  return rows.map((r) => toSortableCard(r, { enrolled: enrolled.get(r.id) ?? 0, rating: ratings.get(r.id), coaches: refsFor(r, live) }));
}

export type CatalogView = {
  cards: PublicCourseCard[];
  total: number;
  page: number;
  pages: number;
  /** The featured row, only on the first page of an unfiltered catalog. */
  featured: PublicCourseCard[];
};

export async function getCatalog(db: Db, query: CatalogQuery, opts: { withFeatured: boolean }): Promise<CatalogView> {
  const rows = await repo.listedCourses(db, { q: query.q, categorySlug: query.category, level: query.level, price: query.price, min: query.min, max: query.max, preview: query.preview });
  const sorted = sortCatalog(await toSortableCards(db, rows), query.sort);
  const pages = pageCount(sorted.length);
  const page = Math.min(query.page, pages);
  const start = (page - 1) * CATALOG_PAGE_SIZE;
  const featured = opts.withFeatured && page === 1 ? (await toSortableCards(db, await repo.featuredCourses(db))).map(toCard) : [];
  return { cards: sorted.slice(start, start + CATALOG_PAGE_SIZE).map(toCard), total: sorted.length, page, pages, featured };
}

export type CatalogCategory = { name: string; slug: string; count: number };

/** Active categories that have at least one listed course. */
export async function getCatalogCategories(db: Db): Promise<CatalogCategory[]> {
  const rows = await repo.activeCategories(db);
  return rows.map((c) => ({ name: c.name, slug: c.slug, count: c._count.courses })).filter((c) => c.count > 0);
}

export async function getCategory(db: Db, slug: string): Promise<{ name: string; slug: string } | null> {
  const c = await repo.categoryBySlug(db, slug);
  return c ? { name: c.name, slug: c.slug } : null;
}

// ---------------------------------------------------------------------------
// One course
// ---------------------------------------------------------------------------

function faqOf(raw: unknown): PublicFaq[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f) => (f && typeof f === "object" && typeof (f as PublicFaq).question === "string" && typeof (f as PublicFaq).answer === "string" ? [{ question: (f as PublicFaq).question, answer: (f as PublicFaq).answer }] : []));
}

function coachBlock(p: CoachProfileRow): PublicCoachBlock {
  return { name: p.displayName, slug: p.slug, headline: p.headline, bio: p.bio, photoUrl: p.photoKey ? `/api/coach-photo/${p.slug}?v=${p.updatedAt.getTime()}` : null };
}

export type PublicCourseResult = { type: "FOUND"; course: PublicCoursePageView } | { type: "REDIRECT"; slug: string };

/** The page for a course address: the course, a redirect when the address was retired, or null (404). */
export async function getPublicCoursePage(db: Db, slug: string): Promise<PublicCourseResult | null> {
  const resolved = await resolveCourseSlug(db, slug);
  if (!resolved) return null;
  if (resolved.type === "REDIRECT") return { type: "REDIRECT", slug: resolved.slug };
  const c = await repo.courseBySlug(db, slug);
  if (!c) return null;

  const coachUserIds = [...new Set([c.ownerCoachUserId, ...c.coaches.map((x) => x.coachUserId)])];
  const [live, profiles, rating, reviews, enrolled, related] = await Promise.all([
    liveCoachRefs(db, coachUserIds),
    repo.coachProfiles(db, coachUserIds),
    courseRatingSummary(db, c.id),
    listCourseReviews(db, c.id),
    repo.enrolledCounts(db, [c.id]),
    repo.relatedCourses(db, { courseId: c.id, categoryId: c.categoryId, take: 3 }),
  ]);
  const profileByUser = new Map(profiles.map((p) => [p.userId, p]));
  const coaches = coachUserIds.flatMap((id) => {
    const p = profileByUser.get(id);
    return p && live.has(id) ? [coachBlock(p)] : [];
  });

  const lessons = c.modules.flatMap((m) => m.lessons);
  const previews: PreviewLesson[] = lessons
    .filter((l) => l.isFreePreview && isPreviewable(l.contentType))
    .map((l) => ({
      id: l.id,
      title: l.title,
      contentType: l.contentType as PreviewLesson["contentType"],
      durationSec: l.durationSec,
      description: l.description,
      body: l.contentType === "TEXT" ? l.body : null,
      url: (l.contentType === "VIDEO" || l.contentType === "LINK") && !l.storageKey ? l.url : null,
      hasFile: !!l.storageKey,
      fileName: l.fileName,
    }));
  const previewIds = new Set(previews.map((p) => p.id));
  const seconds = lessons.reduce((n, l) => n + (l.durationSec ?? 0), 0);
  const minutes = courseMinutes(seconds, c.estimatedMinutes);

  const relatedCards = (await toSortableCards(db, related)).map(toCard);

  return {
    type: "FOUND",
    course: {
      id: c.id,
      slug: c.slug,
      title: c.title,
      description: c.description,
      pitch: c.pitch,
      category: c.categoryRef?.name ?? c.category,
      categorySlug: c.categoryRef?.slug ?? null,
      difficulty: c.difficulty,
      priceCents: c.priceCents,
      currency: c.currency,
      priceLabel: priceLabel(c.priceCents, c.currency),
      coverUrl: coverUrlFor(c),
      unlisted: c.listing === "UNLISTED",
      lessonCount: lessons.length,
      previewCount: previews.length,
      minutes,
      durationLabel: durationLabel(minutes),
      certification: c.certificationTemplate?.name ?? null,
      learningPoints: c.learningPoints,
      audience: c.audience,
      requirements: c.requirements,
      faq: faqOf(c.faq),
      enrolled: c.hideEnrolledCount ? null : (enrolled.get(c.id) ?? 0),
      ratingAverage: rating.average,
      ratingCount: rating.count,
      coaches,
      // Titles, types and durations for every published lesson. Nothing playable, and no link, body or file for a gated lesson.
      curriculum: c.modules.map((m) => ({ id: m.id, title: m.title, lessons: m.lessons.map((l) => ({ id: l.id, title: l.title, contentType: l.contentType, durationSec: l.durationSec, isFreePreview: previewIds.has(l.id) })) })),
      previews,
      reviews: reviews.map((r) => ({ id: r.id, rating: r.rating, body: r.body, author: r.author, createdAt: r.createdAt.toISOString() })),
      related: relatedCards,
      publishedAt: c.publishedAt ? c.publishedAt.toISOString() : null,
      updatedAt: c.updatedAt.toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// One coach
// ---------------------------------------------------------------------------

export type PublicCoachResult = { type: "FOUND"; coach: PublicCoachPageView } | { type: "REDIRECT"; slug: string };

/** A coach page is live only while the coach has switched it on and has a published, listed course. */
export async function getPublicCoachPage(db: Db, slug: string): Promise<PublicCoachResult | null> {
  const resolved = await resolveCoachSlug(db, slug);
  if (!resolved) return null;
  if (resolved.type === "REDIRECT") return { type: "REDIRECT", slug: resolved.slug };
  const p = await repo.coachBySlug(db, slug);
  if (!p || !p.isPublic) return null;
  const rows = await repo.coachListedCourses(db, p.userId);
  if (rows.length === 0) return null;
  const ids = rows.map((r) => r.id);
  const [cards, students, rating] = await Promise.all([toSortableCards(db, rows), repo.distinctStudents(db, ids), repo.ratingForCourses(db, ids)]);
  return {
    type: "FOUND",
    coach: {
      slug: p.slug,
      displayName: p.displayName,
      headline: p.headline,
      bio: p.bio,
      links: (Array.isArray(p.links) ? (p.links as Array<{ label?: unknown; url?: unknown }>) : []).flatMap((l) => (typeof l.label === "string" && typeof l.url === "string" && l.url.startsWith("https://") ? [{ label: l.label, url: l.url }] : [])),
      photoUrl: coachBlock(p).photoUrl,
      students,
      ratingAverage: rating.average === null ? null : Math.round(rating.average * 10) / 10,
      ratingCount: rating.count,
      courses: sortCatalog(cards, "popular").map(toCard),
      updatedAt: p.updatedAt.toISOString(),
    },
  };
}

/** The current address segment for a published course id, for redirecting the old `/academy/courses/<id>` addresses. */
export async function publicSlugForCourseId(db: Db, courseId: string): Promise<string | null> {
  const c = await publicAcademyRepository.findCourseSlugById(db, courseId);
  return c && c.status === "PUBLISHED" ? c.slug : null;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** The storage key of a published course's cover, for the thumbnail route to sign. Drafts and archived courses answer null. */
export async function publicCoverKey(db: Db, courseId: string): Promise<string | null> {
  return (await repo.courseCoverKey(db, courseId))?.thumbnailKey ?? null;
}

/** A coach's photo key and who owns it. `live` is true when the public may see it. */
export async function coachPhotoAccess(db: Db, slug: string): Promise<{ key: string; ownerUserId: string; live: boolean } | null> {
  const p = await repo.coachPhotoKey(db, slug);
  if (!p?.photoKey) return null;
  const live = p.isPublic && (await publicAcademyRepository.coachHasListedCourse(db, p.userId));
  return { key: p.photoKey, ownerUserId: p.userId, live };
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

export type SitemapEntry = { path: string; updatedAt: Date };

export async function sitemapEntries(db: Db): Promise<SitemapEntry[]> {
  const [courses, categories, coaches] = await Promise.all([repo.sitemapCourses(db), repo.sitemapCategories(db), repo.sitemapCoaches(db)]);
  return [
    ...courses.map((c) => ({ path: `/academy/${c.slug}`, updatedAt: c.updatedAt })),
    ...categories.map((c) => ({ path: `/academy/category/${c.slug}`, updatedAt: c.updatedAt })),
    ...coaches.map((c) => ({ path: `/coaches/${c.slug}`, updatedAt: c.updatedAt })),
  ];
}

// ---------------------------------------------------------------------------
// The visitor
// ---------------------------------------------------------------------------

export type CourseViewer = {
  state: ViewerState;
  /** An owner's own review, so the form can show it. */
  myReview: { rating: number; body: string } | null;
  canShare: boolean;
};

/** What the cached course page cannot know: how this visitor stands with the course. Answered with no-store. */
export async function getCourseViewer(db: PrismaClient, actor: Actor | null, courseId: string): Promise<CourseViewer> {
  const course = await publicAcademyRepository.findCourseSlugById(db, courseId);
  if (!course || course.status !== "PUBLISHED") throw new NotFoundError();
  const { state, enrollmentId } = await viewerStateFor(db, actor, courseId);
  let myReview: CourseViewer["myReview"] = null;
  if (state === "OWNER" && enrollmentId) {
    const r = await publicAcademyRepository.findReviewByEnrollment(db, enrollmentId);
    if (r) myReview = { rating: r.rating, body: r.body ?? "" };
  }
  return { state, myReview, canShare: !!actor && canRefer(actor) };
}

const SHARE_PATH = /^\/(?:academy|coaches)(?:\/[a-z0-9][a-z0-9-]{0,80}){0,2}$/;

/** A public address on this site (never one with a query) that a member may attach their referral code to. */
export function isShareablePath(path: unknown): path is string {
  return typeof path === "string" && SHARE_PATH.test(path);
}

/** The member's own link to a public page: the address with `?ref=` and their personal code. */
export async function shareLinkFor(db: Db, actor: Actor, path: string): Promise<string> {
  if (!canRefer(actor)) throw new ForbiddenError("Only talent, coaches and agency owners have a referral link.");
  if (!isShareablePath(path)) throw new NotFoundError();
  const code = await ensureReferralCode(db, actor.userId);
  return `${siteUrl()}${path}?ref=${encodeURIComponent(code)}`;
}
