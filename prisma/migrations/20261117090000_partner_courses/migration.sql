-- Partner courses: a course taught on another site, reached through an affiliate link. Additive only.
ALTER TABLE "AcademyCourse" ADD COLUMN "externalUrl" TEXT;
ALTER TABLE "AcademyCourse" ADD COLUMN "externalProvider" TEXT;
ALTER TABLE "AcademyCourse" ADD COLUMN "externalPriceLabel" TEXT;

CREATE TABLE "ExternalCourseClick" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalCourseClick_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExternalCourseClick_courseId_createdAt_idx" ON "ExternalCourseClick"("courseId", "createdAt");

ALTER TABLE "ExternalCourseClick" ADD CONSTRAINT "ExternalCourseClick_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
