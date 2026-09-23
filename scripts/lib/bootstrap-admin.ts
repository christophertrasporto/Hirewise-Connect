import { randomBytes } from "node:crypto";
import { z } from "zod";
import { hashPassword, passwordSchema } from "@/server/auth/password";
import type { PrismaClient } from "@/server/db/types";

/**
 * First-account bootstrap for a fresh environment (launch checklist, go-live step 3).
 * Creates or promotes one SUPER_ADMIN with a verified email. It runs outside the service layer
 * because there is no actor yet; it still writes the USER_CREATED audit row.
 * Requires the foundation seed (roles) to have run first.
 */
export type BootstrapAdminInput = {
  email: string;
  /** Plain password; validated against the app's password policy. Generate one with generateBootstrapPassword(). */
  password: string;
  /** Overwrite the password of an existing account. Off by default so a typo cannot lock out a real admin. */
  resetPassword?: boolean;
};

export type BootstrapAdminResult = { userId: string; email: string; created: boolean; passwordReset: boolean };

export class BootstrapError extends Error {}

const emailSchema = z.string().trim().toLowerCase().email();

/** 20 URL-safe characters that satisfy passwordSchema (mixed lower case with upper case or digits). */
export function generateBootstrapPassword(): string {
  for (;;) {
    const candidate = randomBytes(15).toString("base64url");
    if (passwordSchema.safeParse(candidate).success) return candidate;
  }
}

export async function bootstrapSuperAdmin(db: PrismaClient, input: BootstrapAdminInput): Promise<BootstrapAdminResult> {
  const email = emailSchema.parse(input.email);
  const password = passwordSchema.parse(input.password);

  const role = await db.role.findUnique({ where: { key: "SUPER_ADMIN" } });
  if (!role) throw new BootstrapError("SUPER_ADMIN role not found. Run `npm run db:seed:foundation` against this database first.");

  const existing = await db.user.findUnique({ where: { email } });
  if (existing?.passwordHash && !input.resetPassword) {
    throw new BootstrapError(`${email} already has a password. Re-run with --reset-password to replace it, or sign in with the existing one.`);
  }

  const passwordHash = await hashPassword(password);
  return db.$transaction(async (tx) => {
    const user = existing
      ? await tx.user.update({ where: { id: existing.id }, data: { roleId: role.id, passwordHash, status: "ACTIVE", emailVerifiedAt: existing.emailVerifiedAt ?? new Date() } })
      : await tx.user.create({ data: { email, roleId: role.id, passwordHash, status: "ACTIVE", emailVerifiedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        actorUserId: user.id,
        actorRole: "SUPER_ADMIN",
        action: "USER_CREATED",
        entityType: "User",
        entityId: user.id,
        previousValue: existing ? { roleId: existing.roleId, hadPassword: !!existing.passwordHash } : undefined,
        newValue: { email, role: "SUPER_ADMIN", source: "bootstrap-admin", passwordReset: !!existing?.passwordHash },
        reason: "bootstrap",
      },
    });
    return { userId: user.id, email, created: !existing, passwordReset: !!existing?.passwordHash };
  });
}
