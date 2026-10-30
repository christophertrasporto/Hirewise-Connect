-- CreateEnum
CREATE TYPE "CourseListing" AS ENUM ('LISTED', 'UNLISTED');

-- CreateEnum
CREATE TYPE "SlugKind" AS ENUM ('COURSE', 'COACH');

-- AlterTable
ALTER TABLE "AcademyCourse" ADD COLUMN     "audience" TEXT,
ADD COLUMN     "faq" JSONB,
ADD COLUMN     "featuredRank" INTEGER,
ADD COLUMN     "hideEnrolledCount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "learningPoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "listing" "CourseListing" NOT NULL DEFAULT 'LISTED',
ADD COLUMN     "pitch" TEXT,
ADD COLUMN     "requirements" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "slug" TEXT;

-- CreateTable
CREATE TABLE "CoachProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "headline" TEXT,
    "bio" TEXT,
    "photoKey" TEXT,
    "links" JSONB,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseReview" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT,
    "hiddenAt" TIMESTAMP(3),
    "hiddenReason" TEXT,
    "hiddenById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlugRedirect" (
    "id" TEXT NOT NULL,
    "kind" "SlugKind" NOT NULL,
    "oldSlug" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlugRedirect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoachProfile_userId_key" ON "CoachProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CoachProfile_slug_key" ON "CoachProfile"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CourseReview_enrollmentId_key" ON "CourseReview"("enrollmentId");

-- CreateIndex
CREATE INDEX "CourseReview_courseId_hiddenAt_idx" ON "CourseReview"("courseId", "hiddenAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourseReview_courseId_userId_key" ON "CourseReview"("courseId", "userId");

-- CreateIndex
CREATE INDEX "SlugRedirect_kind_targetId_idx" ON "SlugRedirect"("kind", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "SlugRedirect_kind_oldSlug_key" ON "SlugRedirect"("kind", "oldSlug");

-- AddForeignKey
ALTER TABLE "CoachProfile" ADD CONSTRAINT "CoachProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseReview" ADD CONSTRAINT "CourseReview_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseReview" ADD CONSTRAINT "CourseReview_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "CourseEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseReview" ADD CONSTRAINT "CourseReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing courses get a slug from their title (lower case, hyphens, unique; reserved words and repeats get a suffix).
UPDATE "AcademyCourse" c SET "slug" = s."slug"
FROM (
  SELECT u."id", CASE WHEN u."rn" = 1 THEN u."base" ELSE u."base" || '-' || u."rn" END AS "slug"
  FROM (
    SELECT t."id", t."base", ROW_NUMBER() OVER (PARTITION BY t."base" ORDER BY t."createdAt", t."id") AS "rn"
    FROM (
      SELECT "id", "createdAt",
        CASE WHEN b."raw" IN ('category', 'courses', 'new', 'search') THEN b."raw" || '-course' ELSE b."raw" END AS "base"
      FROM (
        SELECT "id", "createdAt", COALESCE(NULLIF(trim(both '-' from regexp_replace(left(lower("title"), 80), '[^a-z0-9]+', '-', 'g')), ''), 'course') AS "raw"
        FROM "AcademyCourse"
      ) b
    ) t
  ) u
) s
WHERE c."id" = s."id";

ALTER TABLE "AcademyCourse" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "AcademyCourse_slug_key" ON "AcademyCourse"("slug");

-- A review is a whole-star rating.
ALTER TABLE "CourseReview" ADD CONSTRAINT "CourseReview_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
