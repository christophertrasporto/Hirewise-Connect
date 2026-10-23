-- CreateEnum
CREATE TYPE "SkillVerificationMode" AS ENUM ('NONE', 'ANY_COURSE', 'REQUIRED_COURSE', 'PATHWAY');

-- CreateEnum
CREATE TYPE "RequirementLevel" AS ENUM ('DECLARED', 'VERIFIED', 'CERTIFIED');

-- CreateEnum
CREATE TYPE "SkillTagRequestStatus" AS ENUM ('OPEN', 'APPROVED', 'MERGED', 'REJECTED');

-- AlterTable
ALTER TABLE "AgentSkill" DROP COLUMN "level",
DROP COLUMN "verifiedById",
DROP COLUMN "yearsUsed",
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedVia" TEXT;

-- AlterTable
ALTER TABLE "CertificationTemplate" ADD COLUMN     "skillId" TEXT;

-- AlterTable
ALTER TABLE "Skill" ADD COLUMN     "description" TEXT,
ADD COLUMN     "hashtag" TEXT,
ADD COLUMN     "minAssessmentScore" INTEGER NOT NULL DEFAULT 80,
ADD COLUMN     "requiredCourseId" TEXT,
ADD COLUMN     "requiredPathwayId" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "verificationMode" "SkillVerificationMode" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "CourseSkillTag" (
    "courseId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseSkillTag_pkey" PRIMARY KEY ("courseId","skillId")
);

-- CreateTable
CREATE TABLE "SkillPathway" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillPathway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PathwayCourse" (
    "pathwayId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PathwayCourse_pkey" PRIMARY KEY ("pathwayId","courseId")
);

-- CreateTable
CREATE TABLE "OpportunityRequirement" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "skillId" TEXT,
    "certificationTemplateId" TEXT,
    "requiredLevel" "RequirementLevel" NOT NULL DEFAULT 'DECLARED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillTagRequest" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "SkillTagRequestStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "mergedIntoSkillId" TEXT,
    "createdSkillId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillTagRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseSkillTag_skillId_idx" ON "CourseSkillTag"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillPathway_slug_key" ON "SkillPathway"("slug");

-- CreateIndex
CREATE INDEX "OpportunityRequirement_opportunityId_idx" ON "OpportunityRequirement"("opportunityId");

-- CreateIndex
CREATE INDEX "SkillTagRequest_status_createdAt_idx" ON "SkillTagRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentSkill_skillId_verifiedAt_idx" ON "AgentSkill"("skillId", "verifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_slug_key" ON "Skill"("slug");

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_requiredCourseId_fkey" FOREIGN KEY ("requiredCourseId") REFERENCES "AcademyCourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_requiredPathwayId_fkey" FOREIGN KEY ("requiredPathwayId") REFERENCES "SkillPathway"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificationTemplate" ADD CONSTRAINT "CertificationTemplate_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSkillTag" ADD CONSTRAINT "CourseSkillTag_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSkillTag" ADD CONSTRAINT "CourseSkillTag_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PathwayCourse" ADD CONSTRAINT "PathwayCourse_pathwayId_fkey" FOREIGN KEY ("pathwayId") REFERENCES "SkillPathway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PathwayCourse" ADD CONSTRAINT "PathwayCourse_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityRequirement" ADD CONSTRAINT "OpportunityRequirement_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityRequirement" ADD CONSTRAINT "OpportunityRequirement_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityRequirement" ADD CONSTRAINT "OpportunityRequirement_certificationTemplateId_fkey" FOREIGN KEY ("certificationTemplateId") REFERENCES "CertificationTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillTagRequest" ADD CONSTRAINT "SkillTagRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillTagRequest" ADD CONSTRAINT "SkillTagRequest_mergedIntoSkillId_fkey" FOREIGN KEY ("mergedIntoSkillId") REFERENCES "Skill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillTagRequest" ADD CONSTRAINT "SkillTagRequest_createdSkillId_fkey" FOREIGN KEY ("createdSkillId") REFERENCES "Skill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

