-- CreateEnum
CREATE TYPE "AuthTokenKind" AS ENUM ('MAGIC_LINK', 'EMAIL_VERIFY', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "mfaSecretEnc" TEXT;

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "mfaPassed" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "kind" "AuthTokenKind" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT,
    "email" CITEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "assigneeUserId" TEXT,
    "queueRole" "RoleKey",
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "relatedType" TEXT,
    "relatedId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthToken_email_kind_idx" ON "AuthToken"("email", "kind");

-- CreateIndex
CREATE INDEX "Task_assigneeUserId_status_idx" ON "Task"("assigneeUserId", "status");

-- CreateIndex
CREATE INDEX "Task_queueRole_status_idx" ON "Task"("queueRole", "status");

-- CreateIndex
CREATE INDEX "Task_relatedType_relatedId_idx" ON "Task"("relatedType", "relatedId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
