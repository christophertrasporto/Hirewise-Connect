import type { Actor } from "@/server/auth/actor";
import type { PermissionKey } from "./permissions";
import { ForbiddenError, NotFoundError } from "./authorize";

/**
 * Ownership checks for the two ownership-based roles (INV-P3).
 *
 * A CLIENT may act only on resources whose clientId equals the actor's clientId.
 * Staff pass when they hold the given "read_all"/"manage" permission.
 *
 * Cross-tenant access deliberately raises NotFoundError, not ForbiddenError,
 * so a client cannot probe for the existence of other clients' records.
 */
export function assertClientOwns(
  actor: Actor,
  resource: { clientId: string } | null | undefined,
  staffPermission?: PermissionKey,
): asserts resource is { clientId: string } {
  if (!resource) throw new NotFoundError();
  if (actor.role === "CLIENT") {
    if (!actor.clientId || actor.clientId !== resource.clientId) throw new NotFoundError();
    return;
  }
  if (staffPermission && actor.permissions.has(staffPermission)) return;
  if (actor.role === "SALES" && actor.salesAssignedClientIds?.includes(resource.clientId)) return;
  throw new ForbiddenError("Not the owner and no staff permission for this resource");
}

/** An AGENT may act only on their own profile and its children. */
export function assertAgentOwns(
  actor: Actor,
  resource: { agentProfileId: string } | null | undefined,
  staffPermission?: PermissionKey,
): asserts resource is { agentProfileId: string } {
  if (!resource) throw new NotFoundError();
  if (actor.role === "AGENT") {
    if (!actor.agentProfileId || actor.agentProfileId !== resource.agentProfileId) throw new NotFoundError();
    return;
  }
  if (staffPermission && actor.permissions.has(staffPermission)) return;
  throw new ForbiddenError("Not the owner and no staff permission for this resource");
}

/** A COACH may act only on courses they are assigned to (INV-P5). */
export function assertCoachAssigned(actor: Actor, courseId: string, staffPermission: PermissionKey = "course.manage"): void {
  if (actor.role === "COACH") {
    if (!actor.coachCourseIds?.includes(courseId)) throw new NotFoundError();
    return;
  }
  if (actor.permissions.has(staffPermission)) return;
  throw new ForbiddenError("Not assigned to this course");
}

/**
 * The clientId a repository query must be scoped by. For CLIENT actors this is
 * always their own id; for staff it is the requested id after a permission check.
 * Never derive tenancy from request input (INV-P3).
 */
export function scopedClientId(actor: Actor, requested: string | undefined, staffPermission: PermissionKey): string {
  if (actor.role === "CLIENT") {
    if (!actor.clientId) throw new ForbiddenError("Client actor without clientId");
    return actor.clientId;
  }
  if (!requested) throw new ForbiddenError("clientId required");
  if (actor.permissions.has(staffPermission)) return requested;
  if (actor.role === "SALES" && actor.salesAssignedClientIds?.includes(requested)) return requested;
  throw new ForbiddenError("No access to this client");
}
