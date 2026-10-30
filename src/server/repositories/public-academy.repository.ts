import type { CourseListing, Prisma, SlugKind } from "@prisma/client";
import type { Db } from "@/server/db/types";

export type CoachLink = { label: string; url: string };

const courseSlugSelect = { id: true, slug: true, status: true, listing: true } satisfies Prisma.AcademyCourseSelect;

export const publicAcademyRepository = {
  // Slugs and redirects
  courseSlugTaken(db: Db, slug: string, exceptCourseId?: string) {
    return db.academyCourse.findFirst({ where: { slug, ...(exceptCourseId ? { id: { not: exceptCourseId } } : {}) }, select: { id: true } }).then(Boolean);
  },
  coachSlugTaken(db: Db, slug: string, exceptProfileId?: string) {
    return db.coachProfile.findFirst({ where: { slug, ...(exceptProfileId ? { id: { not: exceptProfileId } } : {}) }, select: { id: true } }).then(Boolean);
  },
  redirectFor(db: Db, kind: SlugKind, oldSlug: string) {
    return db.slugRedirect.findUnique({ where: { kind_oldSlug: { kind, oldSlug } } });
  },
  /** Records `oldSlug` as pointing at `targetId`; an existing record for the same old slug is moved to the new target. */
  saveRedirect(db: Db, kind: SlugKind, oldSlug: string, targetId: string) {
    return db.slugRedirect.upsert({ where: { kind_oldSlug: { kind, oldSlug } }, create: { kind, oldSlug, targetId }, update: { targetId } });
  },
  /** A slug being taken again by its owner must stop redirecting somewhere else. */
  dropRedirect(db: Db, kind: SlugKind, oldSlug: string) {
    return db.slugRedirect.deleteMany({ where: { kind, oldSlug } });
  },
  findCourseBySlug(db: Db, slug: string) {
    return db.academyCourse.findUnique({ where: { slug }, select: courseSlugSelect });
  },
  findCourseSlugById(db: Db, id: string) {
    return db.academyCourse.findUnique({ where: { id }, select: courseSlugSelect });
  },
  findCoachBySlug(db: Db, slug: string) {
    return db.coachProfile.findUnique({ where: { slug }, select: { id: true, slug: true, isPublic: true, userId: true } });
  },
  findCoachSlugById(db: Db, id: string) {
    return db.coachProfile.findUnique({ where: { id }, select: { id: true, slug: true, isPublic: true, userId: true } });
  },

  // Course public details
  updateCourseDetails(db: Db, id: string, d: Prisma.AcademyCourseUncheckedUpdateInput) {
    return db.academyCourse.update({ where: { id }, data: d });
  },
  setListing(db: Db, id: string, listing: CourseListing) {
    return db.academyCourse.update({ where: { id }, data: { listing } });
  },
  setFeaturedRank(db: Db, id: string, featuredRank: number | null) {
    return db.academyCourse.update({ where: { id }, data: { featuredRank } });
  },
  setReviewNote(db: Db, id: string, reviewNote: string | null) {
    return db.academyCourse.update({ where: { id }, data: { reviewNote } });
  },

  // Coach profiles
  findCoachProfileByUser(db: Db, userId: string) {
    return db.coachProfile.findUnique({ where: { userId } });
  },
  createCoachProfile(db: Db, d: { userId: string; slug: string; displayName: string; headline: string | null; bio: string | null; links: CoachLink[]; isPublic: boolean }) {
    return db.coachProfile.create({ data: { ...d, links: d.links as unknown as Prisma.InputJsonValue } });
  },
  updateCoachProfile(db: Db, id: string, d: { slug?: string; displayName?: string; headline?: string | null; bio?: string | null; links?: CoachLink[]; isPublic?: boolean }) {
    return db.coachProfile.update({ where: { id }, data: { ...d, links: d.links as unknown as Prisma.InputJsonValue | undefined } });
  },
  coachProfilesByUser(db: Db, userIds: string[]) {
    return db.coachProfile.findMany({ where: { userId: { in: userIds } }, select: { userId: true, displayName: true, slug: true, isPublic: true } });
  },
  coachEmails(db: Db, userIds: string[]) {
    return db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } });
  },
  /** Does the coach own or co-teach a course that is published and listed? */
  async coachHasListedCourse(db: Db, userId: string) {
    const n = await db.academyCourse.count({ where: { status: "PUBLISHED", listing: "LISTED", OR: [{ ownerCoachUserId: userId }, { coaches: { some: { coachUserId: userId } } }] } });
    return n > 0;
  },

  // Reviews
  findEnrollmentForReview(db: Db, courseId: string, agentProfileId: string) {
    return db.courseEnrollment.findUnique({
      where: { courseId_agentProfileId: { courseId, agentProfileId } },
      select: { id: true, status: true, paymentStatus: true, accessRevokedAt: true, agentProfile: { select: { userId: true } } },
    });
  },
  findReviewByEnrollment(db: Db, enrollmentId: string) {
    return db.courseReview.findUnique({ where: { enrollmentId } });
  },
  findReview(db: Db, id: string) {
    return db.courseReview.findUnique({ where: { id }, include: { course: { select: { id: true, ownerCoachUserId: true } } } });
  },
  createReview(db: Db, d: { courseId: string; enrollmentId: string; userId: string; rating: number; body: string | null }) {
    return db.courseReview.create({ data: d });
  },
  updateReview(db: Db, id: string, d: { rating: number; body: string | null }) {
    return db.courseReview.update({ where: { id }, data: d });
  },
  setReviewHidden(db: Db, id: string, d: { hiddenAt: Date | null; hiddenReason: string | null; hiddenById: string | null }) {
    return db.courseReview.update({ where: { id }, data: d });
  },
  async ratingSummary(db: Db, courseId: string) {
    const a = await db.courseReview.aggregate({ where: { courseId, hiddenAt: null }, _avg: { rating: true }, _count: { _all: true } });
    return { count: a._count._all, average: a._avg.rating };
  },
  visibleReviews(db: Db, courseId: string, take = 50) {
    return db.courseReview.findMany({
      where: { courseId, hiddenAt: null },
      orderBy: { createdAt: "desc" },
      take,
      include: { enrollment: { select: { agentProfile: { select: { displayName: true } } } } },
    });
  },
  allReviewsForStaff(db: Db, courseId: string, take = 200) {
    return db.courseReview.findMany({
      where: { courseId },
      orderBy: { createdAt: "desc" },
      take,
      include: { enrollment: { select: { agentProfile: { select: { displayName: true } } } } },
    });
  },
};
