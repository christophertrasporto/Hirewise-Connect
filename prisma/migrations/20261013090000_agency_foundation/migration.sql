-- CreateEnum
CREATE TYPE "AgencyApplicationStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AgencyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AgencyUserRole" AS ENUM ('OWNER', 'MANAGER');

-- CreateEnum
CREATE TYPE "AgencyMembershipStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "AcceptanceContext" AS ENUM ('GENERAL', 'PLACEMENT', 'AGENCY_APPLICATION', 'AGENT_REGISTRATION', 'SUBMISSION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AgreementType" ADD VALUE 'AGENCY_NON_CIRCUMVENTION';
ALTER TYPE "AgreementType" ADD VALUE 'SUBMISSION_TERMS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentOwnerType" ADD VALUE 'AGENCY_APPLICATION';
ALTER TYPE "DocumentOwnerType" ADD VALUE 'AGENCY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RoleKey" ADD VALUE 'APPLICANT';
ALTER TYPE "RoleKey" ADD VALUE 'AGENCY_OWNER';
ALTER TYPE "RoleKey" ADD VALUE 'AGENCY_MANAGER';

-- AlterTable
ALTER TABLE "AgentProfile" ADD COLUMN     "primaryAgencyId" TEXT;

-- AlterTable
ALTER TABLE "AgreementAcceptance" ADD COLUMN     "applicationId" TEXT,
ADD COLUMN     "context" "AcceptanceContext" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "submissionId" TEXT;

-- CreateTable
CREATE TABLE "AgencyApplication" (
    "id" TEXT NOT NULL,
    "applicantUserId" TEXT NOT NULL,
    "applicantFullName" TEXT NOT NULL,
    "applicantEmail" TEXT NOT NULL,
    "applicantPhone" TEXT,
    "proposedAgencyName" TEXT NOT NULL,
    "proposedLogoKey" TEXT,
    "businessRegistration" TEXT,
    "country" TEXT NOT NULL,
    "city" TEXT,
    "website" TEXT,
    "socialLinks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "teamSize" INTEGER NOT NULL,
    "yearsExperience" INTEGER NOT NULL,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT NOT NULL,
    "agreementAcceptanceId" TEXT,
    "status" "AgencyApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reviewerId" TEXT,
    "reviewNotes" TEXT,
    "applicantVisibleMessage" TEXT,
    "rejectionReason" TEXT,
    "reapplyAfter" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resubmittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdAgencyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyApplicationHistory" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "previousStatus" "AgencyApplicationStatus",
    "newStatus" "AgencyApplicationStatus" NOT NULL,
    "changedById" TEXT,
    "notes" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgencyApplicationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoKey" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "description" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "country" TEXT NOT NULL,
    "city" TEXT,
    "website" TEXT,
    "status" "AgencyStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "planId" TEXT,
    "trainingAccess" BOOLEAN NOT NULL DEFAULT true,
    "opportunityAccess" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspendedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyUser" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "AgencyUserRole" NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyMembership" (
    "id" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "agencyId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "status" "AgencyMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgencyMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgencyApplication_createdAgencyId_key" ON "AgencyApplication"("createdAgencyId");

-- CreateIndex
CREATE INDEX "AgencyApplication_applicantUserId_status_idx" ON "AgencyApplication"("applicantUserId", "status");

-- CreateIndex
CREATE INDEX "AgencyApplication_status_submittedAt_idx" ON "AgencyApplication"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "AgencyApplication_country_idx" ON "AgencyApplication"("country");

-- CreateIndex
CREATE INDEX "AgencyApplicationHistory_applicationId_changedAt_idx" ON "AgencyApplicationHistory"("applicationId", "changedAt");

-- CreateIndex
CREATE INDEX "Agency_status_idx" ON "Agency"("status");

-- CreateIndex
CREATE INDEX "Agency_ownerUserId_idx" ON "Agency"("ownerUserId");

-- CreateIndex
CREATE INDEX "AgencyUser_userId_idx" ON "AgencyUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyUser_agencyId_userId_key" ON "AgencyUser"("agencyId", "userId");

-- CreateIndex
CREATE INDEX "AgencyMembership_agentProfileId_status_idx" ON "AgencyMembership"("agentProfileId", "status");

-- CreateIndex
CREATE INDEX "AgencyMembership_agencyId_status_idx" ON "AgencyMembership"("agencyId", "status");

-- CreateIndex
CREATE INDEX "AgentProfile_primaryAgencyId_idx" ON "AgentProfile"("primaryAgencyId");

-- CreateIndex
CREATE INDEX "AgreementAcceptance_applicationId_idx" ON "AgreementAcceptance"("applicationId");

-- AddForeignKey
ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_primaryAgencyId_fkey" FOREIGN KEY ("primaryAgencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyApplication" ADD CONSTRAINT "AgencyApplication_applicantUserId_fkey" FOREIGN KEY ("applicantUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyApplication" ADD CONSTRAINT "AgencyApplication_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyApplication" ADD CONSTRAINT "AgencyApplication_createdAgencyId_fkey" FOREIGN KEY ("createdAgencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyApplicationHistory" ADD CONSTRAINT "AgencyApplicationHistory_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AgencyApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyApplicationHistory" ADD CONSTRAINT "AgencyApplicationHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agency" ADD CONSTRAINT "Agency_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyUser" ADD CONSTRAINT "AgencyUser_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyUser" ADD CONSTRAINT "AgencyUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyMembership" ADD CONSTRAINT "AgencyMembership_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyMembership" ADD CONSTRAINT "AgencyMembership_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyMembership" ADD CONSTRAINT "AgencyMembership_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

