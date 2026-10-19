-- CreateEnum
CREATE TYPE "ClientSafeDocumentType" AS ENUM ('RESUME', 'PROFILE', 'CERTIFICATE', 'PORTFOLIO', 'VOICE_INTRO', 'VIDEO_INTRO');

-- CreateEnum
CREATE TYPE "ClientSafeSourceType" AS ENUM ('VIDEO', 'RECORDING', 'PORTFOLIO', 'CERTIFICATION', 'PROFILE');

-- CreateEnum
CREATE TYPE "SanitizationStatus" AS ENUM ('PENDING', 'AUTO_SANITIZED', 'NEEDS_MANUAL_REVIEW', 'APPROVED_FOR_CLIENT', 'REJECTED');

-- CreateEnum
CREATE TYPE "DisclosureScope" AS ENUM ('AGENT_IDENTITY', 'AGENCY_IDENTITY', 'CLIENT_IDENTITY');

-- CreateEnum
CREATE TYPE "DisclosureGrantor" AS ENUM ('STAFF', 'SYSTEM');

-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "billingEmail" TEXT,
ADD COLUMN     "clientFacingCode" TEXT,
ADD COLUMN     "clientFacingName" TEXT,
ADD COLUMN     "clientFacingSpecializations" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "registrationDetails" TEXT;

-- AlterTable
ALTER TABLE "AgentProfile" ADD COLUMN     "clientLabel" TEXT,
ADD COLUMN     "clientLabelOverride" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ClientSafeDocument" (
    "id" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "type" "ClientSafeDocumentType" NOT NULL,
    "sourceType" "ClientSafeSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "originalStorageKey" TEXT NOT NULL,
    "sanitizedStorageKey" TEXT,
    "status" "SanitizationStatus" NOT NULL DEFAULT 'PENDING',
    "findings" JSONB,
    "autoNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientSafeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisclosureGrant" (
    "id" TEXT NOT NULL,
    "scope" "DisclosureScope" NOT NULL,
    "clientId" TEXT NOT NULL,
    "agentProfileId" TEXT,
    "agencyId" TEXT,
    "grantedBy" "DisclosureGrantor" NOT NULL,
    "grantedById" TEXT,
    "reason" TEXT NOT NULL,
    "interviewId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,

    CONSTRAINT "DisclosureGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientSafeDocument_agentProfileId_status_idx" ON "ClientSafeDocument"("agentProfileId", "status");

-- CreateIndex
CREATE INDEX "ClientSafeDocument_status_idx" ON "ClientSafeDocument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientSafeDocument_sourceType_sourceId_originalStorageKey_key" ON "ClientSafeDocument"("sourceType", "sourceId", "originalStorageKey");

-- CreateIndex
CREATE INDEX "DisclosureGrant_clientId_scope_idx" ON "DisclosureGrant"("clientId", "scope");

-- CreateIndex
CREATE INDEX "DisclosureGrant_agentProfileId_idx" ON "DisclosureGrant"("agentProfileId");

-- CreateIndex
CREATE INDEX "DisclosureGrant_agencyId_idx" ON "DisclosureGrant"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "Agency_clientFacingCode_key" ON "Agency"("clientFacingCode");

-- AddForeignKey
ALTER TABLE "ClientSafeDocument" ADD CONSTRAINT "ClientSafeDocument_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSafeDocument" ADD CONSTRAINT "ClientSafeDocument_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisclosureGrant" ADD CONSTRAINT "DisclosureGrant_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisclosureGrant" ADD CONSTRAINT "DisclosureGrant_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisclosureGrant" ADD CONSTRAINT "DisclosureGrant_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisclosureGrant" ADD CONSTRAINT "DisclosureGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

