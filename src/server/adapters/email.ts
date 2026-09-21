import nodemailer from "nodemailer";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";

export type OutboundMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

/**
 * A delivery channel for notifications (Section 9). In-app is always written to
 * the Notification table; email goes through this interface. SMS and messaging
 * apps implement the same interface later.
 */
export interface NotificationChannel {
  readonly name: "email" | "sms" | "whatsapp";
  send(message: OutboundMessage): Promise<{ providerId?: string }>;
}

/** Logs instead of sending. Used in development without Mailpit and in tests. */
export class ConsoleEmailChannel implements NotificationChannel {
  readonly name = "email" as const;
  readonly sent: OutboundMessage[] = [];
  async send(message: OutboundMessage) {
    this.sent.push(message);
    logger.info({ to: message.to, subject: message.subject }, "email (console driver)");
    return {};
  }
}

/** SMTP via nodemailer: Mailpit locally, any SMTP relay in production. */
export class SmtpEmailChannel implements NotificationChannel {
  readonly name = "email" as const;
  private transport: ReturnType<typeof nodemailer.createTransport>;
  constructor(
    private from: string,
    opts: { host: string; port: number; secure: boolean; user?: string; pass?: string },
  ) {
    this.transport = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      auth: opts.user ? { user: opts.user, pass: opts.pass } : undefined,
    });
  }
  async send(message: OutboundMessage) {
    const info = await this.transport.sendMail({ from: this.from, ...message });
    return { providerId: info.messageId };
  }
}

let instance: NotificationChannel | null = null;

export function getEmailChannel(): NotificationChannel {
  if (instance) return instance;
  const env = getEnv();
  instance =
    env.EMAIL_DRIVER === "smtp"
      ? new SmtpEmailChannel(env.EMAIL_FROM, { host: env.SMTP_HOST!, port: env.SMTP_PORT, secure: env.SMTP_SECURE, user: env.SMTP_USER, pass: env.SMTP_PASS })
      : new ConsoleEmailChannel();
  return instance;
}

/** Test helper. */
export function setEmailChannelForTests(channel: NotificationChannel | null) {
  instance = channel;
}
