import type { Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";

export const outboxRepository = {
  insert(db: Db, type: string, payload: Prisma.InputJsonValue) {
    return db.outboxEvent.create({ data: { type, payload } });
  },

  /** Claim a batch of unprocessed events. Uses SKIP LOCKED so several workers can run. */
  async claimBatch(db: Db, limit = 20) {
    return db.$queryRaw<Array<{ id: string; type: string; payload: unknown; attempts: number }>>`
      SELECT "id", "type", "payload", "attempts"
      FROM "OutboxEvent"
      WHERE "processedAt" IS NULL AND "attempts" < 10
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
  },

  markProcessed(db: Db, id: string) {
    return db.outboxEvent.update({ where: { id }, data: { processedAt: new Date() } });
  },

  markFailed(db: Db, id: string, error: string) {
    return db.outboxEvent.update({ where: { id }, data: { attempts: { increment: 1 }, lastError: error.slice(0, 2000) } });
  },
};
