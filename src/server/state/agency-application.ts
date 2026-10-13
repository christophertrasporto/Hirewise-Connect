import type { Actor } from "@/server/auth/actor";
import type { PermissionKey } from "@/server/policies/permissions";
import { ForbiddenError } from "@/server/policies/authorize";
import { IllegalTransitionError } from "./agent-profile";

/**
 * AgencyApplication.status transition table (Agency A1).
 * `permission: "APPLICANT"` means the applicant themselves; anything else is a catalog permission.
 */
export type AgencyApplicationStatus = "SUBMITTED" | "UNDER_REVIEW" | "NEEDS_MORE_INFO" | "APPROVED" | "REJECTED" | "WITHDRAWN";

type Transition = { from: AgencyApplicationStatus; to: AgencyApplicationStatus; permission: PermissionKey | "APPLICANT"; requiresReason?: boolean };

export const AGENCY_APPLICATION_TRANSITIONS: readonly Transition[] = [
  { from: "SUBMITTED", to: "UNDER_REVIEW", permission: "agency.review" },
  { from: "SUBMITTED", to: "NEEDS_MORE_INFO", permission: "agency.review", requiresReason: true },
  { from: "SUBMITTED", to: "APPROVED", permission: "agency.review" },
  { from: "SUBMITTED", to: "REJECTED", permission: "agency.review", requiresReason: true },
  { from: "SUBMITTED", to: "WITHDRAWN", permission: "APPLICANT" },
  { from: "UNDER_REVIEW", to: "NEEDS_MORE_INFO", permission: "agency.review", requiresReason: true },
  { from: "UNDER_REVIEW", to: "APPROVED", permission: "agency.review" },
  { from: "UNDER_REVIEW", to: "REJECTED", permission: "agency.review", requiresReason: true },
  { from: "UNDER_REVIEW", to: "WITHDRAWN", permission: "APPLICANT" },
  { from: "NEEDS_MORE_INFO", to: "SUBMITTED", permission: "APPLICANT" },
  { from: "NEEDS_MORE_INFO", to: "WITHDRAWN", permission: "APPLICANT" },
  { from: "NEEDS_MORE_INFO", to: "REJECTED", permission: "agency.review", requiresReason: true },
];

/** Statuses in which the applicant may still edit the form. */
export const EDITABLE_STATUSES: readonly AgencyApplicationStatus[] = ["SUBMITTED", "NEEDS_MORE_INFO"];
/** Statuses that count as "an application in flight": one per user at a time. */
export const OPEN_STATUSES: readonly AgencyApplicationStatus[] = ["SUBMITTED", "UNDER_REVIEW", "NEEDS_MORE_INFO"];

export function findApplicationTransition(from: AgencyApplicationStatus, to: AgencyApplicationStatus): Transition {
  const t = AGENCY_APPLICATION_TRANSITIONS.find((x) => x.from === from && x.to === to);
  if (!t) throw new IllegalTransitionError(from, to);
  return t;
}

/** Throws unless this actor may move this application from `from` to `to`. */
export function assertApplicationTransition(actor: Actor, applicantUserId: string, from: AgencyApplicationStatus, to: AgencyApplicationStatus, reason?: string): Transition {
  const t = findApplicationTransition(from, to);
  if (t.permission === "APPLICANT") {
    if (actor.userId !== applicantUserId) throw new ForbiddenError("Only the applicant can do this");
  } else if (!actor.permissions.has(t.permission)) {
    throw new ForbiddenError(`Missing permission ${t.permission}`);
  }
  if (t.requiresReason && !reason?.trim()) throw new ForbiddenError(`A reason is required to move to ${to}`);
  return t;
}

/** Agency.status transitions: all need agency.manage and a reason. */
export type AgencyStatus = "ACTIVE" | "SUSPENDED" | "INACTIVE";
export const AGENCY_STATUS_TRANSITIONS: ReadonlyArray<{ from: AgencyStatus; to: AgencyStatus }> = [
  { from: "ACTIVE", to: "SUSPENDED" },
  { from: "SUSPENDED", to: "ACTIVE" },
  { from: "ACTIVE", to: "INACTIVE" },
  { from: "SUSPENDED", to: "INACTIVE" },
  { from: "INACTIVE", to: "ACTIVE" },
];

export function assertAgencyStatusTransition(actor: Actor, from: AgencyStatus, to: AgencyStatus, reason: string | undefined): void {
  if (!AGENCY_STATUS_TRANSITIONS.some((t) => t.from === from && t.to === to)) throw new IllegalTransitionError(from, to);
  if (!actor.permissions.has("agency.manage")) throw new ForbiddenError("Missing permission agency.manage");
  if (!reason?.trim()) throw new ForbiddenError(`A reason is required to move an agency to ${to}`);
}
