-- CreateEnum
CREATE TYPE "InvitationSource" AS ENUM ('UNIQUE_LINK', 'EMAIL_INVITE', 'ADMIN', 'OWNER');

-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "SeatLedgerType" AS ENUM ('PLAN_BASE', 'PURCHASE', 'PROMO_GRANT', 'ADMIN_ADD', 'ADMIN_REMOVE', 'OVERRIDE', 'CONSUMED', 'RELEASED', 'PENDING_RELEASE');

-- CreateEnum
CREATE TYPE "SeatPurchaseStatus" AS ENUM ('PENDING', 'PAID', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SeatRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EmailInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AgencyMembershipStatus" ADD VALUE 'INVITED';
ALTER TYPE "AgencyMembershipStatus" ADD VALUE 'PENDING_VERIFICATION';
ALTER TYPE "AgencyMembershipStatus" ADD VALUE 'EXIT_REQUESTED';
ALTER TYPE "AgencyMembershipStatus" ADD VALUE 'REMOVAL_REQUESTED';
ALTER TYPE "AgencyMembershipStatus" ADD VALUE 'ENDING';

-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "planStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AgencyApplication" ADD COLUMN     "preferredPlanKey" TEXT;

-- AlterTable
ALTER TABLE "AgencyMembership" ADD COLUMN     "endedById" TEXT,
ADD COLUMN     "invitationSource" "InvitationSource" NOT NULL DEFAULT 'ADMIN',
ADD COLUMN     "invitedEmail" TEXT,
ADD COLUMN     "platformIdentityId" TEXT,
ADD COLUMN     "seatLedgerEntryId" TEXT;

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseAgentSeats" INTEGER,
    "priceMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "billingPeriod" "BillingPeriod" NOT NULL DEFAULT 'MONTHLY',
    "trainingAccess" BOOLEAN NOT NULL DEFAULT true,
    "opportunityAccess" BOOLEAN NOT NULL DEFAULT true,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatPackage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seatCount" INTEGER NOT NULL,
    "priceMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeatPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencySeatLedger" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "changeType" "SeatLedgerType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "relatedAgentProfileId" TEXT,
    "relatedMembershipId" TEXT,
    "seatPurchaseId" TEXT,
    "planId" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgencySeatLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatPurchase" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "seatCount" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "SeatPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "paymentReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "recordedById" TEXT,
    "ledgerEntryId" TEXT,
    "note" TEXT,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeatPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatRequest" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "requestedSeats" INTEGER NOT NULL,
    "note" TEXT,
    "status" "SeatRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "decisionNote" TEXT,
    "grantedSeats" INTEGER,
    "ledgerEntryId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeatRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyInviteLink" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyInviteLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyEmailInvite" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "EmailInviteStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedMembershipId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyEmailInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_key_key" ON "Plan"("key");

-- CreateIndex
CREATE INDEX "AgencySeatLedger_agencyId_createdAt_idx" ON "AgencySeatLedger"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "AgencySeatLedger_relatedMembershipId_idx" ON "AgencySeatLedger"("relatedMembershipId");

-- CreateIndex
CREATE INDEX "SeatPurchase_agencyId_status_idx" ON "SeatPurchase"("agencyId", "status");

-- CreateIndex
CREATE INDEX "SeatPurchase_status_createdAt_idx" ON "SeatPurchase"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SeatRequest_agencyId_status_idx" ON "SeatRequest"("agencyId", "status");

-- CreateIndex
CREATE INDEX "SeatRequest_status_createdAt_idx" ON "SeatRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyInviteLink_token_key" ON "AgencyInviteLink"("token");

-- CreateIndex
CREATE INDEX "AgencyInviteLink_agencyId_active_idx" ON "AgencyInviteLink"("agencyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyEmailInvite_token_key" ON "AgencyEmailInvite"("token");

-- CreateIndex
CREATE INDEX "AgencyEmailInvite_agencyId_status_idx" ON "AgencyEmailInvite"("agencyId", "status");

-- CreateIndex
CREATE INDEX "AgencyEmailInvite_email_status_idx" ON "AgencyEmailInvite"("email", "status");

-- CreateIndex
CREATE INDEX "AgencyMembership_platformIdentityId_status_idx" ON "AgencyMembership"("platformIdentityId", "status");

-- AddForeignKey
ALTER TABLE "Agency" ADD CONSTRAINT "Agency_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencySeatLedger" ADD CONSTRAINT "AgencySeatLedger_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencySeatLedger" ADD CONSTRAINT "AgencySeatLedger_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatPurchase" ADD CONSTRAINT "SeatPurchase_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatPurchase" ADD CONSTRAINT "SeatPurchase_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "SeatPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatRequest" ADD CONSTRAINT "SeatRequest_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyInviteLink" ADD CONSTRAINT "AgencyInviteLink_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyEmailInvite" ADD CONSTRAINT "AgencyEmailInvite_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

