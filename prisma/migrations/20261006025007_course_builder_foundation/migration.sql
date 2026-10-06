-- CreateEnum
CREATE TYPE "CourseDifficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "PublishState" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'MULTIPLE_SELECT', 'TRUE_FALSE', 'SHORT_ANSWER');

-- CreateEnum
CREATE TYPE "QuestionState" AS ENUM ('DRAFT', 'PUBLISHED', 'SUGGESTED');

-- CreateEnum
CREATE TYPE "ReviewMode" AS ENUM ('AUTO', 'MANUAL', 'BOTH');

-- CreateEnum
CREATE TYPE "ScorePolicy" AS ENUM ('HIGHEST', 'LATEST');

-- CreateEnum
CREATE TYPE "LessonProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'RETAKE_REQUIRED', 'PENDING_REVIEW');

-- CreateEnum
CREATE TYPE "QuizAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'PENDING_REVIEW');

-- CreateEnum
CREATE TYPE "SubmissionType" AS ENUM ('TEXT', 'URL', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('SUBMITTED', 'GRADED', 'RETURNED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LessonContentType" ADD VALUE 'QUIZ';
ALTER TYPE "LessonContentType" ADD VALUE 'ASSIGNMENT';
ALTER TYPE "LessonContentType" ADD VALUE 'ASSESSMENT';

-- AlterTable
ALTER TABLE "AcademyCourse" ADD COLUMN     "accessRules" JSONB,
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "completionRequiresFinalAssessment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "completionRequiresQuizPass" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "difficulty" "CourseDifficulty" NOT NULL DEFAULT 'BEGINNER',
ADD COLUMN     "displayOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "estimatedMinutes" INTEGER,
ADD COLUMN     "introVideoUrl" TEXT,
ADD COLUMN     "isRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sequentialUnlock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "thumbnailKey" TEXT,
ADD COLUMN     "welcomeMessage" TEXT;

-- AlterTable
ALTER TABLE "Certification" ADD COLUMN     "certificateNumber" TEXT,
ADD COLUMN     "verificationCode" TEXT;

-- AlterTable
ALTER TABLE "CourseLesson" ADD COLUMN     "description" TEXT,
ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "isRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maxAttempts" INTEGER,
ADD COLUMN     "passingScore" INTEGER,
ADD COLUMN     "points" INTEGER,
ADD COLUMN     "randomizeCount" INTEGER,
ADD COLUMN     "requiredPercent" INTEGER,
ADD COLUMN     "retakeWaitMinutes" INTEGER,
ADD COLUMN     "reviewMode" "ReviewMode" NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "scorePolicy" "ScorePolicy" NOT NULL DEFAULT 'HIGHEST',
ADD COLUMN     "showCorrectAnswers" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showExplanations" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "shuffleAnswers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" "PublishState" NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN     "submissionType" "SubmissionType",
ADD COLUMN     "timeLimitMin" INTEGER,
ADD COLUMN     "transcript" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "CourseModule" ADD COLUMN     "isRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "status" "PublishState" NOT NULL DEFAULT 'PUBLISHED';

-- CreateTable
CREATE TABLE "CourseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoursePrerequisite" (
    "courseId" TEXT NOT NULL,
    "requiresCourseId" TEXT NOT NULL,

    CONSTRAINT "CoursePrerequisite_pkey" PRIMARY KEY ("courseId","requiresCourseId")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT,
    "courseId" TEXT,
    "topic" TEXT,
    "difficulty" "CourseDifficulty",
    "type" "QuestionType" NOT NULL DEFAULT 'MULTIPLE_CHOICE',
    "prompt" TEXT NOT NULL,
    "explanation" TEXT,
    "points" INTEGER NOT NULL DEFAULT 1,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "state" "QuestionState" NOT NULL DEFAULT 'PUBLISHED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL DEFAULT 'coach',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionChoice" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuestionChoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonProgress" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "status" "LessonProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "mediaSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastPositionSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mediaPercent" INTEGER NOT NULL DEFAULT 0,
    "mediaCompletedAt" TIMESTAMP(3),
    "lessonVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "lessonVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "QuizAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "questionSnapshot" JSONB NOT NULL,
    "answers" JSONB,
    "scorePercent" INTEGER,
    "passed" BOOLEAN,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "feedback" TEXT,

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentSubmission" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "submissionType" "SubmissionType" NOT NULL,
    "text" TEXT,
    "url" TEXT,
    "storageKey" TEXT,
    "fileName" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "grade" INTEGER,
    "feedback" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseProgress" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "requiredTotal" INTEGER NOT NULL DEFAULT 0,
    "requiredDone" INTEGER NOT NULL DEFAULT 0,
    "percent" INTEGER NOT NULL DEFAULT 0,
    "currentLessonId" TEXT,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonVersion" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "LessonVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseCategory_name_key" ON "CourseCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CourseCategory_slug_key" ON "CourseCategory"("slug");

-- CreateIndex
CREATE INDEX "Question_lessonId_order_idx" ON "Question"("lessonId", "order");

-- CreateIndex
CREATE INDEX "Question_courseId_topic_idx" ON "Question"("courseId", "topic");

-- CreateIndex
CREATE INDEX "QuestionChoice_questionId_order_idx" ON "QuestionChoice"("questionId", "order");

-- CreateIndex
CREATE INDEX "LessonProgress_agentProfileId_status_idx" ON "LessonProgress"("agentProfileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LessonProgress_lessonId_agentProfileId_key" ON "LessonProgress"("lessonId", "agentProfileId");

-- CreateIndex
CREATE INDEX "QuizAttempt_lessonId_agentProfileId_startedAt_idx" ON "QuizAttempt"("lessonId", "agentProfileId", "startedAt");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_lessonId_agentProfileId_idx" ON "AssignmentSubmission"("lessonId", "agentProfileId");

-- CreateIndex
CREATE INDEX "CourseProgress_agentProfileId_idx" ON "CourseProgress"("agentProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseProgress_courseId_agentProfileId_key" ON "CourseProgress"("courseId", "agentProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonVersion_lessonId_version_key" ON "LessonVersion"("lessonId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Certification_certificateNumber_key" ON "Certification"("certificateNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Certification_verificationCode_key" ON "Certification"("verificationCode");

-- AddForeignKey
ALTER TABLE "AcademyCourse" ADD CONSTRAINT "AcademyCourse_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CourseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePrerequisite" ADD CONSTRAINT "CoursePrerequisite_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePrerequisite" ADD CONSTRAINT "CoursePrerequisite_requiresCourseId_fkey" FOREIGN KEY ("requiresCourseId") REFERENCES "AcademyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademyCourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionChoice" ADD CONSTRAINT "QuestionChoice_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonProgress" ADD CONSTRAINT "LessonProgress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonProgress" ADD CONSTRAINT "LessonProgress_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseProgress" ADD CONSTRAINT "CourseProgress_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseProgress" ADD CONSTRAINT "CourseProgress_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonVersion" ADD CONSTRAINT "LessonVersion_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
