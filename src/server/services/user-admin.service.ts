import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_NAMES, ALL_PERMISSION_KEYS, type PermissionKey, type RoleKey, type StaffRoleKey } from "@/server/policies/permissions";
import { resolvePermissions } from "@/server/auth/actor";
import { userRepository } from "@/server/repositories/user.repository";
import { sessionRepository } from "@/server/repositories/session.repository";
import { audit } from "@/server/audit/audit";
import { issueInviteLink, emailSchema } from "./auth.service";

/**
 * User administration (MASTER_PROMPT Section 2 and Section 7).
 *   user.manage  (Admin, Super Admin): invite staff, suspend and reinstate, read a user's access.
 *   rbac.manage  (Super Admin only):   change a user's role, grant and revoke permission overrides,
 *                                      and assign the SUPER_ADMIN role at all.
 * Agents and Clients have no catalog permissions (ownership-based), so their role is never changed here.
 */
export const STAFF_ROLES = ["SUPER_ADMIN", "ADMIN", "SALES", "RECRUITER", "COACH", "OPERATIONS"] as const satisfies readonly StaffRoleKey[];

const isStaff = (role: string): role is StaffRoleKey => (STAFF_ROLES as readonly string[]).includes(role);

export const inviteStaffSchema = z.object({
  email: emailSchema,
  role: z.enum(STAFF_ROLES),
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});
export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

export const changeRoleSchema = z.object({
  userId: z.string().trim().min(1),
  role: z.enum(STAFF_ROLES),
  reason: z.string().trim().min(3, "Give a reason; it is written to the audit log.").max(500),
});

export const grantOverrideSchema = z.object({
  userId: z.string().trim().min(1),
  permission: z.enum(ALL_PERMISSION_KEYS as [PermissionKey, ...PermissionKey[]]),
  reason: z.string().trim().min(3, "Give a reason; it is written to the audit log.").max(500),
  /** ISO date (YYYY-MM-DD) or empty for no expiry. */
  expiresAt: z.string().trim().optional().or(z.literal("")),
});

async function loadUser(db: PrismaClient, userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, include: { role: { select: { key: true } } } });
  if (!u || u.deletedAt) throw new NotFoundError();
  return u;
}

/** Create a staff account with no password and email a set-password link (valid 7 days). */
export async function inviteStaffUser(db: PrismaClient, actor: Actor, raw: InviteStaffInput): Promise<{ userId: string; devUrl?: string }> {
  authorize(actor, "user.manage");
  const input = inviteStaffSchema.parse(raw);
  if (input.role === "SUPER_ADMIN") authorize(actor, "rbac.manage");
  if (await userRepository.findByEmail(db, input.email)) throw new Error("An account with that email already exists.");
  const role = await userRepository.roleIdByKey(db, input.role);
  const user = await db.$transaction(async (tx) => {
    const u = await userRepository.create(tx, { email: input.email, passwordHash: null, roleId: role.id, emailVerifiedAt: new Date() });
    await audit(tx, { actor, action: "USER_CREATED", entityType: "User", entityId: u.id, newValue: { email: input.email, role: input.role, source: "staff-invite" }, reason: input.reason || undefined });
    return u;
  });
  const { devUrl } = await issueInviteLink(db, input.email, user.id, ROLE_NAMES[input.role].name);
  return { userId: user.id, devUrl };
}

/** Re-send the set-password link to a staff account that never signed in or lost access. */
export async function resendStaffInvite(db: PrismaClient, actor: Actor, userId: string): Promise<{ devUrl?: string }> {
  authorize(actor, "user.manage");
  const u = await loadUser(db, userId);
  if (!isStaff(u.role.key)) throw new Error("Only staff accounts receive invitation links. Talent and clients use Forgot password.");
  if (u.status !== "ACTIVE") throw new Error("Reinstate the account before sending a new link.");
  return issueInviteLink(db, u.email, u.id, ROLE_NAMES[u.role.key as RoleKey].name);
}

/** Super Admin moves a staff account to another staff role. Sessions are revoked so the new role applies at next sign-in. */
export async function changeUserRole(db: PrismaClient, actor: Actor, raw: z.infer<typeof changeRoleSchema>) {
  authorize(actor, "rbac.manage");
  const input = changeRoleSchema.parse(raw);
  if (input.userId === actor.userId) throw new Error("You cannot change your own role. Ask another Super Admin.");
  const u = await loadUser(db, input.userId);
  const from = u.role.key as RoleKey;
  if (!isStaff(from)) throw new Error("Talent and client accounts keep their role; their access is based on what they own. Invite a separate staff account instead.");
  if (from === input.role) return;
  if (from === "SUPER_ADMIN") {
    const remaining = await db.user.count({ where: { role: { key: "SUPER_ADMIN" }, status: "ACTIVE", deletedAt: null, id: { not: u.id } } });
    if (remaining === 0) throw new Error("This is the only active Super Admin. Promote someone else first.");
  }
  const role = await userRepository.roleIdByKey(db, input.role);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { roleId: role.id } });
    await sessionRepository.deleteAllForUser(tx, u.id);
    await audit(tx, { actor, action: "USER_ROLE_CHANGED", entityType: "User", entityId: u.id, previousValue: { role: from }, newValue: { role: input.role }, reason: input.reason });
  });
}

