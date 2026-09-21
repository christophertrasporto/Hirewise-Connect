import type { Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";

export const jobRepository = {
  enqueue(db: Db, type: string, payload: Prisma.InputJsonValue, runAt = new Date()) {
    return db.job.create({ data: { type, payload, runAt } });
  },

  /** Claim due jobs atomically. A job locked for more than 10 minutes is considered stale and reclaimable. */
  async claimDue(db: Db, limit = 10) {
    return db.$queryRaw<Array<{ id: string; type: string; payload: unknown; attempts: number }>>`
      UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = NOW(), "attempts" = "attempts" + 1, "updatedAt" = NOW()
      WHERE "id" IN (
        SELECT "id" FROM "Job"
        WHERE "runAt" <= NOW()
          AND (
            "status" = 'PENDING'
            OR ("status" = 'RUNNING' AND "lockedAt" < NOW() - INTERVAL '10 minutes')
            OR ("status" = 'FAILED' AND "attempts" < 5)
          )
        ORDER BY "runAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "type", "payload", "attempts"
    `;
  },

  complete(db: Db, id: string) {
    return db.job.update({ where: { id }, data: { status: "COMPLETED", lockedAt: null } });
  },

  fail(db: Db, id: string, error: string, retryAt?: Date) {
    return db.job.update({
      where: { id },
      data: { status: "FAILED", lockedAt: null, lastError: error.slice(0, 2000), ...(retryAt ? { runAt: retryAt } : {}) },
    });
  },
};
