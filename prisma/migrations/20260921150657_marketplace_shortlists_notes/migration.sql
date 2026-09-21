-- CreateEnum
CREATE TYPE "IntroductionEvent" AS ENUM ('VIEW', 'SHORTLIST', 'INTERVIEW');

-- CreateEnum
CREATE TYPE "NoteSubjectType" AS ENUM ('AGENT', 'CLIENT', 'PLACEMENT', 'INTERVIEW_REQUEST');

-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('INTERNAL', 'AGENT', 'CLIENT');

-- CreateTable
CREATE TABLE "Shortlist" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'My Shortlist',
    "createdById" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shortlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortlistCandidate" (
    "id" TEXT NOT NULL,
    "shortlistId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "ShortlistCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateView" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Introduction" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "firstEvent" "IntroductionEvent" NOT NULL,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Introduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminNote" (
    "id" TEXT NOT NULL,
    "subjectType" "NoteSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "NoteVisibility" NOT NULL DEFAULT 'INTERNAL',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shortlist_clientId_idx" ON "Shortlist"("clientId");

-- CreateIndex
CREATE INDEX "ShortlistCandidate_shortlistId_removedAt_idx" ON "ShortlistCandidate"("shortlistId", "removedAt");

-- CreateIndex
CREATE INDEX "ShortlistCandidate_agentProfileId_idx" ON "ShortlistCandidate"("agentProfileId");

-- CreateIndex
CREATE INDEX "CandidateView_clientId_viewedAt_idx" ON "CandidateView"("clientId", "viewedAt");

-- CreateIndex
CREATE INDEX "CandidateView_agentProfileId_idx" ON "CandidateView"("agentProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "Introduction_clientId_agentProfileId_key" ON "Introduction"("clientId", "agentProfileId");

-- CreateIndex
CREATE INDEX "AdminNote_subjectType_subjectId_createdAt_idx" ON "AdminNote"("subjectType", "subjectId", "createdAt");

-- AddForeignKey
ALTER TABLE "Shortlist" ADD CONSTRAINT "Shortlist_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistCandidate" ADD CONSTRAINT "ShortlistCandidate_shortlistId_fkey" FOREIGN KEY ("shortlistId") REFERENCES "Shortlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistCandidate" ADD CONSTRAINT "ShortlistCandidate_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateView" ADD CONSTRAINT "CandidateView_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateView" ADD CONSTRAINT "CandidateView_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Introduction" ADD CONSTRAINT "Introduction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Introduction" ADD CONSTRAINT "Introduction_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Section 4.5: one active shortlist membership per (shortlist, agent).
CREATE UNIQUE INDEX IF NOT EXISTS "ShortlistCandidate_active_unique"
  ON "ShortlistCandidate" ("shortlistId", "agentProfileId")
  WHERE "removedAt" IS NULL;
