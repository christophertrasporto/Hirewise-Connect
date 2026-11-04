import type { CourseDifficulty, Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";
import { PREVIEWABLE_TYPES } from "@/lib/public-catalog";

/**
 * Queries behind the public Academy pages. Everything here is for visitors who may not be signed in, so every course query
 * is scoped to PUBLISHED courses, and every list query additionally to LISTED ones (unlisted courses are reachable only by
 * their own address). The select shapes are narrow on purpose; the service turns them into allow-list views.
 */

/** Mirrors `entitledToCourse` in lesson-access.ts: a completed, non-refunded, non-revoked purchase or a free/waived enrolment. */
export const ENTITLED_ENROLLMENT = { status: { not: "REVOKED" }, accessRevokedAt: null, paymentStatus: { in: ["NOT_REQUIRED", "PAID", "WAIVED"] } } satisfies Prisma.CourseEnrollmentWhereInput;

const LISTED = { status: "PUBLISHED", listing: "LISTED" } satisfies Prisma.AcademyCourseWhereInput;

const cardSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  pitch: true,
  category: true,
  categoryRef: { select: { name: true, slug: true } },
  difficulty: true,
  estimatedMinutes: true,
  priceCents: true,
  currency: true,
  thumbnailKey: true,
  updatedAt: true,
  publishedAt: true,
  featuredRank: true,
  hideEnrolledCount: true,
  ownerCoachUserId: true,
  coaches: { select: { coachUserId: true }, orderBy: { addedAt: "asc" } },
  modules: { where: { status: "PUBLISHED" }, select: { lessons: { where: { status: "PUBLISHED" }, select: { durationSec: true, isFreePreview: true, contentType: true } } } },
} satisfies Prisma.AcademyCourseSelect;
export type CardRow = Prisma.AcademyCourseGetPayload<{ select: typeof cardSelect }>;

export type CatalogFilter = {
  q?: string;
  categorySlug?: string | null;
  level?: CourseDifficulty | null;
  price?: "any" | "free" | "paid";
  /** Whole currency units. */
  min?: number | null;
  max?: number | null;
  preview?: boolean;
};

function listedWhere(f: CatalogFilter): Prisma.AcademyCourseWhereInput {
  const and: Prisma.AcademyCourseWhereInput[] = [];
  if (f.categorySlug) and.push({ categoryRef: { slug: f.categorySlug } });
  if (f.level) and.push({ difficulty: f.level });
  if (f.price === "free") and.push({ priceCents: 0 });
  if (f.price === "paid") {
    const range: Prisma.IntFilter = { gt: 0 };
    if (f.min != null) range.gte = Math.max(1, Math.round(f.min * 100));
    if (f.max != null) range.lte = Math.round(f.max * 100);
    and.push({ priceCents: range });
  }
  if (f.preview) and.push({ modules: { some: { status: "PUBLISHED", lessons: { some: { isFreePreview: true, status: "PUBLISHED", contentType: { in: [...PREVIEWABLE_TYPES] } } } } } });
  const term = f.q?.trim();
  if (term) {
    // Coaches are searched by their public display name only, never by email.
    const coachName = { coachProfile: { is: { isPublic: true, displayName: { contains: term, mode: "insensitive" as const } } } };
    and.push({
      OR: [
        { title: { contains: term, mode: "insensitive" } },
        { description: { contains: term, mode: "insensitive" } },
        { pitch: { contains: term, mode: "insensitive" } },
        { ownerCoach: coachName },
        { coaches: { some: { coach: coachName } } },
      ],
    });
  }
  return { ...LISTED, AND: and };
}

const profileSelect = { id: true, userId: true, slug: true, displayName: true, headline: true, bio: true, links: true, photoKey: true, isPublic: true, updatedAt: true } satisfies Prisma.CoachProfileSelect;
export type CoachProfileRow = Prisma.CoachProfileGetPayload<{ select: typeof profileSelect }>;

const pageInclude = {
  categoryRef: { select: { name: true, slug: true } },
  certificationTemplate: { select: { name: true } },
  coaches: { select: { coachUserId: true }, orderBy: { addedAt: "asc" } },
  modules: {
    where: { status: "PUBLISHED" },
    orderBy: { order: "asc" },
    select: {
      id: true,
      title: true,
      description: true,
      lessons: {
        where: { status: "PUBLISHED" },
        orderBy: { order: "asc" },
        select: { id: true, title: true, contentType: true, durationSec: true, isFreePreview: true, description: true, body: true, url: true, storageKey: true, fileName: true, contentMime: true, sizeBytes: true },
      },
    },
  },
} satisfies Prisma.AcademyCourseInclude;
export type PageCourseRow = Prisma.AcademyCourseGetPayload<{ include: typeof pageInclude }>;

