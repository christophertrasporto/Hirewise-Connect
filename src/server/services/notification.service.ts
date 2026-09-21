import type { Db } from "@/server/db/types";
import { notificationRepository } from "@/server/repositories/notification.repository";
import { jobRepository } from "@/server/repositories/job.repository";

export type NotifyParams = {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** When present, an email job is enqueued unless the user opted out of email for this type. */
  email?: { to: string; html?: string };
  /** Prevents duplicate in-app notifications on retry. */
  dedupeKey?: string;
};

/**
 * Create an in-app notification and, if requested, enqueue the email job.
 * Called by event handlers, not by route handlers directly.
 */
export async function notifyUser(db: Db, p: NotifyParams): Promise<void> {
  if (p.dedupeKey) {
    const existing = await notificationRepository.findByDedupeKey(db, p.userId, p.type, p.dedupeKey);
    if (existing) return;
  }

  const data = { ...(p.data ?? {}), ...(p.dedupeKey ? { dedupeKey: p.dedupeKey } : {}) };
  const notification = await notificationRepository.create(db, { userId: p.userId, type: p.type, title: p.title, body: p.body, data });

  if (p.email) {
    const pref = await notificationRepository.preferences(db, p.userId, p.type);
    if (pref === null || pref.email) {
      await jobRepository.enqueue(db, "SEND_EMAIL", {
        notificationId: notification.id,
        to: p.email.to,
        subject: p.title,
        text: p.body,
        html: p.email.html ?? null,
      });
    }
  }
}
