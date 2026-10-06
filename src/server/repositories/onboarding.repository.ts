import type { Db } from "@/server/db/types";

export const onboardingRepository = {
  progress(db: Db, userId: string, videoKey: string) {
    return db.onboardingVideoProgress.findUnique({ where: { userId_videoKey: { userId, videoKey } } });
  },

  upsertProgress(db: Db, userId: string, videoKey: string, d: { watchedSeconds: number; lastPositionSec: number; durationSec: number | null; percent: number; completedAt?: Date | null }) {
    return db.onboardingVideoProgress.upsert({
      where: { userId_videoKey: { userId, videoKey } },
      create: { userId, videoKey, ...d, completedAt: d.completedAt ?? undefined },
      update: { ...d, completedAt: d.completedAt === undefined ? undefined : d.completedAt },
    });
  },

  userBasics(db: Db, userId: string) {
    return db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, createdAt: true, emailVerifiedAt: true, agentProfile: { select: { id: true, status: true, submittedAt: true, profileCompletion: true } } } });
  },

  /** Talent accounts with the fields the onboarding status list needs. */
  listAgents(db: Db, q: string | undefined, videoKey: string, take = 200) {
    return db.user.findMany({
      where: { role: { key: "AGENT" }, deletedAt: null, ...(q ? { email: { contains: q, mode: "insensitive" } } : {}) },
      select: {
        id: true,
        email: true,
        createdAt: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        agentProfile: { select: { id: true, displayName: true, status: true, submittedAt: true, profileCompletion: true } },
        onboardingVideoProgress: { where: { videoKey }, select: { percent: true, completedAt: true, watchedSeconds: true, updatedAt: true } },
      },
      orderBy: { createdAt: "desc" },
      take,
    });
  },

  countCompleted(db: Db, videoKey: string) {
    return db.onboardingVideoProgress.count({ where: { videoKey, completedAt: { not: null } } });
  },
};
