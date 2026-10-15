-- CreateEnum
CREATE TYPE "CredentialSource" AS ENUM ('AGENCY_SPONSORED', 'INDEPENDENT_PURCHASE', 'HIREWISE_DIRECT', 'ADMIN_ASSIGNMENT');

-- CreateEnum
CREATE TYPE "CoursePurchaseStatus" AS ENUM ('PENDING', 'PAID', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IndependentAccessStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'CANCELLED');

-- AlterEnum
ALTER TYPE "AssessmentStatus" ADD VALUE 'HISTORICAL';

-- AlterEnum
ALTER TYPE "CertificationStatus" ADD VALUE 'INACTIVE_FOR_PLATFORM_USE';

-- AlterEnum
ALTER TYPE "EnrollmentStatus" ADD VALUE 'REVOKED';

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "credentialSource" "CredentialSource" NOT NULL DEFAULT 'HIREWISE_DIRECT',
ADD COLUMN     "historicalAt" TIMESTAMP(3),
ADD COLUMN     "sponsoringAgencyId" TEXT;

-- AlterTable
ALTER TABLE "Certification" ADD COLUMN     "credentialSource" "CredentialSource" NOT NULL DEFAULT 'HIREWISE_DIRECT',
ADD COLUMN     "inactivatedAt" TIMESTAMP(3),
ADD COLUMN     "inactiveReason" TEXT,
ADD COLUMN     "sponsoringAgencyId" TEXT;

-- AlterTable
ALTER TABLE "CourseEnrollment" ADD COLUMN     "accessRevokedAt" TIMESTAMP(3),
ADD COLUMN     "courseSeatAssignmentId" TEXT,
ADD COLUMN     "credentialSource" "CredentialSource" NOT NULL DEFAULT 'HIREWISE_DIRECT',
ADD COLUMN     "revokeReason" TEXT,
ADD COLUMN     "sponsoringAgencyId" TEXT;

-- CreateTable
CREATE TABLE "CoursePurchase" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "seatCount" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "CoursePurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "paymentReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "recordedById" TEXT,
    "requestedById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoursePurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseSeatAssignment" (
    "id" TEXT NOT NULL,
    "coursePurchaseId" TEXT,
    "agencyId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,

    CONSTRAINT "CourseSeatAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndependentAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platformIdentityId" TEXT,
    "status" "IndependentAccessStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "amountMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "paymentReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "recordedById" TEXT,
    "profileId" TEXT,
    "fromProfileId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndependentAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoursePurchase_agencyId_status_idx" ON "CoursePurchase"("agencyId", "status");

-- CreateIndex
CREATE INDEX "CoursePurchase_status_createdAt_idx" ON "CoursePurchase"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CourseSeatAssignment_agencyId_courseId_idx" ON "CourseSeatAssignment"("agencyId", "courseId");

-- CreateIndex
CREATE INDEX "CourseSeatAssignment_agentProfileId_idx" ON "CourseSeatAssignment"("agentProfileId");

-- CreateIndex
CREATE INDEX "CourseSeatAssignment_coursePurchaseId_idx" ON "CourseSeatAssignment"("coursePurchaseId");

-- CreateIndex
CREATE INDEX "IndependentAccess_userId_status_idx" ON "IndependentAccess"("userId", "status");

-- CreateIndex
CREATE INDEX "IndependentAccess_status_createdAt_idx" ON "IndependentAccess"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CoursePurchase" ADD CONSTRAINT "CoursePurchase_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePurchase" ADD CONSTRAINT "CoursePurchase_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademyCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSeatAssignment" ADD CONSTRAINT "CourseSeatAssignment_coursePurchaseId_fkey" FOREIGN KEY ("coursePurchaseId") REFERENCES "CoursePurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSeatAssignment" ADD CONSTRAINT "CourseSeatAssignment_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

