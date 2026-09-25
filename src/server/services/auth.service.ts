import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { userRepository } from "@/server/repositories/user.repository";
import { tokenRepository } from "@/server/repositories/token.repository";
import { jobRepository } from "@/server/repositories/job.repository";
import { sessionRepository } from "@/server/repositories/session.repository";
import { hashPassword, verifyPassword, passwordSchema } from "@/server/auth/password";
import { randomToken, sha256 } from "@/server/auth/crypto";
import { createSession, destroySession, markSessionMfaPassed, type RequestMeta } from "@/server/auth/session";
import { generateMfaSecret, otpauthQrDataUrl, verifyTotp } from "@/server/auth/mfa";
import { rateLimit } from "@/server/auth/rate-limit";
import { MFA_REQUIRED_ROLES, type RoleKey } from "@/server/policies/permissions";
import { templates } from "@/server/notifications/templates";
import { audit } from "@/server/audit/audit";
import { getEnv } from "@/server/env";

export class AuthError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

const TTL = { MAGIC_LINK: 15 * 60_000, EMAIL_VERIFY: 24 * 60 * 60_000, PASSWORD_RESET: 60 * 60_000 } as const;

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.");

const GENERIC_LOGIN_ERROR = "Incorrect email or password.";

async function issueToken(db: PrismaClient, kind: keyof typeof TTL, email: string, userId: string | null, ttlMs: number = TTL[kind]): Promise<string> {
  await tokenRepository.invalidateAll(db, kind, email);
  const raw = randomToken(32);
  await tokenRepository.create(db, { kind, tokenHash: sha256(raw), userId, email, expiresAt: new Date(Date.now() + ttlMs) });
  return raw;
}

const INVITE_TTL = 7 * 24 * 60 * 60_000;

/**
 * Staff invitation: a set-password link that reuses the password-reset flow with a 7-day expiry.
 * Called by user-admin.service after the account row exists; the caller has already been authorized.
 */
export async function issueInviteLink(db: PrismaClient, email: string, userId: string, roleName: string): Promise<{ devUrl?: string }> {
  const raw = await issueToken(db, "PASSWORD_RESET", email, userId, INVITE_TTL);
  const url = `${getEnv().APP_URL}/reset-password/${raw}`;
  await enqueueEmail(db, email, templates.staffInvite(url, roleName));
  return { devUrl: devLink(url) };
}

async function enqueueEmail(db: PrismaClient, to: string, t: { subject: string; text: string; html: string }) {
  await jobRepository.enqueue(db, "SEND_EMAIL", { to, subject: t.subject, text: t.text, html: t.html });
}

/**
 * Development aid: with DEV_EXPOSE_LINKS=true (never in production) the emailed
 * URL is returned to the caller so a local tester can follow it without a mailbox.
 */
function devLink(url: string): string | undefined {
  return process.env.NODE_ENV !== "production" && process.env.DEV_EXPOSE_LINKS === "true" ? url : undefined;
}

// ---------------------------------------------------------------------------
// Password login
// ---------------------------------------------------------------------------

export async function loginWithPassword(db: PrismaClient, p: { email: string; password: string; remember: boolean } & RequestMeta) {
  const email = emailSchema.parse(p.email);
  rateLimit(`login:${p.ipAddress ?? "unknown"}`, 20, 15 * 60_000);
  rateLimit(`login:${email}`, 8, 15 * 60_000);

  const user = await userRepository.findByEmail(db, email);
  const ok = await verifyPassword(user?.passwordHash, p.password);
  if (!user || !ok) throw new AuthError(GENERIC_LOGIN_ERROR);
  if (user.status !== "ACTIVE") throw new AuthError("This account is suspended. Contact Hirewise.");

  const role = user.role.key as RoleKey;
  const mfaRequired = MFA_REQUIRED_ROLES.includes(role);
  const session = await createSession(db, { userId: user.id, mfaPassed: !mfaRequired, remember: p.remember, ipAddress: p.ipAddress, userAgent: p.userAgent });
  await userRepository.touchLogin(db, user.id);
  return { userId: user.id, role, ...session };
}

export async function logout(db: PrismaClient, token: string | undefined) {
  await destroySession(db, token);
}

// ---------------------------------------------------------------------------
// Magic link
// ---------------------------------------------------------------------------

export async function requestMagicLink(db: PrismaClient, p: { email: string } & RequestMeta): Promise<{ devUrl?: string }> {
  const email = emailSchema.parse(p.email);
  rateLimit(`magic:${p.ipAddress ?? "unknown"}`, 10, 15 * 60_000);
  rateLimit(`magic:${email}`, 3, 15 * 60_000);
  const user = await userRepository.findByEmail(db, email);
  // Always behave the same whether or not the account exists.
  if (!user || user.status !== "ACTIVE") return {};
  const raw = await issueToken(db, "MAGIC_LINK", email, user.id);
  const url = `${getEnv().APP_URL}/api/auth/magic/${raw}`;
  await enqueueEmail(db, email, templates.magicLink(url));
  return { devUrl: devLink(url) };
}

