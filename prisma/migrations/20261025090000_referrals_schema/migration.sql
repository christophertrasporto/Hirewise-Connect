-- CreateEnum
CREATE TYPE "RefundKind" AS ENUM ('REFUND', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "CommissionSourceType" AS ENUM ('ENROLLMENT', 'COURSE_PURCHASE');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('ON_HOLD', 'PAYABLE', 'PAID', 'REVERSED');

-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('REFUND_AFTER_PAYOUT', 'MANUAL');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "PayoutMethodKind" AS ENUM ('GCASH', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "ReferralFlagKind" AS ENUM ('EMAIL_ALIAS', 'SAME_IP', 'SAME_PHONE');

-- AlterEnum
ALTER TYPE "CoursePaymentStatus" ADD VALUE 'REFUNDED';

-- AlterEnum
ALTER TYPE "CoursePurchaseStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "CourseEnrollment" ADD COLUMN     "refundKind" "RefundKind",
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CoursePurchase" ADD COLUMN     "refundKind" "RefundKind",
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredAt" TIMESTAMP(3),
ADD COLUMN     "referredByUserId" TEXT;

-- CreateTable
CREATE TABLE "ReferralClick" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "landingUrl" TEXT NOT NULL,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sourceType" "CommissionSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "courseTitle" TEXT NOT NULL,
    "saleAmount" INTEGER NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "commissionAmount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'ON_HOLD',
    "availableAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "payoutId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionAdjustment" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "commissionId" TEXT,
    "kind" "AdjustmentKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "note" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "settledPayoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" "PayoutMethodKind" NOT NULL,
    "accountLabel" TEXT NOT NULL,
    "reference" TEXT,
    "status" "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "rejectReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutDetails" (
    "userId" TEXT NOT NULL,
    "method" "PayoutMethodKind" NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumberEnc" TEXT NOT NULL,
    "bankName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutDetails_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ReferralFlag" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "kind" "ReferralFlagKind" NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,

    CONSTRAINT "ReferralFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReferralClick_referrerId_createdAt_idx" ON "ReferralClick"("referrerId", "createdAt");

-- CreateIndex
CREATE INDEX "Commission_referrerId_status_idx" ON "Commission"("referrerId", "status");

-- CreateIndex
CREATE INDEX "Commission_status_availableAt_idx" ON "Commission"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_sourceType_sourceId_key" ON "Commission"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "CommissionAdjustment_referrerId_settledPayoutId_idx" ON "CommissionAdjustment"("referrerId", "settledPayoutId");

-- CreateIndex
CREATE INDEX "Payout_referrerId_status_idx" ON "Payout"("referrerId", "status");

-- CreateIndex
CREATE INDEX "Payout_status_requestedAt_idx" ON "Payout"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "ReferralFlag_referrerId_idx" ON "ReferralFlag"("referrerId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralFlag_referredUserId_kind_key" ON "ReferralFlag"("referredUserId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "User_referredByUserId_idx" ON "User"("referredByUserId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredByUserId_fkey" FOREIGN KEY ("referredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralClick" ADD CONSTRAINT "ReferralClick_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAdjustment" ADD CONSTRAINT "CommissionAdjustment_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAdjustment" ADD CONSTRAINT "CommissionAdjustment_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutDetails" ADD CONSTRAINT "PayoutDetails_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralFlag" ADD CONSTRAINT "ReferralFlag_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralFlag" ADD CONSTRAINT "ReferralFlag_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

