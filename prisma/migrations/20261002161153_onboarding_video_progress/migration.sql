-- CreateTable
CREATE TABLE "OnboardingVideoProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoKey" TEXT NOT NULL,
    "watchedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastPositionSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "durationSec" DOUBLE PRECISION,
    "percent" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingVideoProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnboardingVideoProgress_videoKey_completedAt_idx" ON "OnboardingVideoProgress"("videoKey", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingVideoProgress_userId_videoKey_key" ON "OnboardingVideoProgress"("userId", "videoKey");

-- AddForeignKey
ALTER TABLE "OnboardingVideoProgress" ADD CONSTRAINT "OnboardingVideoProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

