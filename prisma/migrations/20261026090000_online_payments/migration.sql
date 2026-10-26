-- CreateEnum
CREATE TYPE "OnlinePaymentStatus" AS ENUM ('CREATED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'MISMATCH');

-- AlterTable
ALTER TABLE "CourseEnrollment" ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'USD';

-- CreateTable
CREATE TABLE "OnlinePayment" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "checkoutId" TEXT,
    "providerPaymentId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "OnlinePaymentStatus" NOT NULL DEFAULT 'CREATED',
    "redirectUrl" TEXT,
    "failureReason" TEXT,
    "signatureValid" BOOLEAN,
    "lastPayload" JSONB,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnlinePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnlinePayment_enrollmentId_status_idx" ON "OnlinePayment"("enrollmentId", "status");

-- CreateIndex
CREATE INDEX "OnlinePayment_status_createdAt_idx" ON "OnlinePayment"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OnlinePayment_provider_checkoutId_key" ON "OnlinePayment"("provider", "checkoutId");

-- AddForeignKey
ALTER TABLE "OnlinePayment" ADD CONSTRAINT "OnlinePayment_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "CourseEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

