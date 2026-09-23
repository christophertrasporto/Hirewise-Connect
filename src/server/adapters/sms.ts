import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import type { NotificationChannel, OutboundMessage } from "./email";

/**
 * SMS channel (Section 9: "SMS/WhatsApp reserved via the NotificationChannel interface").
 * Console driver locally and in tests; Twilio via its REST API in production. Messages are
 * short: the title plus a pointer back to the app, never the full body.
 */
export class ConsoleSmsChannel implements NotificationChannel {
  readonly name = "sms" as const;
  readonly sent: OutboundMessage[] = [];
  async send(message: OutboundMessage) {
    this.sent.push(message);
    logger.info({ to: message.to, subject: message.subject }, "sms (console driver)");
    return {};
  }
}

export class TwilioSmsChannel implements NotificationChannel {
  readonly name = "sms" as const;
  constructor(private accountSid: string, private authToken: string, private from: string) {}
  async send(message: OutboundMessage) {
    const body = new URLSearchParams({ To: message.to, From: this.from, Body: `${message.subject}\n${message.text}`.slice(0, 1600) });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (!res.ok) throw new Error(`Twilio send failed: ${res.status}`);
    const json = (await res.json()) as { sid?: string };
    return { providerId: json.sid };
  }
}

let instance: NotificationChannel | null = null;

export function getSmsChannel(): NotificationChannel {
  if (instance) return instance;
  const env = getEnv();
  instance = env.SMS_DRIVER === "twilio" ? new TwilioSmsChannel(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!, env.TWILIO_FROM!) : new ConsoleSmsChannel();
  return instance;
}

export function setSmsChannelForTests(channel: NotificationChannel | null) {
  instance = channel;
}

/** E.164-ish normalisation; returns null when the number cannot be dialled. */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (!/^\+?\d{8,15}$/.test(digits)) return null;
  return digits.startsWith("+") ? digits : `+${digits}`;
}
