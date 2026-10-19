-- CreateEnum
CREATE TYPE "ThreadKind" AS ENUM ('INTERVIEW_REQUEST', 'PARTNER_ENQUIRY', 'SUPPORT', 'OPPORTUNITY', 'SUBMISSION');

-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "MeetingLinkSource" AS ENUM ('PROVIDER', 'STAFF_PASTED');

-- CreateEnum
CREATE TYPE "AliasOwnerType" AS ENUM ('AGENT_PROFILE', 'AGENCY', 'CLIENT');

-- CreateEnum
CREATE TYPE "BypassReportStatus" AS ENUM ('REPORTED', 'UNDER_REVIEW', 'WARNING_ISSUED', 'RESTRICTED', 'SUSPENDED', 'CLOSED');

-- AlterEnum
ALTER TYPE "DocumentOwnerType" ADD VALUE 'BYPASS_REPORT';

-- AlterEnum
ALTER TYPE "FlagRule" ADD VALUE 'MEETING_LINK_REFUSED';

-- AlterEnum
ALTER TYPE "MessageVisibility" ADD VALUE 'AGENCY_AND_HIREWISE';

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "linkSource" "MeetingLinkSource",
ADD COLUMN     "participants" JSONB;

-- AlterTable
ALTER TABLE "InterviewRequest" ADD COLUMN     "requestedWindows" JSONB;

-- CreateTable
CREATE TABLE "MessageThread" (
    "id" TEXT NOT NULL,
    "kind" "ThreadKind" NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "interviewRequestId" TEXT,
    "clientId" TEXT,
    "agencyId" TEXT,
    "agentProfileId" TEXT,
    "title" TEXT NOT NULL,
    "status" "ThreadStatus" NOT NULL DEFAULT 'OPEN',
    "assignedStaffUserId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "MessageThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorRole" "RoleKey" NOT NULL,
    "body" TEXT NOT NULL,
    "originalBody" TEXT,
    "findings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visibleTo" "MessageVisibility" NOT NULL DEFAULT 'ALL',
    "heldForReview" BOOLEAN NOT NULL DEFAULT false,
    "maskedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAlias" (
    "id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "ownerType" "AliasOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "routingTarget" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BypassReport" (
    "id" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "reporterRole" "RoleKey" NOT NULL,
    "reportedUserId" TEXT,
    "reportedAgencyId" TEXT,
    "reportedClientId" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "description" TEXT NOT NULL,
    "evidenceDocumentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "BypassReportStatus" NOT NULL DEFAULT 'REPORTED',
    "assignedToUserId" TEXT,
    "decisionNotes" TEXT,
    "restrictionEndsAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BypassReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BypassReportEvent" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "fromStatus" "BypassReportStatus",
    "toStatus" "BypassReportStatus" NOT NULL,
    "byUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BypassReportEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageThread_interviewRequestId_key" ON "MessageThread"("interviewRequestId");

-- CreateIndex
CREATE INDEX "MessageThread_clientId_status_idx" ON "MessageThread"("clientId", "status");

-- CreateIndex
CREATE INDEX "MessageThread_agencyId_status_idx" ON "MessageThread"("agencyId", "status");

-- CreateIndex
CREATE INDEX "MessageThread_agentProfileId_status_idx" ON "MessageThread"("agentProfileId", "status");

-- CreateIndex
CREATE INDEX "MessageThread_kind_status_idx" ON "MessageThread"("kind", "status");

-- CreateIndex
CREATE INDEX "Message_threadId_createdAt_idx" ON "Message"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_heldForReview_createdAt_idx" ON "Message"("heldForReview", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAlias_alias_key" ON "EmailAlias"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAlias_ownerType_ownerId_key" ON "EmailAlias"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "BypassReport_status_createdAt_idx" ON "BypassReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BypassReport_reportedUserId_idx" ON "BypassReport"("reportedUserId");

-- CreateIndex
CREATE INDEX "BypassReport_reportedAgencyId_idx" ON "BypassReport"("reportedAgencyId");

-- CreateIndex
CREATE INDEX "BypassReport_reportedClientId_idx" ON "BypassReport"("reportedClientId");

-- CreateIndex
CREATE INDEX "BypassReportEvent_reportId_createdAt_idx" ON "BypassReportEvent"("reportId", "createdAt");

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_interviewRequestId_fkey" FOREIGN KEY ("interviewRequestId") REFERENCES "InterviewRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_assignedStaffUserId_fkey" FOREIGN KEY ("assignedStaffUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BypassReport" ADD CONSTRAINT "BypassReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BypassReport" ADD CONSTRAINT "BypassReport_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BypassReport" ADD CONSTRAINT "BypassReport_reportedAgencyId_fkey" FOREIGN KEY ("reportedAgencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BypassReport" ADD CONSTRAINT "BypassReport_reportedClientId_fkey" FOREIGN KEY ("reportedClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BypassReport" ADD CONSTRAINT "BypassReport_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BypassReportEvent" ADD CONSTRAINT "BypassReportEvent_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "BypassReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

