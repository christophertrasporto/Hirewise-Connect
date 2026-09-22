-- CreateEnum
CREATE TYPE "InterviewRequestStatus" AS ENUM ('REQUESTED', 'SALES_REVIEW', 'CLIENT_CONFIRMATION', 'CANDIDATE_CONFIRMATION', 'SCHEDULED', 'COMPLETED', 'CLIENT_DECISION_PENDING', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InterviewCandidateStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'NO_SHOW_CLIENT', 'NO_SHOW_AGENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClientDecision" AS ENUM ('NONE', 'INTERESTED', 'SECOND_INTERVIEW', 'SELECTED', 'NOT_SELECTED');

-- CreateEnum
CREATE TYPE "MessageVisibility" AS ENUM ('ALL', 'HIREWISE_ONLY', 'CLIENT_AND_HIREWISE', 'AGENT_AND_HIREWISE');

-- CreateEnum
CREATE TYPE "PlacementStatus" AS ENUM ('PENDING', 'INTERVIEWING', 'SELECTED', 'AWAITING_AGREEMENT', 'AWAITING_DEPOSIT', 'DEPLOYMENT_PREP', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FlagRule" AS ENUM ('CONTACT_INFO_IN_MESSAGE', 'RATE_DISCUSSION_IN_MESSAGE', 'PROFILE_VIEW_BURST', 'SHORTLIST_CHURN', 'CONTACT_INFO_IN_PROFILE');

-- CreateTable
CREATE TABLE "InterviewRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "requirementId" TEXT,
    "requestedById" TEXT NOT NULL,
    "preferredDate" TIMESTAMP(3),
    "preferredTime" TEXT,
    "timezone" TEXT NOT NULL,
    "notes" TEXT,
    "role" TEXT NOT NULL,
    "schedule" TEXT,
    "targetStartDate" TIMESTAMP(3),
    "status" "InterviewRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "assignedSalesUserId" TEXT,
    "salesNotes" TEXT,
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewRequestCandidate" (
    "id" TEXT NOT NULL,
    "interviewRequestId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "status" "InterviewCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewRequestCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "interviewRequestId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "meetingLink" TEXT,
    "coordinatorUserId" TEXT,
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "clientDecision" "ClientDecision" NOT NULL DEFAULT 'NONE',
    "clientFeedback" TEXT,
    "internalFeedback" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewMessage" (
    "id" TEXT NOT NULL,
    "interviewRequestId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorRole" "RoleKey" NOT NULL,
    "body" TEXT NOT NULL,
    "visibleTo" "MessageVisibility" NOT NULL DEFAULT 'ALL',
    "heldForReview" BOOLEAN NOT NULL DEFAULT false,
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Placement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "requirementId" TEXT,
    "interviewRequestId" TEXT,
    "interviewId" TEXT,
    "positionTitle" TEXT NOT NULL,
    "schedule" TEXT,
    "timezone" TEXT,
    "startDate" TIMESTAMP(3),
    "status" "PlacementStatus" NOT NULL DEFAULT 'SELECTED',
    "accountManagerUserId" TEXT,
    "approvedById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Placement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityFlag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rule" "FlagRule" NOT NULL,
    "details" JSONB,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewRequest_clientId_status_idx" ON "InterviewRequest"("clientId", "status");

-- CreateIndex
CREATE INDEX "InterviewRequest_status_createdAt_idx" ON "InterviewRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "InterviewRequest_assignedSalesUserId_idx" ON "InterviewRequest"("assignedSalesUserId");

-- CreateIndex
CREATE INDEX "InterviewRequestCandidate_agentProfileId_idx" ON "InterviewRequestCandidate"("agentProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewRequestCandidate_interviewRequestId_agentProfileId_key" ON "InterviewRequestCandidate"("interviewRequestId", "agentProfileId");

-- CreateIndex
CREATE INDEX "Interview_interviewRequestId_idx" ON "Interview"("interviewRequestId");

-- CreateIndex
CREATE INDEX "Interview_agentProfileId_idx" ON "Interview"("agentProfileId");

-- CreateIndex
CREATE INDEX "Interview_scheduledAt_status_idx" ON "Interview"("scheduledAt", "status");

-- CreateIndex
CREATE INDEX "InterviewMessage_interviewRequestId_createdAt_idx" ON "InterviewMessage"("interviewRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "Placement_clientId_status_idx" ON "Placement"("clientId", "status");

-- CreateIndex
CREATE INDEX "Placement_agentProfileId_status_idx" ON "Placement"("agentProfileId", "status");

-- CreateIndex
CREATE INDEX "Placement_status_idx" ON "Placement"("status");

-- CreateIndex
CREATE INDEX "ActivityFlag_userId_createdAt_idx" ON "ActivityFlag"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityFlag_rule_reviewedAt_idx" ON "ActivityFlag"("rule", "reviewedAt");

-- AddForeignKey
ALTER TABLE "InterviewRequest" ADD CONSTRAINT "InterviewRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewRequest" ADD CONSTRAINT "InterviewRequest_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "ClientRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewRequest" ADD CONSTRAINT "InterviewRequest_assignedSalesUserId_fkey" FOREIGN KEY ("assignedSalesUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewRequestCandidate" ADD CONSTRAINT "InterviewRequestCandidate_interviewRequestId_fkey" FOREIGN KEY ("interviewRequestId") REFERENCES "InterviewRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewRequestCandidate" ADD CONSTRAINT "InterviewRequestCandidate_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_interviewRequestId_fkey" FOREIGN KEY ("interviewRequestId") REFERENCES "InterviewRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewMessage" ADD CONSTRAINT "InterviewMessage_interviewRequestId_fkey" FOREIGN KEY ("interviewRequestId") REFERENCES "InterviewRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_interviewRequestId_fkey" FOREIGN KEY ("interviewRequestId") REFERENCES "InterviewRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_accountManagerUserId_fkey" FOREIGN KEY ("accountManagerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
