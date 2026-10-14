import { IllegalTransitionError } from "@/server/state/agent-profile";

export type DuplicateFlagStatus = "OPEN" | "APPROVED_NEW_PROFILE" | "LINKED" | "REJECTED";
export type DuplicateFlagDecision = Exclude<DuplicateFlagStatus, "OPEN">;

/** A flag is decided once. Decisions are final; a new attempt raises a new flag. */
export const DUPLICATE_FLAG_TRANSITIONS: Record<DuplicateFlagStatus, readonly DuplicateFlagStatus[]> = {
  OPEN: ["APPROVED_NEW_PROFILE", "LINKED", "REJECTED"],
  APPROVED_NEW_PROFILE: [],
  LINKED: [],
  REJECTED: [],
};

export function assertFlagTransition(from: DuplicateFlagStatus, to: DuplicateFlagStatus): void {
  if (!DUPLICATE_FLAG_TRANSITIONS[from].includes(to)) throw new IllegalTransitionError(from, to);
}
