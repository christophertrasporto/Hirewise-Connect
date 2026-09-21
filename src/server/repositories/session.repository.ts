import type { Db } from "@/server/db/types";

export const sessionRepository = {
  create(db: Db, data: { userId: string; tokenHash: string; mfaPassed: boolean; expiresAt: Date; ipAddress?: string | null; userAgent?: string | null }) {
    return db.session.create({ data: { ...data, ipAddress: data.ipAddress ?? undefined, userAgent: data.userAgent ?? undefined } });
  },

  findLive(db: Db, tokenHash: string, now = new Date()) {
    return db.session.findFirst({ where: { tokenHash, expiresAt: { gt: now } }, select: { id: true, userId: true, mfaPassed: true, expiresAt: true, lastSeenAt: true } });
  },

  touch(db: Db, id: string) {
    return db.session.update({ where: { id }, data: { lastSeenAt: new Date() } });
  },

  markMfaPassed(db: Db, id: string) {
    return db.session.update({ where: { id }, data: { mfaPassed: true } });
  },

  deleteByHash(db: Db, tokenHash: string) {
    return db.session.deleteMany({ where: { tokenHash } });
  },

  deleteAllForUser(db: Db, userId: string) {
    return db.session.deleteMany({ where: { userId } });
  },

  deleteExpired(db: Db, now = new Date()) {
    return db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  },
};
