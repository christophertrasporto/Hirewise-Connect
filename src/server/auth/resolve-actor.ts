import type { Db } from "@/server/db/types";
import { userRepository } from "@/server/repositories/user.repository";
import type { PermissionKey, RoleKey } from "@/server/policies/permissions";
import { PERMISSIONS } from "@/server/policies/permissions";
import { resolvePermissions, type Actor } from "./actor";

export class ActorUnavailableError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "ActorUnavailableError";
  }
}

/**
 * Build the Actor for an authenticated user id. Called once per request by the
 * session layer (Phase 1). Suspended or deleted users get no actor at all.
 */
export async function resolveActor(db: Db, userId: string): Promise<Actor> {
  const u = await userRepository.findForActor(db, userId);
  if (!u) throw new ActorUnavailableError("User not found");
  if (u.status !== "ACTIVE") throw new ActorUnavailableError(`User is ${u.status}`);

  const overrides = u.permissionOverrides
    .filter((o) => o.permission.key in PERMISSIONS)
    .map((o) => ({ permission: o.permission.key as PermissionKey, expiresAt: o.expiresAt }));

  const role = u.role.key as RoleKey;
  const actor: Actor = { userId: u.id, role, permissions: resolvePermissions(role, overrides) };

  if (role === "CLIENT" && u.clientContact) actor.clientId = u.clientContact.clientId;
  if (role === "AGENT" && u.agentProfile) actor.agentProfileId = u.agentProfile.id;
  if (role === "SALES") actor.salesAssignedClientIds = u.managedClients.map((c) => c.id);
  // coachCourseIds is populated in Phase 3 when courses exist.

  return actor;
}
