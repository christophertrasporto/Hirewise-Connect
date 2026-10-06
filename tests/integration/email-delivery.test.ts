import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { requestEmailVerification, latestVerificationDelivery, verifyEmail, VERIFICATION_RESEND_COOLDOWN_SECONDS } from "@/server/services/auth.service";
import { registerAgent } from "@/server/services/agent.service";
import { sendEmailNow } from "@/server/jobs/mailer";
import { ConsoleEmailChannel, EmailDeliveryError, classifyEmailError, emailConfigProblem, setEmailChannelForTests, type NotificationChannel, type OutboundMessage } from "@/server/adapters/email";
import { RateLimitedError, resetRateLimits } from "@/server/auth/rate-limit";
import { toActionError } from "@/server/http/action-result";
import { resetEnvCache } from "@/server/env";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { sha256 } from "@/server/auth/crypto";

const db = testDb();
const meta = { ipAddress: "127.0.0.1", userAgent: "vitest" };

/** A provider that fails the way nodemailer does, so the classifier is exercised end to end. */
class FailingChannel implements NotificationChannel {
  readonly name = "email" as const;
  constructor(private err: unknown) {}
  async send(_m: OutboundMessage): Promise<{ providerId?: string }> {
    throw this.err;
  }
}
class AcceptingChannel implements NotificationChannel {
  readonly name = "email" as const;
  readonly sent: OutboundMessage[] = [];
  async send(m: OutboundMessage) {
    this.sent.push(m);
    return { providerId: `<msg-${this.sent.length}@provider>` };
  }
}

const ids = { user: "", email: "verify.me@t.example" };

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16";
  process.env.APP_URL = "http://localhost:3000";
  process.env.DEV_EXPOSE_LINKS = "true";
  resetEnvCache();
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const role = await db.role.findUniqueOrThrow({ where: { key: "AGENT" } });
  ids.user = (await db.user.create({ data: { email: ids.email, roleId: role.id } })).id;
});

beforeEach(async () => {
  resetRateLimits();
  await db.user.update({ where: { id: ids.user }, data: { emailVerifiedAt: null } });
});

afterEach(() => {
  resetRateLimits();
  setEmailChannelForTests(null);
});

afterAll(async () => {
  delete process.env.DEV_EXPOSE_LINKS;
  setEmailChannelForTests(null);
  await db.$disconnect();
});

