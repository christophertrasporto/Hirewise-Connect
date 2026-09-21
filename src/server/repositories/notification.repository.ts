import type { Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";

export const notificationRepository = {
  create(db: Db, data: { userId: string; type: string; title: string; body: string; data?: Prisma.InputJsonValue }) {
    return db.notification.create({ data });
  },

  listForUser(db: Db, userId: string, take = 50) {
    return db.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take });
  },

  markRead(db: Db, userId: string, id: string) {
    // Scoped by userId so a user can only mark their own notification read.
    return db.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
  },

  findByDedupeKey(db: Db, userId: string, type: string, dedupeKey: string) {
    return db.notification.findFirst({ where: { userId, type, data: { path: ["dedupeKey"], equals: dedupeKey } }, select: { id: true } });
  },

  setChannelStatus(db: Db, id: string, channel: string, status: Prisma.InputJsonValue) {
    return db.notification.update({ where: { id }, data: { channelStatus: { [channel]: status } } });
  },

  preferences(db: Db, userId: string, type: string) {
    return db.notificationPreference.findUnique({ where: { userId_type: { userId, type } } });
  },
};
