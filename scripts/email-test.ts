import "dotenv/config";
import nodemailer from "nodemailer";
import { classifyEmailError } from "@/server/adapters/email";

/**
 * Check the configured email provider end to end without the app:
 *   npm run email:test -- --to you@yourdomain.com
 * Reads EMAIL_DRIVER, EMAIL_FROM, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS from .env,
 * connects, authenticates, sends one message, and prints the provider response or the classified reason.
 * Values are never printed; only variable names and the host/port.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const to = arg("--to");
  if (!to) throw new Error("Usage: npm run email:test -- --to <address>");
  const env = process.env;
  const summary = {
    EMAIL_DRIVER: env.EMAIL_DRIVER ?? "(unset → console)",
    EMAIL_FROM: env.EMAIL_FROM ? "set" : "unset",
    SMTP_HOST: env.SMTP_HOST ?? "unset",
    SMTP_PORT: env.SMTP_PORT ?? "unset (1025)",
    SMTP_SECURE: env.SMTP_SECURE ?? "unset (false)",
    SMTP_USER: env.SMTP_USER ? "set" : "unset",
    SMTP_PASS: env.SMTP_PASS ? "set" : "unset",
  };
  console.log("Email configuration:", JSON.stringify(summary));
  if (env.EMAIL_DRIVER !== "smtp") {
    console.log("EMAIL_DRIVER is not 'smtp': the app would log the email instead of sending it. Nothing to test.");
    process.exit(2);
  }
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT ?? 587),
    secure: String(env.SMTP_SECURE ?? "false") === "true",
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  const started = Date.now();
  try {
    await transport.verify();
    console.log(`Step 1 OK: connected and authenticated with ${env.SMTP_HOST}:${env.SMTP_PORT ?? 587} in ${Date.now() - started} ms`);
  } catch (err) {
    const c = classifyEmailError(err);
    console.log(`Step 1 FAILED (${c.reason}): ${c.message}`);
    process.exit(1);
  }
  try {
    const info = await transport.sendMail({
      from: env.EMAIL_FROM,
      to,
      subject: "Hirewise Connect email test",
      text: `This is a test message from Hirewise Connect sent at ${new Date().toISOString()}. If you can read this, SMTP delivery works.`,
    });
    console.log(`Step 2 OK: provider accepted the message. id=${info.messageId} accepted=${JSON.stringify(info.accepted)} rejected=${JSON.stringify(info.rejected)} response=${String(info.response).slice(0, 120)}`);
    console.log(`Check the inbox (and spam folder) of ${to}.`);
  } catch (err) {
    const c = classifyEmailError(err);
    console.log(`Step 2 FAILED (${c.reason}): ${c.message}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