export const publicCatalogRepository = {
  listedCourses(db: Db, f: CatalogFilter, take = 500): Promise<CardRow[]> {
    return db.academyCourse.findMany({ where: listedWhere(f), select: cardSelect, take, orderBy: { createdAt: "desc" } });
  },
  featuredCourses(db: Db, take = 6): Promise<CardRow[]> {
    return db.academyCourse.findMany({ where: { ...LISTED, featuredRank: { not: null } }, select: cardSelect, orderBy: [{ featuredRank: "asc" }, { title: "asc" }], take });
  },
  async enrolledCounts(db: Db, courseIds: string[]): Promise<Map<string, number>> {
    if (courseIds.length === 0) return new Map();
    const rows = await db.courseEnrollment.groupBy({ by: ["courseId"], where: { courseId: { in: courseIds }, ...ENTITLED_ENROLLMENT }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.courseId, r._count._all]));
  },
  async ratingStats(db: Db, courseIds: string[]): Promise<Map<string, { count: number; average: number }>> {
    if (courseIds.length === 0) return new Map();
    const rows = await db.courseReview.groupBy({ by: ["courseId"], where: { courseId: { in: courseIds }, hiddenAt: null }, _avg: { rating: true }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.courseId, { count: r._count._all, average: r._avg.rating ?? 0 }]));
  },
  activeCategories(db: Db) {
    return db.courseCategory.findMany({
      where: { isActive: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true, slug: true, _count: { select: { courses: { where: LISTED } } } },
    });
  },
  categoryBySlug(db: Db, slug: string) {
    return db.courseCategory.findFirst({ where: { slug, isActive: true }, select: { id: true, name: true, slug: true } });
  },

  // One course page
  courseBySlug(db: Db, slug: string): Promise<PageCourseRow | null> {
    return db.academyCourse.findFirst({ where: { slug, status: "PUBLISHED" }, include: pageInclude });
  },
  relatedCourses(db: Db, p: { courseId: string; categoryId: string | null; take: number }): Promise<CardRow[]> {
    return db.academyCourse.findMany({
      where: { ...LISTED, id: { not: p.courseId }, ...(p.categoryId ? { categoryId: p.categoryId } : {}) },
      select: cardSelect,
      orderBy: [{ featuredRank: { sort: "asc", nulls: "last" } }, { publishedAt: "desc" }],
      take: p.take,
    });
  },

  // Coaches
  coachProfiles(db: Db, userIds: string[]): Promise<CoachProfileRow[]> {
    return db.coachProfile.findMany({ where: { userId: { in: userIds } }, select: profileSelect });
  },
  coachBySlug(db: Db, slug: string): Promise<CoachProfileRow | null> {
    return db.coachProfile.findUnique({ where: { slug }, select: profileSelect });
  },
  coachListedCourses(db: Db, userId: string): Promise<CardRow[]> {
    return db.academyCourse.findMany({
      where: { ...LISTED, OR: [{ ownerCoachUserId: userId }, { coaches: { some: { coachUserId: userId } } }] },
      select: cardSelect,
      orderBy: [{ featuredRank: { sort: "asc", nulls: "last" } }, { publishedAt: "desc" }],
    });
  },
  /** Distinct learners who currently own any of these courses. */
  async distinctStudents(db: Db, courseIds: string[]): Promise<number> {
    if (courseIds.length === 0) return 0;
    const rows = await db.courseEnrollment.groupBy({ by: ["agentProfileId"], where: { courseId: { in: courseIds }, ...ENTITLED_ENROLLMENT } });
    return rows.length;
  },
  async ratingForCourses(db: Db, courseIds: string[]): Promise<{ count: number; average: number | null }> {
    if (courseIds.length === 0) return { count: 0, average: null };
    const a = await db.courseReview.aggregate({ where: { courseId: { in: courseIds }, hiddenAt: null }, _avg: { rating: true }, _count: { _all: true } });
    return { count: a._count._all, average: a._avg.rating };
  },

  // Images
  courseCoverKey(db: Db, courseId: string) {
    return db.academyCourse.findFirst({ where: { id: courseId, status: "PUBLISHED" }, select: { thumbnailKey: true } });
  },
  coachPhotoKey(db: Db, slug: string) {
    return db.coachProfile.findUnique({ where: { slug }, select: { id: true, userId: true, photoKey: true, isPublic: true } });
  },

  // Sitemap
  sitemapCourses(db: Db) {
    return db.academyCourse.findMany({ where: LISTED, select: { slug: true, updatedAt: true }, orderBy: { slug: "asc" } });
  },
  sitemapCategories(db: Db) {
    return db.courseCategory.findMany({ where: { isActive: true, courses: { some: LISTED } }, select: { slug: true, updatedAt: true }, orderBy: { slug: "asc" } });
  },
  sitemapCoaches(db: Db) {
    return db.coachProfile.findMany({
      where: { isPublic: true, user: { OR: [{ coursesOwned: { some: LISTED } }, { courseCoachings: { some: { course: LISTED } } }] } },
      select: { slug: true, updatedAt: true },
      orderBy: { slug: "asc" },
    });
  },
};
