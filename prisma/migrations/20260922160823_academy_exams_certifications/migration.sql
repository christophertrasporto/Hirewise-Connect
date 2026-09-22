-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ENROLLED', 'IN_PROGRESS', 'COMPLETED', 'DROPPED');

-- CreateEnum
CREATE TYPE "EnrollmentSource" AS ENUM ('INTERNAL', 'ACADEMY_SYNC');

-- CreateEnum
CREATE TYPE "CoursePaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AssessmentType" AS ENUM ('EXAM', 'PRACTICAL', 'ROLEPLAY', 'MOCK_CALL', 'SKILL');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'FINAL');

-- CreateEnum
CREATE TYPE "CertificationOrigin" AS ENUM ('ACADEMY', 'ADMIN_ISSUED');

-- CreateEnum
CREATE TYPE "CertificationStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REVOKED', 'EXPIRED');

-- AlterTable
ALTER TABLE "AgentProfile" ADD COLUMN     "verificationIsManual" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AcademyCourse" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "syllabus" TEXT,
    "contentUrl" TEXT,
    "ownerCoachUserId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "passingScore" INTEGER NOT NULL DEFAULT 70,
    "requiresCoachReview" BOOLEAN NOT NULL DEFAULT false,
    "certificationTemplateId" TEXT,
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseCoach" (
    "courseId" TEXT NOT NULL,
    "coachUserId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseCoach_pkey" PRIMARY KEY ("courseId","coachUserId")
);

-- CreateTable
CREATE TABLE "CourseEnrollment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ENROLLED',
    "source" "EnrollmentSource" NOT NULL DEFAULT 'INTERNAL',
    "paymentStatus" "CoursePaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "paidCents" INTEGER,
    "paymentReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentRecordedById" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseCompletion" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "examScore" INTEGER,
    "source" "EnrollmentSource" NOT NULL DEFAULT 'INTERNAL',
    "externalRef" TEXT,

    CONSTRAINT "CourseCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "timeLimitMin" INTEGER,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "status" "ExamStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamQuestion" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" TEXT[],
    "correctIndex" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,
    "explanation" TEXT,

    CONSTRAINT "ExamQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamAttempt" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "answers" JSONB,
    "scorePercent" INTEGER,
    "passed" BOOLEAN,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ExamAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentResultLabel" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentResultLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT,
    "agentProfileId" TEXT NOT NULL,
    "coachUserId" TEXT NOT NULL,
    "type" "AssessmentType" NOT NULL,
    "examScore" INTEGER,
    "practicalScore" INTEGER,
    "roleplayScore" INTEGER,
    "communicationScore" INTEGER,
    "skillScores" JSONB,
    "comments" TEXT,
    "strengths" TEXT,
    "areasForImprovement" TEXT,
    "resultLabelId" TEXT,
    "certificationRecommended" BOOLEAN NOT NULL DEFAULT false,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachEvaluation" (
    "id" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "coachUserId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "communication" INTEGER NOT NULL,
    "reliability" INTEGER NOT NULL,
    "coachability" INTEGER NOT NULL,
    "overallLabelId" TEXT,
    "visibleToClients" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificationTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "validityMonths" INTEGER,
    "badgeKey" TEXT,
    "requiresCompletion" BOOLEAN NOT NULL DEFAULT true,
    "minExamScore" INTEGER,
    "requiresCoachReview" BOOLEAN NOT NULL DEFAULT false,
    "minResultLabelRank" INTEGER,
    "clientVisibleScores" TEXT[] DEFAULT ARRAY['examScore', 'roleplayScore', 'communicationScore']::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certification" (
    "id" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "origin" "CertificationOrigin" NOT NULL,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "assessmentId" TEXT,
    "courseId" TEXT,
    "status" "CertificationStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationRequirement" (
    "level" "VerificationLevel" NOT NULL,
    "rules" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationRequirement_pkey" PRIMARY KEY ("level")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcademyCourse_code_key" ON "AcademyCourse"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AcademyCourse_externalId_key" ON "AcademyCourse"("externalId");

-- CreateIndex
CREATE INDEX "AcademyCourse_status_category_idx" ON "AcademyCourse"("status", "category");

-- CreateIndex
CREATE INDEX "AcademyCourse_ownerCoachUserId_idx" ON "AcademyCourse"("ownerCoachUserId");

-- CreateIndex
CREATE INDEX "CourseCoach_coachUserId_idx" ON "CourseCoach"("coachUserId");

-- CreateIndex
CREATE INDEX "CourseEnrollment_agentProfileId_status_idx" ON "CourseEnrollment"("agentProfileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CourseEnrollment_courseId_agentProfileId_key" ON "CourseEnrollment"("courseId", "agentProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseCompletion_enrollmentId_key" ON "CourseCompletion"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Exam_courseId_key" ON "Exam"("courseId");

-- CreateIndex
CREATE INDEX "ExamQuestion_examId_order_idx" ON "ExamQuestion"("examId", "order");

-- CreateIndex
CREATE INDEX "ExamAttempt_enrollmentId_status_idx" ON "ExamAttempt"("enrollmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentResultLabel_key_key" ON "AssessmentResultLabel"("key");

-- CreateIndex
CREATE INDEX "Assessment_agentProfileId_status_idx" ON "Assessment"("agentProfileId", "status");

-- CreateIndex
CREATE INDEX "Assessment_courseId_idx" ON "Assessment"("courseId");

-- CreateIndex
CREATE INDEX "Assessment_coachUserId_idx" ON "Assessment"("coachUserId");

-- CreateIndex
CREATE INDEX "CoachEvaluation_agentProfileId_idx" ON "CoachEvaluation"("agentProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "CertificationTemplate_name_key" ON "CertificationTemplate"("name");

-- CreateIndex
CREATE INDEX "Certification_agentProfileId_status_idx" ON "Certification"("agentProfileId", "status");

-- CreateIndex
CREATE INDEX "Certification_status_expiresAt_idx" ON "Certification"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Certification_agentProfileId_templateId_courseId_key" ON "Certification"("agentProfileId", "templateId", "courseId");

-- AddForeignKey
ALTER TABLE "AcademyCourse" ADD CONSTRAINT "AcademyCourse_ownerCoachUserId_fkey" FOREIGN KEY ("ownerCoachUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyCourse" ADD CONSTRAINT "AcademyCourse_certificationTemplateId_fkey" FOREIGN KEY ("certificationTemplateId") REFERENCES "CertificationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseCoach" ADD CONSTRAINT "CourseCoach_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseCoach" ADD CONSTRAINT "CourseCoach_coachUserId_fkey" FOREIGN KEY ("coachUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseCompletion" ADD CONSTRAINT "CourseCompletion_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "CourseEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "CourseEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademyCourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_coachUserId_fkey" FOREIGN KEY ("coachUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_resultLabelId_fkey" FOREIGN KEY ("resultLabelId") REFERENCES "AssessmentResultLabel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachEvaluation" ADD CONSTRAINT "CoachEvaluation_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachEvaluation" ADD CONSTRAINT "CoachEvaluation_coachUserId_fkey" FOREIGN KEY ("coachUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachEvaluation" ADD CONSTRAINT "CoachEvaluation_overallLabelId_fkey" FOREIGN KEY ("overallLabelId") REFERENCES "AssessmentResultLabel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CertificationTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
