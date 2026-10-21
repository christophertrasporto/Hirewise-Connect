-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('DRAFT', 'OPEN', 'INTERVIEWING', 'FILLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OpportunityVisibility" AS ENUM ('ALL_AGENCIES', 'SELECTED_AGENCIES', 'DIRECT_ONLY');

-- CreateEnum
CREATE TYPE "OpportunitySubmissionStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED_FOR_CLIENT', 'DECLINED', 'WITHDRAWN', 'INTERVIEWING', 'SELECTED', 'NOT_SELECTED');

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "roleSummary" TEXT NOT NULL,
    "maskedClientLabel" TEXT NOT NULL,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "software" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "industry" TEXT,
    "experienceLevel" "ExperienceLevel",
    "schedule" TEXT,
    "timezone" TEXT,
    "startDate" TIMESTAMP(3),
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "visibility" "OpportunityVisibility" NOT NULL DEFAULT 'ALL_AGENCIES',
    "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "publishedById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityAgency" (
    "opportunityId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityAgency_pkey" PRIMARY KEY ("opportunityId","agencyId")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "agencyId" TEXT,
    "submittedById" TEXT NOT NULL,
    "note" TEXT,
    "status" "OpportunitySubmissionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "withdrawnReason" TEXT,
    "interviewRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_requirementId_key" ON "Opportunity"("requirementId");

-- CreateIndex
CREATE INDEX "Opportunity_status_publishedAt_idx" ON "Opportunity"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "Opportunity_clientId_idx" ON "Opportunity"("clientId");

-- CreateIndex
CREATE INDEX "OpportunityAgency_agencyId_idx" ON "OpportunityAgency"("agencyId");

-- CreateIndex
CREATE INDEX "Submission_opportunityId_status_idx" ON "Submission"("opportunityId", "status");

-- CreateIndex
CREATE INDEX "Submission_agencyId_status_idx" ON "Submission"("agencyId", "status");

-- CreateIndex
CREATE INDEX "Submission_agentProfileId_idx" ON "Submission"("agentProfileId");

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "ClientRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityAgency" ADD CONSTRAINT "OpportunityAgency_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityAgency" ADD CONSTRAINT "OpportunityAgency_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_interviewRequestId_fkey" FOREIGN KEY ("interviewRequestId") REFERENCES "InterviewRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

