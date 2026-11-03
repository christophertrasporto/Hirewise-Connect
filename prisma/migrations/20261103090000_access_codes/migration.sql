
-- CreateEnum
CREATE TYPE "AccessCodeStatus" AS ENUM ('UNUSED', 'REDEEMED', 'VOIDED');

-- CreateTable
CREATE TABLE "AccessCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "buyerEmail" TEXT,
    "paymentReference" TEXT NOT NULL,
    "note" TEXT,
    "status" "AccessCodeStatus" NOT NULL DEFAULT 'UNUSED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedById" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "enrollmentId" TEXT,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,

    CONSTRAINT "AccessCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccessCode_code_key" ON "AccessCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AccessCode_enrollmentId_key" ON "AccessCode"("enrollmentId");

-- CreateIndex
CREATE INDEX "AccessCode_courseId_status_idx" ON "AccessCode"("courseId", "status");

-- CreateIndex
CREATE INDEX "AccessCode_status_expiresAt_idx" ON "AccessCode"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "AccessCode" ADD CONSTRAINT "AccessCode_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCode" ADD CONSTRAINT "AccessCode_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "CourseEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

