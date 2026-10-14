import type { Db } from "@/server/db/types";
import { userRepository } from "@/server/repositories/user.repository";
import type { PermissionKey, RoleKey } from "@/server/policies/permissions";
import { PERMISSIONS, AGENCY_PORTAL_PERMISSIONS } from "@/server/policies/permissions";
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
  const profile = u.agentProfiles[0];
  if (role === "AGENT" && profile) actor.agentProfileId = profile.id;
  if (u.platformIdentity) actor.identityId = u.platformIdentity.id;
  if (role === "SALES") actor.salesAssignedClientIds = u.managedClients.map((c) => c.id);
  if (role === "COACH") actor.coachCourseIds = [...new Set([...u.coursesOwned.map((c) => c.id), ...u.courseCoachings.map((c) => c.courseId)])];

  // Agency A1: an Owner or Manager seat adds the portal capabilities and the tenant scope. Suspended and inactive
  // agencies keep the seat (for read access) but every write checks the status (requireActiveAgency).
  const seat = u.agencyUsers[0];
  if (seat) {
    actor.agency = { id: seat.agencyId, role: seat.role, status: seat.agency.status };
    const granted = seat.role === "OWNER" ? AGENCY_PORTAL_PERMISSIONS : AGENCY_PORTAL_PERMISSIONS.filter((k) => seat.permissions.includes(k));
    const merged = new Set<PermissionKey>(actor.permissions);
    for (const k of granted) merged.add(k);
    actor.permissions = merged;
  }

  return actor;
}