describe("verification email delivery (sign-up flow steps 3 to 6)", () => {
  it("success: token issued, provider called in the request, job completed with the provider id, link works once", async () => {
    const channel = new AcceptingChannel();
    setEmailChannelForTests(channel);
    const r = await requestEmailVerification(db, { userId: ids.user, email: ids.email, ...meta });
    expect(r.sent).toBe(true);
    expect(r.providerId).toBe("<msg-1@provider>");
    expect(channel.sent[0].to).toBe(ids.email);
    expect(channel.sent[0].text).toContain("http://localhost:3000/api/auth/verify-email/");
    expect(r.devUrl).toMatch(/\/api\/auth\/verify-email\//);

    const job = await db.job.findFirstOrThrow({ where: { type: "SEND_EMAIL" }, orderBy: { createdAt: "desc" } });
    expect(job.status).toBe("COMPLETED");
    expect(job.attempts).toBe(1);
    const delivery = await latestVerificationDelivery(db, ids.email);
    expect(delivery?.status).toBe("sent");

    const token = r.devUrl!.split("/verify-email/")[1];
    expect(await db.authToken.count({ where: { kind: "EMAIL_VERIFY", tokenHash: sha256(token), usedAt: null } })).toBe(1);
    await verifyEmail(db, token);
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.user } })).emailVerifiedAt).not.toBeNull();
    await expect(verifyEmail(db, token)).rejects.toThrow(/invalid|already used/);

    // already verified: nothing is sent, no new token
    const again = await requestEmailVerification(db, { userId: ids.user, email: ids.email, ...meta });
    expect(again).toEqual({ sent: false, alreadyVerified: true });
    await db.user.update({ where: { id: ids.user }, data: { emailVerifiedAt: null } });
  });

  it("failure: the provider's real reason reaches the caller, the job keeps the error for retry, nothing generic", async () => {
    setEmailChannelForTests(new FailingChannel(Object.assign(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"), { code: "EAUTH", responseCode: 535 })));
    const err = await requestEmailVerification(db, { userId: ids.user, email: ids.email, ...meta }).catch((e) => e);
    expect(err).toBeInstanceOf(EmailDeliveryError);
    expect(err.reason).toBe("authentication");
    expect(err.message).toMatch(/Authentication with the email provider failed/);
    expect(toActionError(err).error).toBe(err.message);

    const delivery = await latestVerificationDelivery(db, ids.email);
    expect(delivery?.status).toBe("failed");
    expect(delivery?.error).toMatch(/Authentication/);
    const job = await db.job.findFirstOrThrow({ where: { type: "SEND_EMAIL" }, orderBy: { createdAt: "desc" } });
    expect(job.status).toBe("FAILED");
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now()); // scheduled for the worker to retry
  });

  it("classifies the common provider failures into actionable reasons", () => {
    const r = (e: object) => classifyEmailError(Object.assign(new Error((e as { message?: string }).message ?? "x"), e)).reason;
    expect(r({ code: "ECONNECTION", message: "connect ECONNREFUSED 1.2.3.4:587" })).toBe("unavailable");
    expect(r({ code: "ETIMEDOUT" })).toBe("unavailable");
    expect(r({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND smtp.example" })).toBe("unavailable");
    expect(r({ responseCode: 450, message: "450 4.7.1 try again later" })).toBe("rate_limited");
    expect(r({ responseCode: 550, response: "550 5.7.1 Sender address rejected: not verified" })).toBe("sender_not_verified");
    expect(r({ code: "EENVELOPE", message: "No recipients defined" })).toBe("invalid_recipient");
    expect(r({ responseCode: 553, response: "553 5.1.3 The recipient address is not a valid RFC-5321 address" })).toBe("invalid_recipient");
    expect(r({ message: "Missing credentials for PLAIN" })).toBe("configuration");
    expect(r({ message: "boom" })).toBe("provider_error");
    expect(classifyEmailError(new EmailDeliveryError("unavailable", "x")).reason).toBe("unavailable");
  });

  it("resend cooldown: 60 seconds between attempts, then at most 5 per hour, with the seconds in the message", async () => {
    setEmailChannelForTests(new AcceptingChannel());
    await requestEmailVerification(db, { userId: ids.user, email: ids.email, ...meta });
    const err = await requestEmailVerification(db, { userId: ids.user, email: ids.email, ...meta }).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.retryAfterSeconds).toBeGreaterThan(0);
    expect(err.retryAfterSeconds).toBeLessThanOrEqual(VERIFICATION_RESEND_COOLDOWN_SECONDS);
    const res = toActionError(err);
    expect(res.retryAfterSeconds).toBe(err.retryAfterSeconds);
    expect(res.error).toMatch(/seconds/);
    // the cooldown attempt did not issue a token or a job
    expect(await db.authToken.count({ where: { kind: "EMAIL_VERIFY", email: ids.email, usedAt: null } })).toBe(1);
  });

  it("registration survives a broken provider: account and session are created and the gate page can show the reason", async () => {
    setEmailChannelForTests(new FailingChannel(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })));
    const s = await registerAgent(db, { email: "new.talent@t.example", password: "Str0ngPassw0rd!", displayName: "New T.", fullName: "New Talent", phone: "", locationCity: "Cebu", locationCountry: "Philippines", timezone: "Asia/Manila", primaryRole: "VA", yearsExperience: 1 } as never, meta);
    expect(s.token).toBeTruthy();
    const u = await db.user.findUniqueOrThrow({ where: { email: "new.talent@t.example" } });
    expect(u.emailVerifiedAt).toBeNull();
    expect(await db.session.count({ where: { userId: u.id } })).toBe(1);
    const delivery = await latestVerificationDelivery(db, "new.talent@t.example");
    expect(delivery?.status).toBe("failed");
    expect(delivery?.error).toMatch(/Email provider unavailable/);
  });

  it("a production deployment on the console driver is reported as a configuration problem instead of pretending to send", async () => {
    const saved = { NODE_ENV: process.env.NODE_ENV, EMAIL_DRIVER: process.env.EMAIL_DRIVER, PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER, MEETING_PROVIDER: process.env.MEETING_PROVIDER };
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.EMAIL_DRIVER = "console";
    process.env.PAYMENT_PROVIDER = "manual";
    process.env.MEETING_PROVIDER = "none";
    resetEnvCache();
    try {
      const problem = emailConfigProblem();
      expect(problem?.reason).toBe("configuration");
      expect(problem?.message).toMatch(/EMAIL_DRIVER is 'console' in production/);
      setEmailChannelForTests(new ConsoleEmailChannel());
      const err = await sendEmailNow(db, { kind: "test", to: ids.email, subject: "s", text: "t" }).catch((e) => e);
      expect(err).toBeInstanceOf(EmailDeliveryError);
      expect(err.reason).toBe("configuration");
      // an invalid environment is also reported, naming only the variable
      process.env.PAYMENT_PROVIDER = "fake";
      resetEnvCache();
      const invalid = emailConfigProblem();
      expect(invalid?.message).toMatch(/environment failed validation/);
      expect(invalid?.message).toMatch(/PAYMENT_PROVIDER/);
    } finally {
      Object.assign(process.env, saved);
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
      resetEnvCache();
    }
  });
});
