import { IllegalTransitionError } from "@/server/state/agent-profile";

export type MembershipStatus = "INVITED" | "PENDING_VERIFICATION" | "ACTIVE" | "EXIT_REQUESTED" | "REMOVAL_REQUESTED" | "ENDING" | "ENDED";

/** Statuses that hold a seat and count as "in this agency". */
export const OPEN_MEMBERSHIP_STATUSES: readonly MembershipStatus[] = ["INVITED", "PENDING_VERIFICATION", "ACTIVE", "EXIT_REQUESTED", "REMOVAL_REQUESTED", "ENDING"];

/**
 * v2 phase 2 uses INVITED → PENDING_VERIFICATION → ACTIVE and the exits to ENDED (expiry, admin override).
 * EXIT_REQUESTED, REMOVAL_REQUESTED, and ENDING are driven by the exit flows of phase 3.
 */
export const MEMBERSHIP_TRANSITIONS: Record<MembershipStatus, readonly MembershipStatus[]> = {
  INVITED: ["PENDING_VERIFICATION", "ACTIVE", "ENDED"],
  PENDING_VERIFICATION: ["ACTIVE", "ENDED"],
  ACTIVE: ["EXIT_REQUESTED", "REMOVAL_REQUESTED", "ENDING", "ENDED"],
  EXIT_REQUESTED: ["ACTIVE", "ENDING", "ENDED"],
  REMOVAL_REQUESTED: ["ACTIVE", "ENDING", "ENDED"],
  ENDING: ["ENDED"],
  ENDED: [],
};

export function assertMembershipTransition(from: MembershipStatus, to: MembershipStatus): void {
  if (!MEMBERSHIP_TRANSITIONS[from].includes(to)) throw new IllegalTransitionError(`membership ${from}`, to);
}

export function isOpenMembership(status: string): boolean {
  return (OPEN_MEMBERSHIP_STATUSES as readonly string[]).includes(status);
}
