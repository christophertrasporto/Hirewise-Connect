import type { RoleKey } from "@prisma/client";
import type { Db } from "@/server/db/types";

export const taskRepository = {
  create(db: Db, data: { type: string; title: string; queueRole?: RoleKey | null; assigneeUserId?: string | null; dueAt?: Date | null; relatedType?: string; relatedId?: string; createdById?: string | null }) {
    return db.task.create({
      data: {
        type: data.type,
        title: data.title,
        queueRole: data.queueRole ?? undefined,
        assigneeUserId: data.assigneeUserId ?? undefined,
        dueAt: data.dueAt ?? undefined,
        relatedType: data.relatedType,
        relatedId: data.relatedId,
        createdById: data.createdById ?? undefined,
      },
    });
  },

  openForQueue(db: Db, queueRole: RoleKey, take = 50) {
    return db.task.findMany({ where: { queueRole, status: { in: ["OPEN", "IN_PROGRESS"] } }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }], take });
  },

  openForUser(db: Db, userId: string, take = 50) {
    return db.task.findMany({ where: { assigneeUserId: userId, status: { in: ["OPEN", "IN_PROGRESS"] } }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }], take });
  },

  findOpenByRelated(db: Db, type: string, relatedType: string, relatedId: string) {
    return db.task.findFirst({ where: { type, relatedType, relatedId, status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { id: true } });
  },

  completeByRelated(db: Db, type: string, relatedType: string, relatedId: string) {
    return db.task.updateMany({ where: { type, relatedType, relatedId, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { status: "DONE" } });
  },
};
