-- CreateEnum
CREATE TYPE "TalentType" AS ENUM ('HIREWISE_DIRECT', 'AGENCY_AGENT', 'INDEPENDENT_FREELANCER');

-- CreateEnum
CREATE TYPE "IdentityStatus" AS ENUM ('ACTIVE', 'MERGED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "IdentityContactKind" AS ENUM ('EMAIL', 'PHONE');

-- CreateEnum
CREATE TYPE "IdentityContactSource" AS ENUM ('SIGNUP', 'PRIVATE_CONTACT', 'ADMIN', 'BACKFILL');

-- CreateEnum
CREATE TYPE "DuplicateFlagKind" AS ENUM ('SIGNUP', 'AGENCY_APPLICATION', 'INVITE_JOIN', 'INDEPENDENT_REAPPLY');

-- CreateEnum
CREATE TYPE "DuplicateFlagStatus" AS ENUM ('OPEN', 'APPROVED_NEW_PROFILE', 'LINKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PrivacyPolicyMode" AS ENUM ('COMBINED', 'SEPARATE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AcceptanceContext" ADD VALUE 'SIGNUP';
ALTER TYPE "AcceptanceContext" ADD VALUE 'INDEPENDENT_REAPPLICATION';
ALTER TYPE "AcceptanceContext" ADD VALUE 'REACCEPTANCE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AgentProfileStatus" ADD VALUE 'FORMER_AGENCY_AGENT';
ALTER TYPE "AgentProfileStatus" ADD VALUE 'ARCHIVED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AgreementType" ADD VALUE 'PLATFORM_TERMS';
ALTER TYPE "AgreementType" ADD VALUE 'PRIVACY_POLICY';

-- AlterEnum
ALTER TYPE "AuthTokenKind" ADD VALUE 'SIGNUP_CONTINUATION';

-- DropIndex
DROP INDEX "AgentProfile_userId_key";

-- AlterTable
ALTER TABLE "AgentProfile" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "platformIdentityId" TEXT,
ADD COLUMN     "talentType" "TalentType" NOT NULL DEFAULT 'HIREWISE_DIRECT';

-- AlterTable
ALTER TABLE "Agreement" ADD COLUMN     "changeNote" TEXT,
ADD COLUMN     "isMaterialChange" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "privacyPolicyMode" "PrivacyPolicyMode",
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedById" TEXT,
ADD COLUMN     "requiredForRoles" "RoleKey"[] DEFAULT ARRAY[]::"RoleKey"[],
ADD COLUMN     "requiresReacceptance" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sections" JSONB,
ADD COLUMN     "supersedesId" TEXT;

-- AlterTable
ALTER TABLE "AgreementAcceptance" ADD COLUMN     "agencyId" TEXT,
ADD COLUMN     "role" "RoleKey";

-- CreateTable
CREATE TABLE "PlatformIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "IdentityStatus" NOT NULL DEFAULT 'ACTIVE',
    "primaryEmail" CITEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "idVerificationRefs" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformIdentityContact" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "kind" "IdentityContactKind" NOT NULL,
    "valueNormalized" TEXT NOT NULL,
    "valueDisplay" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "source" "IdentityContactSource" NOT NULL DEFAULT 'SIGNUP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformIdentityContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateFlag" (
    "id" TEXT NOT NULL,
    "kind" "DuplicateFlagKind" NOT NULL,
    "attemptedEmail" CITEXT NOT NULL,
    "attemptedPhone" TEXT,
    "attemptedName" TEXT NOT NULL,
    "attemptedData" JSONB,
    "matchedIdentityId" TEXT,
    "matchedUserId" TEXT,
    "matchReasons" TEXT[],
    "status" "DuplicateFlagStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "continuationTokenId" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformIdentity_userId_key" ON "PlatformIdentity"("userId");

-- CreateIndex
CREATE INDEX "PlatformIdentity_primaryEmail_idx" ON "PlatformIdentity"("primaryEmail");

-- CreateIndex
CREATE INDEX "PlatformIdentity_status_idx" ON "PlatformIdentity"("status");

-- CreateIndex
CREATE INDEX "PlatformIdentityContact_kind_valueNormalized_idx" ON "PlatformIdentityContact"("kind", "valueNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformIdentityContact_identityId_kind_valueNormalized_key" ON "PlatformIdentityContact"("identityId", "kind", "valueNormalized");

-- CreateIndex
CREATE INDEX "DuplicateFlag_status_createdAt_idx" ON "DuplicateFlag"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DuplicateFlag_attemptedEmail_idx" ON "DuplicateFlag"("attemptedEmail");

-- CreateIndex
CREATE INDEX "DuplicateFlag_matchedIdentityId_idx" ON "DuplicateFlag"("matchedIdentityId");

-- CreateIndex
CREATE INDEX "AgentProfile_userId_idx" ON "AgentProfile"("userId");

-- CreateIndex
CREATE INDEX "AgentProfile_platformIdentityId_idx" ON "AgentProfile"("platformIdentityId");

-- CreateIndex
CREATE INDEX "AgreementAcceptance_agreementId_acceptedAt_idx" ON "AgreementAcceptance"("agreementId", "acceptedAt");

-- AddForeignKey
ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_platformIdentityId_fkey" FOREIGN KEY ("platformIdentityId") REFERENCES "PlatformIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformIdentity" ADD CONSTRAINT "PlatformIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformIdentityContact" ADD CONSTRAINT "PlatformIdentityContact_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "PlatformIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateFlag" ADD CONSTRAINT "DuplicateFlag_matchedIdentityId_fkey" FOREIGN KEY ("matchedIdentityId") REFERENCES "PlatformIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateFlag" ADD CONSTRAINT "DuplicateFlag_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

