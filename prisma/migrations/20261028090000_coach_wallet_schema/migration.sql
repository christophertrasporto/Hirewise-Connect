-- CreateEnum
CREATE TYPE "CoachEarningStatus" AS ENUM ('PENDING_FEE', 'ON_HOLD', 'AVAILABLE', 'WITHDRAWN', 'REVERSED');

-- CreateEnum
CREATE TYPE "EarningFeeSource" AS ENUM ('OFFLINE', 'STAFF_ENTRY', 'SETTLEMENT_IMPORT', 'GATEWAY_API');

-- CreateEnum
CREATE TYPE "WalletEntryType" AS ENUM ('EARNING', 'REVERSAL', 'REFUND_AFTER_WITHDRAWAL', 'WITHDRAWAL', 'WITHDRAWAL_RELEASED', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CoachWithdrawalStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PAID', 'REJECTED');

-- AlterEnum
ALTER TYPE "PayoutMethodKind" ADD VALUE 'MAYA';

-- AlterTable
ALTER TABLE "CourseEnrollment" ADD COLUMN     "refundedCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CoachEarning" (
    "id" TEXT NOT NULL,
    "coachUserId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "courseTitle" TEXT NOT NULL,
    "buyerUserId" TEXT NOT NULL,
    "buyerLabel" TEXT NOT NULL,
    "saleAmount" INTEGER NOT NULL,
    "gatewayFee" INTEGER,
    "netAmount" INTEGER,
    "coachRateBps" INTEGER NOT NULL,
    "coachAmount" INTEGER,
    "platformAmount" INTEGER,
    "affiliateAmount" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "channel" TEXT NOT NULL,
    "feeSource" "EarningFeeSource",
    "status" "CoachEarningStatus" NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "refundedSaleMinor" INTEGER NOT NULL DEFAULT 0,
    "coachReversedMinor" INTEGER NOT NULL DEFAULT 0,
    "feeAbsorbedMinor" INTEGER NOT NULL DEFAULT 0,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletLedgerEntry" (
    "id" TEXT NOT NULL,
    "coachUserId" TEXT NOT NULL,
    "type" "WalletEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "earningId" TEXT,
    "withdrawalId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachWithdrawal" (
    "id" TEXT NOT NULL,
    "coachUserId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" "PayoutMethodKind" NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumberEnc" TEXT NOT NULL,
    "bankName" TEXT,
    "accountLabel" TEXT NOT NULL,
    "status" "CoachWithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "reference" TEXT,
    "rejectionReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "CoachWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachShareOverride" (
    "coachUserId" TEXT NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachShareOverride_pkey" PRIMARY KEY ("coachUserId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoachEarning_enrollmentId_key" ON "CoachEarning"("enrollmentId");

-- CreateIndex
CREATE INDEX "CoachEarning_coachUserId_status_idx" ON "CoachEarning"("coachUserId", "status");

-- CreateIndex
CREATE INDEX "CoachEarning_status_availableAt_idx" ON "CoachEarning"("status", "availableAt");

-- CreateIndex
CREATE INDEX "CoachEarning_courseId_idx" ON "CoachEarning"("courseId");

-- CreateIndex
CREATE INDEX "CoachEarning_paidAt_idx" ON "CoachEarning"("paidAt");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_coachUserId_createdAt_idx" ON "WalletLedgerEntry"("coachUserId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_earningId_idx" ON "WalletLedgerEntry"("earningId");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_withdrawalId_idx" ON "WalletLedgerEntry"("withdrawalId");

-- CreateIndex
CREATE INDEX "CoachWithdrawal_coachUserId_status_idx" ON "CoachWithdrawal"("coachUserId", "status");

-- CreateIndex
CREATE INDEX "CoachWithdrawal_status_requestedAt_idx" ON "CoachWithdrawal"("status", "requestedAt");

-- AddForeignKey
ALTER TABLE "CoachEarning" ADD CONSTRAINT "CoachEarning_coachUserId_fkey" FOREIGN KEY ("coachUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachEarning" ADD CONSTRAINT "CoachEarning_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "CourseEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_coachUserId_fkey" FOREIGN KEY ("coachUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_earningId_fkey" FOREIGN KEY ("earningId") REFERENCES "CoachEarning"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachWithdrawal" ADD CONSTRAINT "CoachWithdrawal_coachUserId_fkey" FOREIGN KEY ("coachUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachShareOverride" ADD CONSTRAINT "CoachShareOverride_coachUserId_fkey" FOREIGN KEY ("coachUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

