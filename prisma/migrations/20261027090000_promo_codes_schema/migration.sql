-- CreateEnum
CREATE TYPE "PromoDiscountType" AS ENUM ('PERCENT', 'AMOUNT');

-- CreateEnum
CREATE TYPE "PromoAppliesTo" AS ENUM ('ALL_COURSES', 'SELECTED_COURSES');

-- CreateEnum
CREATE TYPE "PromoStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PromoRedemptionStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');

-- AlterTable
ALTER TABLE "CourseEnrollment" ADD COLUMN     "listPriceCents" INTEGER;

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "discountType" "PromoDiscountType" NOT NULL,
    "percentBps" INTEGER,
    "amountMinor" INTEGER,
    "currency" CHAR(3),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "perLearnerLimit" INTEGER NOT NULL DEFAULT 1,
    "minPriceMinor" INTEGER NOT NULL DEFAULT 0,
    "appliesTo" "PromoAppliesTo" NOT NULL DEFAULT 'ALL_COURSES',
    "status" "PromoStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCodeCourse" (
    "promoCodeId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,

    CONSTRAINT "PromoCodeCourse_pkey" PRIMARY KEY ("promoCodeId","courseId")
);

-- CreateTable
CREATE TABLE "PromoRedemption" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listPriceMinor" INTEGER NOT NULL,
    "discountMinor" INTEGER NOT NULL,
    "finalMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PromoRedemptionStatus" NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,

    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");

-- CreateIndex
CREATE INDEX "PromoCode_status_idx" ON "PromoCode"("status");

-- CreateIndex
CREATE INDEX "PromoCodeCourse_courseId_idx" ON "PromoCodeCourse"("courseId");

-- CreateIndex
CREATE INDEX "PromoRedemption_promoCodeId_status_idx" ON "PromoRedemption"("promoCodeId", "status");

-- CreateIndex
CREATE INDEX "PromoRedemption_userId_promoCodeId_status_idx" ON "PromoRedemption"("userId", "promoCodeId", "status");

-- CreateIndex
CREATE INDEX "PromoRedemption_enrollmentId_idx" ON "PromoRedemption"("enrollmentId");

-- CreateIndex
CREATE INDEX "PromoRedemption_status_createdAt_idx" ON "PromoRedemption"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "PromoCodeCourse" ADD CONSTRAINT "PromoCodeCourse_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCodeCourse" ADD CONSTRAINT "PromoCodeCourse_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "CourseEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