export async function consumeMagicLink(db: PrismaClient, p: { token: string } & RequestMeta) {
  const t = await tokenRepository.findUsable(db, "MAGIC_LINK", sha256(p.token));
  if (!t || !t.userId) throw new AuthError("This sign-in link is invalid or has expired.");
  const { count } = await tokenRepository.consume(db, t.id);
  if (count === 0) throw new AuthError("This sign-in link was already used.");
  const user = await userRepository.findForActor(db, t.userId);
  if (!user || user.status !== "ACTIVE") throw new AuthError("This account is not active.");
  // A magic link proves control of the mailbox.
  await userRepository.setEmailVerified(db, t.userId);
  const role = user.role.key as RoleKey;
  const mfaRequired = MFA_REQUIRED_ROLES.includes(role);
  const session = await createSession(db, { userId: t.userId, mfaPassed: !mfaRequired, remember: false, ipAddress: p.ipAddress, userAgent: p.userAgent });
  await userRepository.touchLogin(db, t.userId);
  return { userId: t.userId, role, ...session };
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export async function requestEmailVerification(db: PrismaClient, p: { userId: string; email: string } & RequestMeta): Promise<{ devUrl?: string }> {
  rateLimit(`verify:${p.userId}`, 5, 60 * 60_000);
  const raw = await issueToken(db, "EMAIL_VERIFY", p.email, p.userId);
  const url = `${getEnv().APP_URL}/api/auth/verify-email/${raw}`;
  await enqueueEmail(db, p.email, templates.verifyEmail(url));
  return { devUrl: devLink(url) };
}

export async function verifyEmail(db: PrismaClient, token: string): Promise<{ userId: string }> {
  const t = await tokenRepository.findUsable(db, "EMAIL_VERIFY", sha256(token));
  if (!t || !t.userId) throw new AuthError("This verification link is invalid or has expired.");
  const { count } = await tokenRepository.consume(db, t.id);
  if (count === 0) throw new AuthError("This verification link was already used.");
  await userRepository.setEmailVerified(db, t.userId);
  return { userId: t.userId };
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function requestPasswordReset(db: PrismaClient, p: { email: string } & RequestMeta): Promise<{ devUrl?: string }> {
  const email = emailSchema.parse(p.email);
  rateLimit(`reset:${p.ipAddress ?? "unknown"}`, 10, 15 * 60_000);
  rateLimit(`reset:${email}`, 3, 60 * 60_000);
  const user = await userRepository.findByEmail(db, email);
  if (!user || user.status !== "ACTIVE") return {};
  const raw = await issueToken(db, "PASSWORD_RESET", email, user.id);
  const url = `${getEnv().APP_URL}/reset-password/${raw}`;
  await enqueueEmail(db, email, templates.passwordReset(url));
  return { devUrl: devLink(url) };
}

export async function resetPassword(db: PrismaClient, p: { token: string; password: string }): Promise<void> {
  const password = passwordSchema.parse(p.password);
  const t = await tokenRepository.findUsable(db, "PASSWORD_RESET", sha256(p.token));
  if (!t || !t.userId) throw new AuthError("This reset link is invalid or has expired.");
  const { count } = await tokenRepository.consume(db, t.id);
  if (count === 0) throw new AuthError("This reset link was already used.");
  await userRepository.setPassword(db, t.userId, await hashPassword(password));
  // Every other session for this user is revoked when the password changes.
  await sessionRepository.deleteAllForUser(db, t.userId);
}

// ---------------------------------------------------------------------------
// MFA (TOTP) — required for SUPER_ADMIN and ADMIN
// ---------------------------------------------------------------------------

export async function beginMfaEnrollment(db: PrismaClient, actor: Actor, email: string) {
  const current = await userRepository.mfaSecret(db, actor.userId);
  if (current?.mfaEnabled) throw new AuthError("MFA is already enabled.");
  const { secretBase32, secretEnc } = generateMfaSecret();
  // Stored disabled until the first code is verified.
  await userRepository.setMfa(db, actor.userId, { mfaEnabled: false, mfaSecretEnc: secretEnc });
  return { secretBase32, qrDataUrl: await otpauthQrDataUrl(secretBase32, email) };
}

export async function completeMfaEnrollment(db: PrismaClient, actor: Actor, sessionId: string, code: string): Promise<void> {
  rateLimit(`mfa:${actor.userId}`, 10, 15 * 60_000);
  const current = await userRepository.mfaSecret(db, actor.userId);
  if (!current?.mfaSecretEnc) throw new AuthError("Start MFA setup first.");
  if (!verifyTotp(current.mfaSecretEnc, code)) throw new AuthError("That code is not valid. Check your authenticator app and try again.");
  await db.$transaction(async (tx) => {
    await userRepository.setMfa(tx, actor.userId, { mfaEnabled: true, mfaSecretEnc: current.mfaSecretEnc });
    await audit(tx, { actor, action: "MFA_ENROLLED", entityType: "User", entityId: actor.userId });
  });
  await markSessionMfaPassed(db, sessionId);
}

export async function verifyMfaForSession(db: PrismaClient, actor: Actor, sessionId: string, code: string): Promise<void> {
  rateLimit(`mfa:${actor.userId}`, 10, 15 * 60_000);
  const current = await userRepository.mfaSecret(db, actor.userId);
  if (!current?.mfaEnabled || !current.mfaSecretEnc) throw new AuthError("MFA is not enabled for this account.");
  if (!verifyTotp(current.mfaSecretEnc, code)) throw new AuthError("That code is not valid.");
  await markSessionMfaPassed(db, sessionId);
}
