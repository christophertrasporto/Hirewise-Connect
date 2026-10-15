-- CreateEnum
CREATE TYPE "ExitRequestType" AS ENUM ('AGENT_REQUESTED_LEAVE', 'AGENCY_REQUESTED_REMOVAL');

-- CreateEnum
CREATE TYPE "ExitEffectiveOption" AS ENUM ('IMMEDIATE', 'END_OF_ASSIGNMENT', 'END_OF_BILLING_PERIOD');

-- CreateEnum
CREATE TYPE "ExitRequestStatus" AS ENUM ('PENDING_AGENCY', 'PENDING_ADMIN', 'APPROVED', 'DECLINED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ExitDecision" AS ENUM ('APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "SeatReleaseRule" AS ENUM ('IMMEDIATE', 'AFTER_BILLING_PERIOD', 'AFTER_ASSIGNMENT_ENDS');

-- AlterTable
ALTER TABLE "AgencyMembership" ADD COLUMN     "effectiveEndAt" TIMESTAMP(3),
ADD COLUMN     "exitRequestId" TEXT,
ADD COLUMN     "seatReleaseRule" "SeatReleaseRule",
ADD COLUMN     "seatReleasedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AgentProfile" ADD COLUMN     "formerAgencyId" TEXT,
ADD COLUMN     "formerAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ExitRequest" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "platformIdentityId" TEXT,
    "type" "ExitRequestType" NOT NULL,
    "reason" TEXT NOT NULL,
    "effectiveOption" "ExitEffectiveOption" NOT NULL DEFAULT 'IMMEDIATE',
    "requestedEffectiveDate" TIMESTAMP(3),
    "status" "ExitRequestStatus" NOT NULL DEFAULT 'PENDING_AGENCY',
    "requestedById" TEXT NOT NULL,
    "agencyDecision" "ExitDecision",
    "agencyDecidedById" TEXT,
    "agencyDecisionNote" TEXT,
    "agencyDecidedAt" TIMESTAMP(3),
    "adminRequired" BOOLEAN NOT NULL DEFAULT false,
    "adminRequiredReason" TEXT,
    "adminDecision" "ExitDecision",
    "adminDecidedById" TEXT,
    "adminDecisionNote" TEXT,
    "adminDecidedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "effectiveAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExitRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExitRequest_agencyId_status_idx" ON "ExitRequest"("agencyId", "status");

-- CreateIndex
CREATE INDEX "ExitRequest_agentProfileId_status_idx" ON "ExitRequest"("agentProfileId", "status");

-- CreateIndex
CREATE INDEX "ExitRequest_status_createdAt_idx" ON "ExitRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ExitRequest" ADD CONSTRAINT "ExitRequest_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "AgencyMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

