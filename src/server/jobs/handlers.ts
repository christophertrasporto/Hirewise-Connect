import { z } from "zod";
import type { Db } from "@/server/db/types";
import { getEmailChannel } from "@/server/adapters/email";
import { notificationRepository } from "@/server/repositories/notification.repository";

export type JobHandler = (db: Db, payload: unknown) => Promise<void>;

const sendEmailPayload = z.object({
  notificationId: z.string().optional(),
  to: z.string().email(),
  subject: z.string(),
  text: z.string(),
  html: z.string().nullable().optional(),
});

/**
 * Job type → handler. Jobs are retried up to five times with backoff (see worker).
 * Phase 2+ adds RESERVATION_EXPIRY, INTERVIEW_REMINDER, CERTIFICATION_EXPIRY.
 */
export const JOB_HANDLERS: Record<string, JobHandler> = {
  SEND_EMAIL: async (db, raw) => {
    const p = sendEmailPayload.parse(raw);
    const result = await getEmailChannel().send({ to: p.to, subject: p.subject, text: p.text, html: p.html ?? undefined });
    if (p.notificationId) {
      await notificationRepository.setChannelStatus(db, p.notificationId, "email", { sentAt: new Date().toISOString(), providerId: result.providerId ?? null });
    }
  },
};
