import type { Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";

export const versionRepository = {
  create(db: Db, d: { lessonId: string; version: number; snapshot: Prisma.InputJsonValue; changedById: string | null; reason: string | null }) {
    return db.lessonVersion.create({ data: d });
  },

  listForLesson(db: Db, lessonId: string) {
    return db.lessonVersion.findMany({ where: { lessonId }, orderBy: { version: "asc" } });
  },

  find(db: Db, lessonId: string, version: number) {
    return db.lessonVersion.findUnique({ where: { lessonId_version: { lessonId, version } } });
  },

  /** The lesson with everything a snapshot needs. */
  lessonForSnapshot(db: Db, lessonId: string) {
    return db.courseLesson.findUniqueOrThrow({ where: { id: lessonId }, include: { questions: { orderBy: { order: "asc" }, include: { choices: { orderBy: { order: "asc" } } } } } });
  },

  bumpVersion(db: Db, lessonId: string) {
    return db.courseLesson.update({ where: { id: lessonId }, data: { version: { increment: 1 } }, select: { version: true } });
  },

  /** How many attempts were taken and how many learners completed the lesson on each version. */
  async usage(db: Db, lessonId: string) {
    const [attempts, completions] = await Promise.all([
      db.quizAttempt.groupBy({ by: ["lessonVersion"], where: { lessonId, status: { not: "IN_PROGRESS" } }, _count: { _all: true } }),
      db.lessonProgress.groupBy({ by: ["lessonVersion"], where: { lessonId, status: "COMPLETED" }, _count: { _all: true } }),
    ]);
    const a = new Map<number | null, number>();
    for (const r of attempts) a.set(r.lessonVersion, r._count._all);
    const c = new Map<number | null, number>();
    for (const r of completions) c.set(r.lessonVersion, r._count._all);
    return { attempts: a, completions: c };
  },

  usersByIds(db: Db, ids: string[]) {
    return ids.length ? db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }) : Promise.resolve([]);
  },
};
