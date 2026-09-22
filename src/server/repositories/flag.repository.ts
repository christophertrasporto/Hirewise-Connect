import type { FlagRule, Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";

export const flagRepository = {
  create(db: Db, d: { userId: string; rule: FlagRule; details?: Prisma.InputJsonValue; relatedType?: string; relatedId?: string }) {
    return db.activityFlag.create({ data: d });
  },

  listOpen(db: Db, take = 100) {
    return db.activityFlag.findMany({ where: { reviewedAt: null }, orderBy: { createdAt: "desc" }, take });
  },

  markReviewed(db: Db, id: string, reviewedById: string) {
    return db.activityFlag.update({ where: { id }, data: { reviewedById, reviewedAt: new Date() } });
  },

  countOpen(db: Db) {
    return db.activityFlag.count({ where: { reviewedAt: null } });
  },
};
