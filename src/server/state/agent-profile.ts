import type { Actor } from "@/server/auth/actor";
import type { PermissionKey } from "@/server/policies/permissions";
import { ForbiddenError } from "@/server/policies/authorize";

/**
 * AgentProfile.status transition table — MASTER_PROMPT.md Section 5.1.
 * `permission: "OWNER"` means the agent themselves; anything else is a catalog permission.
 */
export type AgentProfileStatus = "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REVISION_REQUIRED" | "REJECTED" | "HIDDEN" | "SUSPENDED";

type Transition = {
  from: AgentProfileStatus;
  to: AgentProfileStatus;
  permission: PermissionKey | "OWNER";
  requiresReason?: boolean;
};

export const AGENT_PROFILE_TRANSITIONS: readonly Transition[] = [
  { from: "DRAFT", to: "SUBMITTED", permission: "OWNER" },
  { from: "REVISION_REQUIRED", to: "SUBMITTED", permission: "OWNER" },
  { from: "SUBMITTED", to: "UNDER_REVIEW", permission: "agent.review" },
  { from: "UNDER_REVIEW", to: "APPROVED", permission: "agent.approve" },
  { from: "UNDER_REVIEW", to: "REVISION_REQUIRED", permission: "agent.review", requiresReason: true },
  { from: "UNDER_REVIEW", to: "REJECTED", permission: "agent.approve", requiresReason: true },
  { from: "APPROVED", to: "HIDDEN", permission: "agent.hide" },
  { from: "HIDDEN", to: "APPROVED", permission: "agent.hide" },
  { from: "APPROVED", to: "SUSPENDED", permission: "agent.suspend", requiresReason: true },
  { from: "SUSPENDED", to: "APPROVED", permission: "agent.suspend", requiresReason: true },
];

export class IllegalTransitionError extends Error {
  readonly status = 409;
  constructor(from: string, to: string) {
    super(`Cannot move agent profile from ${from} to ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function findTransition(from: AgentProfileStatus, to: AgentProfileStatus): Transition {
  const t = AGENT_PROFILE_TRANSITIONS.find((x) => x.from === from && x.to === to);
  if (!t) throw new IllegalTransitionError(from, to);
  return t;
}

/** Throws unless this actor may perform this transition on this profile. */
export function assertTransitionAllowed(actor: Actor, agentProfileId: string, from: AgentProfileStatus, to: AgentProfileStatus, reason?: string): Transition {
  const t = findTransition(from, to);
  if (t.permission === "OWNER") {
    if (actor.role !== "AGENT" || actor.agentProfileId !== agentProfileId) throw new ForbiddenError("Only the profile owner can do this");
  } else if (!actor.permissions.has(t.permission)) {
    throw new ForbiddenError(`Missing permission: ${t.permission}`, t.permission);
  }
  if (t.requiresReason && !reason?.trim()) throw new Error(`A reason is required to move to ${to}`);
  return t;
}

/** Client-visible iff APPROVED (Section 5.1). Availability filtering is applied separately. */
export function isClientVisible(status: AgentProfileStatus): boolean {
  return status === "APPROVED";
}