/** Super Admin grants one catalog permission beyond the role, optionally until a date. Re-granting updates the reason and expiry. */
export async function grantPermissionOverride(db: PrismaClient, actor: Actor, raw: z.infer<typeof grantOverrideSchema>) {
  authorize(actor, "rbac.manage");
  const input = grantOverrideSchema.parse(raw);
  const u = await loadUser(db, input.userId);
  if (!isStaff(u.role.key)) throw new Error("Talent and client accounts cannot hold catalog permissions.");
  let expiresAt: Date | null = null;
  if (input.expiresAt) {
    expiresAt = new Date(`${input.expiresAt}T23:59:59.999Z`);
    if (Number.isNaN(expiresAt.getTime())) throw new Error("Enter the expiry as YYYY-MM-DD.");
    if (expiresAt.getTime() <= Date.now()) throw new Error("The expiry must be in the future.");
  }
  if (ROLE_PERMISSIONS[u.role.key as RoleKey].includes(input.permission)) throw new Error(`${ROLE_NAMES[u.role.key as RoleKey].name} already includes ${input.permission}.`);
  const permission = await db.permission.findUnique({ where: { key: input.permission } });
  if (!permission) throw new Error("Permission catalog is not seeded. Run npm run db:seed:foundation.");
  await db.$transaction(async (tx) => {
    const row = await tx.userPermissionOverride.upsert({
      where: { userId_permissionId: { userId: u.id, permissionId: permission.id } },
      create: { userId: u.id, permissionId: permission.id, grantedById: actor.userId, reason: input.reason, expiresAt },
      update: { grantedById: actor.userId, reason: input.reason, expiresAt },
    });
    await audit(tx, { actor, action: "PERMISSION_OVERRIDE_GRANTED", entityType: "UserPermissionOverride", entityId: row.id, newValue: { userId: u.id, permission: input.permission, expiresAt }, reason: input.reason });
  });
}

export async function revokePermissionOverride(db: PrismaClient, actor: Actor, overrideId: string, reason: string) {
  authorize(actor, "rbac.manage");
  if (!reason.trim()) throw new Error("Give a reason; it is written to the audit log.");
  const row = await db.userPermissionOverride.findUnique({ where: { id: overrideId }, include: { permission: { select: { key: true } } } });
  if (!row) throw new NotFoundError();
  await db.$transaction(async (tx) => {
    await tx.userPermissionOverride.delete({ where: { id: row.id } });
    await audit(tx, { actor, action: "PERMISSION_OVERRIDE_REVOKED", entityType: "UserPermissionOverride", entityId: row.id, previousValue: { userId: row.userId, permission: row.permission.key }, reason: reason.trim() });
  });
}

export type PermissionGroup = { group: string; permissions: Array<{ key: PermissionKey; description: string }> };

/** The catalog grouped for display, in catalog order. */
export function permissionGroups(): PermissionGroup[] {
  const groups = new Map<string, PermissionGroup>();
  for (const key of ALL_PERMISSION_KEYS) {
    const meta = PERMISSIONS[key];
    if (!groups.has(meta.group)) groups.set(meta.group, { group: meta.group, permissions: [] });
    groups.get(meta.group)!.permissions.push({ key, description: meta.description });
  }
  return [...groups.values()];
}

/** Role × permission matrix for the access page. Pure; the catalog file is the source of truth. */
export function accessMatrix() {
  return {
    roles: STAFF_ROLES.map((key) => ({ key, name: ROLE_NAMES[key].name, description: ROLE_NAMES[key].description, count: ROLE_PERMISSIONS[key].length })),
    groups: permissionGroups().map((g) => ({ ...g, permissions: g.permissions.map((p) => ({ ...p, roles: STAFF_ROLES.filter((r) => ROLE_PERMISSIONS[r].includes(p.key)) })) })),
    ownershipRoles: (["AGENT", "CLIENT"] as const).map((key) => ({ key, name: ROLE_NAMES[key].name, description: ROLE_NAMES[key].description })),
  };
}

/** One user's role, overrides, and the effective permission set. */
export async function getUserAccess(db: PrismaClient, actor: Actor, userId: string) {
  authorize(actor, "user.manage");
  const u = await db.user.findUnique({
    where: { id: userId },
    include: {
      role: { select: { key: true } },
      permissionOverrides: { include: { permission: { select: { key: true } }, grantedBy: { select: { email: true } } }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!u || u.deletedAt) throw new NotFoundError();
  const role = u.role.key as RoleKey;
  const now = new Date();
  const overrides = u.permissionOverrides.map((o) => ({ id: o.id, permission: o.permission.key as PermissionKey, reason: o.reason, grantedBy: o.grantedBy.email, grantedAt: o.createdAt, expiresAt: o.expiresAt, expired: !!o.expiresAt && o.expiresAt.getTime() <= now.getTime() }));
  const effective = resolvePermissions(role, u.permissionOverrides.map((o) => ({ permission: o.permission.key as PermissionKey, expiresAt: o.expiresAt })), now);
  return {
    id: u.id,
    email: u.email,
    status: u.status,
    role,
    roleName: ROLE_NAMES[role].name,
    isStaff: isStaff(role),
    hasPassword: !!u.passwordHash,
    mfaEnabled: u.mfaEnabled,
    lastLoginAt: u.lastLoginAt,
    rolePermissions: [...ROLE_PERMISSIONS[role]],
    overrides,
    effective: [...effective],
    grantable: ALL_PERMISSION_KEYS.filter((k) => !ROLE_PERMISSIONS[role].includes(k)),
  };
}
