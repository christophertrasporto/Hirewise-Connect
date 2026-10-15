import { IllegalTransitionError } from "@/server/state/agent-profile";

export type ExitStatus = "PENDING_AGENCY" | "PENDING_ADMIN" | "APPROVED" | "DECLINED" | "CANCELLED" | "COMPLETED";

/** Statuses in which a request still blocks a second one and keeps the membership in its requested state. */
export const OPEN_EXIT_STATUSES: readonly ExitStatus[] = ["PENDING_AGENCY", "PENDING_ADMIN", "APPROVED"];

/**
 * Request to Leave: agent → agency (owner review) → Hirewise (when required or escalated) → approved → completed on
 * the effective date. Remove Agent: agency → Hirewise (when required) → approved → completed. Declines and
 * cancellations return the membership to ACTIVE.
 */
export const EXIT_TRANSITIONS: Record<ExitStatus, readonly ExitStatus[]> = {
  PENDING_AGENCY: ["PENDING_ADMIN", "APPROVED", "DECLINED", "CANCELLED"],
  PENDING_ADMIN: ["APPROVED", "DECLINED", "CANCELLED"],
  APPROVED: ["COMPLETED"],
  DECLINED: [],
  CANCELLED: [],
  COMPLETED: [],
};

export function assertExitTransition(from: ExitStatus, to: ExitStatus): void {
  if (!EXIT_TRANSITIONS[from].includes(to)) throw new IllegalTransitionError(`exit request ${from}`, to);
}
