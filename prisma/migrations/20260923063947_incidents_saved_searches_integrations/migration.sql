-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('RATE_DISCUSSION', 'OFF_PLATFORM_CONTACT', 'DIRECT_HIRE_ATTEMPT', 'POLICY_VIOLATION', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED');

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "meetingExternalId" TEXT,
ADD COLUMN     "meetingProvider" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "providerCheckoutId" TEXT;

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "sms" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "type" "IncidentType" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'MEDIUM',
    "description" TEXT NOT NULL,
    "evidenceDocumentIds" TEXT[],
    "relatedType" TEXT,
    "relatedId" TEXT,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Incident_subjectUserId_status_idx" ON "Incident"("subjectUserId", "status");

-- CreateIndex
CREATE INDEX "Incident_status_createdAt_idx" ON "Incident"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SavedSearch_clientId_idx" ON "SavedSearch"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedSearch_clientId_name_key" ON "SavedSearch"("clientId", "name");

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
