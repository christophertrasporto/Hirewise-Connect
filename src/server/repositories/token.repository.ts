import type { AuthTokenKind } from "@prisma/client";
import type { Db } from "@/server/db/types";

export const tokenRepository = {
  create(db: Db, data: { kind: AuthTokenKind; tokenHash: string; userId: string | null; email: string; expiresAt: Date }) {
    return db.authToken.create({ data: { ...data, userId: data.userId ?? undefined } });
  },

  findUsable(db: Db, kind: AuthTokenKind, tokenHash: string, now = new Date()) {
    return db.authToken.findFirst({ where: { kind, tokenHash, usedAt: null, expiresAt: { gt: now } } });
  },

  /** Marks used atomically; returns count so a race between two consumers yields one winner. */
  consume(db: Db, id: string) {
    return db.authToken.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
  },

  invalidateAll(db: Db, kind: AuthTokenKind, email: string) {
    return db.authToken.updateMany({ where: { kind, email, usedAt: null }, data: { usedAt: new Date() } });
  },
};
