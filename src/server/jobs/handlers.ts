import { z } from "zod";
import type { Db } from "@/server/db/types";
import { getEmailChannel } from "@/server/adapters/email";
import { getSmsChannel, normalisePhone } from "@/server/adapters/sms";
import { notificationRepository } from "@/server/repositories/notification.repository";
import { interviewRepository } from "@/server/repositories/interview.repository";
import { notifyUser } from "@/server/services/notification.service";

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
const reminderPayload = z.object({ interviewId: z.string(), label: z.enum(["24h", "1h"]) });

export const JOB_HANDLERS: Record<string, JobHandler> = {
  INTERVIEW_REMINDER: async (db, raw) => {
    const p = reminderPayload.parse(raw);
    const iv = await interviewRepository.findInterview(db, p.interviewId);
    if (!iv || iv.status !== "SCHEDULED") return;
    const when = iv.scheduledAt.toLocaleString("en-US", { timeZone: iv.timezone, dateStyle: "medium", timeStyle: "short" });
    const soon = p.label === "1h" ? "in about an hour" : "tomorrow";
    const contact = iv.interviewRequest.client.contacts[0];
    if (contact?.userId) await notifyUser(db, { userId: contact.userId, type: "INTERVIEW_REMINDER", title: `Interview ${soon}: ${iv.agentProfile.displayName}`, body: `${when} (${iv.timezone}).${iv.meetingLink ? ` Link: ${iv.meetingLink}` : ""}`, email: { to: contact.businessEmail }, dedupeKey: `REM:${iv.id}:${p.label}:client` });
    const phone = (await db.agentPrivateContact.findUnique({ where: { agentProfileId: iv.agentProfileId }, select: { phone: true } }))?.phone ?? null;
    await notifyUser(db, { userId: iv.agentProfile.userId, type: "INTERVIEW_REMINDER", title: `Interview ${soon} with ${iv.interviewRequest.client.companyName}`, body: `${when} (${iv.timezone}).${iv.meetingLink ? ` Link: ${iv.meetingLink}` : ""}`, email: { to: iv.agentProfile.user.email }, sms: { to: phone }, dedupeKey: `REM:${iv.id}:${p.label}:agent` });
  },

  SEND_SMS: async (db, raw) => {
    const p = z.object({ notificationId: z.string().optional(), to: z.string(), subject: z.string(), text: z.string() }).parse(raw);
    const to = normalisePhone(p.to);
    if (!to) return;
    const result = await getSmsChannel().send({ to, subject: p.subject, text: p.text });
    if (p.notificationId) await notificationRepository.setChannelStatus(db, p.notificationId, "sms", { sentAt: new Date().toISOString(), providerId: result.providerId ?? null });
  },

  SEND_EMAIL: async (db, raw) => {
    const p = sendEmailPayload.parse(raw);
    const result = await getEmailChannel().send({ to: p.to, subject: p.subject, text: p.text, html: p.html ?? undefined });
    if (p.notificationId) {
      await notificationRepository.setChannelStatus(db, p.notificationId, "email", { sentAt: new Date().toISOString(), providerId: result.providerId ?? null });
    }
  },
};
