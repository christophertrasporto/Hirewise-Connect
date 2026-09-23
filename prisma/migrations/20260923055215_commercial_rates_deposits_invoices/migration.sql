-- CreateEnum
CREATE TYPE "RateUnit" AS ENUM ('HOURLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "BillingRateStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "RateSubjectType" AS ENUM ('CLIENT_BILLING_RATE', 'AGENT_COMPENSATION');

-- CreateEnum
CREATE TYPE "DepositPolicyType" AS ENUM ('ONE_MONTH', 'TWO_WEEKS', 'FIXED', 'PERCENTAGE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CARD', 'PAYPAL', 'OTHER');

-- AlterTable
ALTER TABLE "Placement" ADD COLUMN     "agentCompensationId" TEXT,
ADD COLUMN     "agreementAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "clientBillingRateId" TEXT,
ADD COLUMN     "pausedAt" TIMESTAMP(3),
ADD COLUMN     "signedAgreementKey" TEXT;

-- CreateTable
CREATE TABLE "ClientBillingRate" (
    "id" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "unit" "RateUnit" NOT NULL,
    "status" "BillingRateStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "proposedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "positioningNotes" TEXT,
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientBillingRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCompensation" (
    "id" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "unit" "RateUnit" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "setById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCompensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateHistory" (
    "id" TEXT NOT NULL,
    "subjectType" "RateSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "previousAmount" INTEGER,
    "newAmount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "unit" "RateUnit" NOT NULL,
    "previousStatus" TEXT,
    "newStatus" TEXT,
    "changedById" TEXT NOT NULL,
    "reason" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositPolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DepositPolicyType" NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "placementId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "requiredAmount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "waivedById" TEXT,
    "waivedReason" TEXT,
    "waivedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "placementId" TEXT,
    "depositId" TEXT,
    "number" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "pdfKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT NOT NULL,
    "providerPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentChecklistItem" (
    "id" TEXT NOT NULL,
    "placementId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "doneById" TEXT,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "DeploymentChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientBillingRate_agentProfileId_status_idx" ON "ClientBillingRate"("agentProfileId", "status");

-- CreateIndex
CREATE INDEX "ClientBillingRate_status_idx" ON "ClientBillingRate"("status");

-- CreateIndex
CREATE INDEX "AgentCompensation_agentProfileId_effectiveTo_idx" ON "AgentCompensation"("agentProfileId", "effectiveTo");

-- CreateIndex
CREATE INDEX "RateHistory_subjectType_subjectId_idx" ON "RateHistory"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "RateHistory_agentProfileId_changedAt_idx" ON "RateHistory"("agentProfileId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DepositPolicy_name_key" ON "DepositPolicy"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_placementId_key" ON "Deposit"("placementId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_clientId_status_idx" ON "Invoice"("clientId", "status");

-- CreateIndex
CREATE INDEX "Invoice_placementId_idx" ON "Invoice"("placementId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "DeploymentChecklistItem_placementId_order_idx" ON "DeploymentChecklistItem"("placementId", "order");

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_clientBillingRateId_fkey" FOREIGN KEY ("clientBillingRateId") REFERENCES "ClientBillingRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_agentCompensationId_fkey" FOREIGN KEY ("agentCompensationId") REFERENCES "AgentCompensation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBillingRate" ADD CONSTRAINT "ClientBillingRate_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBillingRate" ADD CONSTRAINT "ClientBillingRate_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBillingRate" ADD CONSTRAINT "ClientBillingRate_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCompensation" ADD CONSTRAINT "AgentCompensation_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCompensation" ADD CONSTRAINT "AgentCompensation_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateHistory" ADD CONSTRAINT "RateHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "Placement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "DepositPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "Placement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "Deposit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentChecklistItem" ADD CONSTRAINT "DeploymentChecklistItem_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "Placement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
