import type { PrismaClient } from "@/server/db/types";
import { jobRepository, jobInlineRepository } from "@/server/repositories/job.repository";
import { classifyEmailError, emailConfigProblem, getEmailChannel, EmailDeliveryError } from "@/server/adapters/email";
import { logger } from "@/server/logger";

export type MailInput = { to: string; subject: string; text: string; html?: string; notificationId?: string; kind: string };
export type MailResult = { jobId: string; providerId: string | null };

/** Mask an address for logs: ab***@domain. */
export function maskEmail(email: string) {
  return email.replace(/^(.{2}).*(@.*)$/, "$1***$2");
}

/**
 * Send one transactional email in the request, through the same SEND_EMAIL job the worker uses.
 * The job row is the delivery log (attempts, lastError, timestamps). On success it is COMPLETED;
 * on failure it stays queued with the provider's error so the worker retries later, and the
 * caller receives an EmailDeliveryError whose message names the actual reason.
 */
export async function sendEmailNow(db: PrismaClient, mail: MailInput): Promise<MailResult> {
  const { kind, ...payload } = mail;
  const job = await jobRepository.enqueue(db, "SEND_EMAIL", { ...payload, kind });
  const log = logger.child({ jobId: job.id, kind, to: maskEmail(mail.to) });
  log.info("email: request queued");

  const problem = emailConfigProblem();
  if (problem) {
    await jobRepository.fail(db, job.id, problem.message, new Date(Date.now() + 10 * 60_000));
    log.error({ reason: problem.reason }, "email: delivery failed before contacting a provider");
    throw problem;
  }

  await jobInlineRepository.claimById(db, job.id);
  try {
    const result = await getEmailChannel().send({ to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    await jobRepository.complete(db, job.id);
    log.info({ providerId: result.providerId ?? null }, "email: provider accepted the message");
    return { jobId: job.id, providerId: result.providerId ?? null };
  } catch (err) {
    const failure = classifyEmailError(err);
    await jobRepository.fail(db, job.id, failure.message, new Date(Date.now() + 5 * 60_000));
    log.error({ reason: failure.reason, err: err instanceof Error ? { name: err.name, message: err.message, code: (err as { code?: string }).code } : err }, "email: provider rejected the message");
    throw failure;
  }
}

/** Same as sendEmailNow but never throws: for flows that must not reveal whether an address exists. */
export async function sendEmailQuietly(db: PrismaClient, mail: MailInput): Promise<MailResult | null> {
  try {
    return await sendEmailNow(db, mail);
  } catch (err) {
    if (!(err instanceof EmailDeliveryError)) logger.error({ err }, "email: unexpected failure");
    return null;
  }
}

export type DeliveryStatus = { status: "sent" | "failed" | "queued"; at: Date; error: string | null; attempts: number; providerAccepted: boolean };

/** Latest delivery record for one recipient and email kind, read from the job table. */
export async function latestDelivery(db: PrismaClient, to: string, kind: string): Promise<DeliveryStatus | null> {
  const job = await jobInlineRepository.latestForRecipient(db, "SEND_EMAIL", to);
  if (!job) return null;
  const payload = job.payload as { kind?: string } | null;
  if (payload?.kind && payload.kind !== kind) return null;
  const status = job.status === "COMPLETED" ? "sent" : job.status === "FAILED" ? "failed" : "queued";
  return { status, at: job.updatedAt, error: job.lastError, attempts: job.attempts, providerAccepted: status === "sent" };
}
