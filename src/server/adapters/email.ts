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

// ---------------------------------------------------------------------------
// Delivery diagnostics: turn provider failures into reasons a user or admin can act on.
// ---------------------------------------------------------------------------

export type EmailFailureReason = "configuration" | "unavailable" | "authentication" | "sender_not_verified" | "invalid_recipient" | "rate_limited" | "provider_error";

export class EmailDeliveryError extends Error {
  readonly status = 502;
  constructor(readonly reason: EmailFailureReason, message: string, readonly cause?: unknown) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

/** Map a nodemailer / SMTP error to a reason and a message without echoing credentials. */
export function classifyEmailError(err: unknown): EmailDeliveryError {
  if (err instanceof EmailDeliveryError) return err;
  const e = (err ?? {}) as { code?: string; responseCode?: number; response?: string; message?: string; command?: string };
  const code = String(e.code ?? "").toUpperCase();
  const rc = Number(e.responseCode ?? 0);
  const text = `${e.response ?? ""} ${e.message ?? ""}`.toLowerCase();
  if (code === "EAUTH" || rc === 535 || rc === 534 || /auth(entication)? (failed|unsuccessful)|invalid login|username and password not accepted/.test(text))
    return new EmailDeliveryError("authentication", "Authentication with the email provider failed. Check SMTP_USER and SMTP_PASS.", err);
  if (["ECONNECTION", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "ESOCKET", "EDNS", "ECONNRESET", "EHOSTUNREACH"].includes(code) || /connect(ion)? (timed out|refused)|getaddrinfo|greeting never received/.test(text))
    return new EmailDeliveryError("unavailable", "Email provider unavailable: could not reach the SMTP server (SMTP_HOST / SMTP_PORT).", err);
  if ([421, 450, 451, 452].includes(rc) || /rate limit|too many|try again later|throttl/.test(text))
    return new EmailDeliveryError("rate_limited", "The email provider is rate limiting us. Try again in a few minutes.", err);
  if (/sender|from address|not verified|unverified|domain not (verified|authenticated)|dmarc|spf/.test(text) && (rc === 550 || rc === 553 || rc === 554 || rc === 403 || rc === 0))
    return new EmailDeliveryError("sender_not_verified", "The sender address is not verified with the email provider (EMAIL_FROM).", err);
  if (code === "EENVELOPE" || [501, 550, 553].includes(rc) || /recipient|mailbox|address rejected|no such user|invalid address/.test(text))
    return new EmailDeliveryError("invalid_recipient", "The email address was rejected by the email provider.", err);
  if (/missing credentials|no transport|configuration/.test(text))
    return new EmailDeliveryError("configuration", "Email service configuration missing or invalid. Check EMAIL_DRIVER and the SMTP_* variables.", err);
  const detail = (e.message ?? String(err)).replace(/\s+/g, " ").slice(0, 160);
  return new EmailDeliveryError("provider_error", `Email provider error: ${detail}`, err);
}

/**
 * Why no email can leave this deployment, or null when a real provider is configured.
 * Only variable names appear in the message, never values.
 */
export function emailConfigProblem(): EmailDeliveryError | null {
  let driver: string;
  let nodeEnv: string;
  try {
    const env = getEnv();
    driver = env.EMAIL_DRIVER;
    nodeEnv = env.NODE_ENV;
  } catch (err) {
    const first = (err instanceof Error ? err.message : String(err)).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 2).join(" ");
    return new EmailDeliveryError("configuration", `Email service configuration missing: the server environment failed validation (${first}).`, err);
  }
  if (driver === "console" && nodeEnv === "production") {
    return new EmailDeliveryError("configuration", "Email service configuration missing: EMAIL_DRIVER is 'console' in production, so no email is actually sent. Set EMAIL_DRIVER=smtp with SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and EMAIL_FROM.");
  }
  return null;
}
