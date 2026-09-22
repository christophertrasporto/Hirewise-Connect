import type { PrismaClient } from "@/server/db/types";
import { outboxRepository } from "@/server/repositories/outbox.repository";
import { jobRepository } from "@/server/repositories/job.repository";
import { EVENT_HANDLERS } from "@/server/events/handlers";
import type { DomainEventType } from "@/server/events/events";
import { JOB_HANDLERS } from "./handlers";
import { logger } from "@/server/logger";

/**
 * One pass: drain claimed outbox events, then run due jobs. Returns counts so
 * tests can drive the worker deterministically without timers.
 */
export async function runWorkerOnce(prisma: PrismaClient): Promise<{ events: number; jobs: number; failures: number }> {
  let failures = 0;

  const events = await prisma.$transaction(async (tx) => {
    const batch = await outboxRepository.claimBatch(tx);
    for (const ev of batch) {
      const handler = EVENT_HANDLERS[ev.type as DomainEventType] as ((db: typeof tx, payload: unknown) => Promise<void>) | undefined;
      if (!handler) {
        await outboxRepository.markFailed(tx, ev.id, `No handler for event type ${ev.type}`);
        failures++;
        continue;
      }
      try {
        await handler(tx, ev.payload);
        await outboxRepository.markProcessed(tx, ev.id);
      } catch (err) {
        failures++;
        await outboxRepository.markFailed(tx, ev.id, err instanceof Error ? err.message : String(err));
        logger.error({ err, eventId: ev.id, type: ev.type }, "outbox handler failed");
      }
    }
    return batch.length;
  });

  const due = await jobRepository.claimDue(prisma);
  for (const job of due) {
    const handler = JOB_HANDLERS[job.type];
    if (!handler) {
      await jobRepository.fail(prisma, job.id, `No handler for job type ${job.type}`);
      failures++;
      continue;
    }
    try {
      await handler(prisma, job.payload);
      await jobRepository.complete(prisma, job.id);
    } catch (err) {
      failures++;
      const backoffMs = Math.min(60_000 * 2 ** job.attempts, 30 * 60_000);
      await jobRepository.fail(prisma, job.id, err instanceof Error ? err.message : String(err), new Date(Date.now() + backoffMs));
      logger.error({ err, jobId: job.id, type: job.type, attempts: job.attempts }, "job failed");
    }
  }

  return { events, jobs: due.length, failures };
}

let lastMaintenance = 0;
const MAINTENANCE_INTERVAL_MS = 10 * 60_000;

/** Periodic housekeeping: reservation expiry and expiry warnings (Section 5.8). */
export async function runMaintenance(prisma: PrismaClient, now = new Date()): Promise<{ expired: number; expiring: number }> {
  const { expireReservations, notifyExpiringReservations } = await import("@/server/services/reservation.service");
  const expired = await expireReservations(prisma, now);
  const expiring = await notifyExpiringReservations(prisma, now);
  return { expired, expiring };
}

/** Long-running loop used by `npm run worker`. */
export async function runWorkerLoop(prisma: PrismaClient, pollMs: number, signal?: AbortSignal): Promise<void> {
  logger.info({ pollMs }, "worker started");
  while (!signal?.aborted) {
    try {
      const r = await runWorkerOnce(prisma);
      if (r.events || r.jobs) logger.info(r, "worker pass");
      if (Date.now() - lastMaintenance > MAINTENANCE_INTERVAL_MS) {
        lastMaintenance = Date.now();
        const m = await runMaintenance(prisma);
        if (m.expired || m.expiring) logger.info(m, "maintenance");
      }
    } catch (err) {
      logger.error({ err }, "worker pass crashed");
    }
    await new Promise((res) => setTimeout(res, pollMs));
  }
  logger.info("worker stopped");
}
