import type { Actor } from "@/server/auth/actor";
import type { PermissionKey } from "./permissions";

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(
    message: string,
    readonly permission?: PermissionKey,
  ) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Throws unless the actor holds the permission. Every service function calls this
 * (or an ownership assertion) before touching data (INV-A1).
 */
export function authorize(actor: Actor, permission: PermissionKey): void {
  if (!actor.permissions.has(permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`, permission);
  }
}

/** Passes if the actor holds ANY of the listed permissions. */
export function authorizeAny(actor: Actor, permissions: readonly PermissionKey[]): void {
  if (!permissions.some((p) => actor.permissions.has(p))) {
    throw new ForbiddenError(`Missing one of: ${permissions.join(", ")}`);
  }
}

export function can(actor: Actor, permission: PermissionKey): boolean {
  return actor.permissions.has(permission);
}
