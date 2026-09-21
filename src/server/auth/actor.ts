import type { PermissionKey, RoleKey } from "@/server/policies/permissions";
import { ROLE_PERMISSIONS } from "@/server/policies/permissions";

/**
 * The authenticated principal passed to every service function (INV-A1).
 * Built once per request from the session; never from request input.
 */
export type Actor = {
  userId: string;
  role: RoleKey;
  permissions: ReadonlySet<PermissionKey>;
  /** Present for CLIENT. */
  clientId?: string;
  /** Present for AGENT. */
  agentProfileId?: string;
  /** Present for COACH: course ids the coach is assigned to. */
  coachCourseIds?: readonly string[];
  /** Present for SALES: client ids the rep manages. */
  salesAssignedClientIds?: readonly string[];
};

export type OverrideGrant = { permission: PermissionKey; expiresAt: Date | null };

/**
 * Resolve the effective permission set for a role plus any per-user overrides.
 * Expired overrides are ignored. Pure function; the DB lookup lives in the repository.
 */
export function resolvePermissions(role: RoleKey, overrides: readonly OverrideGrant[] = [], now = new Date()): Set<PermissionKey> {
  const set = new Set<PermissionKey>(ROLE_PERMISSIONS[role]);
  for (const o of overrides) {
    if (o.expiresAt && o.expiresAt.getTime() <= now.getTime()) continue;
    set.add(o.permission);
  }
  return set;
}

/** System actor for jobs and migrations. Has every permission; every use is audited with actorUserId = null. */
export function systemActor(): Actor {
  return {
    userId: "system",
    role: "SUPER_ADMIN",
    permissions: resolvePermissions("SUPER_ADMIN"),
  };
}

/** Test and seed helper. */
export function makeActor(role: RoleKey, partial: Partial<Omit<Actor, "role" | "permissions">> & { overrides?: OverrideGrant[] } = {}): Actor {
  const { overrides, ...rest } = partial;
  return {
    userId: rest.userId ?? `user_${role.toLowerCase()}`,
    role,
    permissions: resolvePermissions(role, overrides),
    ...rest,
  };
}
