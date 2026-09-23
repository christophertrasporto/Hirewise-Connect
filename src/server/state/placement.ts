import type { Actor } from "@/server/auth/actor";
import type { PermissionKey } from "@/server/policies/permissions";
import { ForbiddenError } from "@/server/policies/authorize";

/** Placement.status transitions — MASTER_PROMPT.md Section 5.5. Guards live in placement.service. */
export type PlacementStatus = "PENDING" | "INTERVIEWING" | "SELECTED" | "AWAITING_AGREEMENT" | "AWAITING_DEPOSIT" | "DEPLOYMENT_PREP" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";

type Transition = { from: PlacementStatus; to: PlacementStatus; by: PermissionKey | "CLIENT_OWNER" | "SYSTEM"; requiresReason?: boolean };

const NON_TERMINAL: PlacementStatus[] = ["PENDING", "INTERVIEWING", "SELECTED", "AWAITING_AGREEMENT", "AWAITING_DEPOSIT", "DEPLOYMENT_PREP", "ACTIVE", "PAUSED"];

export const PLACEMENT_TRANSITIONS: readonly Transition[] = [
  { from: "PENDING", to: "INTERVIEWING", by: "SYSTEM" },
  { from: "INTERVIEWING", to: "SELECTED", by: "SYSTEM" },
  // "Hirewise Approval": needs a PUBLISHED ClientBillingRate snapshot (checked in the service).
  { from: "SELECTED", to: "AWAITING_AGREEMENT", by: "placement.approve" },
  // Client click-accepts the service agreement, or staff record a signed upload.
  { from: "AWAITING_AGREEMENT", to: "AWAITING_DEPOSIT", by: "CLIENT_OWNER" },
  { from: "AWAITING_AGREEMENT", to: "AWAITING_DEPOSIT", by: "placement.manage" },
  // Deposit PAID or WAIVED moves the placement on; never a user action by itself (INV-C5).
  { from: "AWAITING_DEPOSIT", to: "DEPLOYMENT_PREP", by: "SYSTEM" },
  { from: "DEPLOYMENT_PREP", to: "ACTIVE", by: "placement.activate" },
  { from: "ACTIVE", to: "PAUSED", by: "placement.manage", requiresReason: true },
  { from: "PAUSED", to: "ACTIVE", by: "placement.manage" },
  { from: "ACTIVE", to: "COMPLETED", by: "placement.manage", requiresReason: true },
  { from: "PAUSED", to: "COMPLETED", by: "placement.manage", requiresReason: true },
  ...NON_TERMINAL.map((from): Transition => ({ from, to: "CANCELLED", by: "placement.manage", requiresReason: true })),
];

export class IllegalTransitionError extends Error {
  readonly status = 409;
  constructor(from: string, to: string) {
    super(`Cannot move placement from ${from} to ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function assertPlacementTransition(actor: Actor, placement: { status: PlacementStatus; clientId: string }, to: PlacementStatus, reason?: string, system = false): void {
  const candidates = PLACEMENT_TRANSITIONS.filter((t) => t.from === placement.status && t.to === to);
  if (candidates.length === 0) throw new IllegalTransitionError(placement.status, to);
  const ok = candidates.some((t) => {
    if (t.by === "SYSTEM") return system;
    if (t.by === "CLIENT_OWNER") return actor.role === "CLIENT" && actor.clientId === placement.clientId;
    return actor.permissions.has(t.by);
  });
  if (!ok) throw new ForbiddenError(`Not allowed to move this placement to ${to}`);
  if (candidates.every((t) => t.requiresReason) && !reason?.trim()) throw new Error(`A reason is required to move to ${to}`);
}

export const OPEN_PLACEMENT_STATUSES: readonly PlacementStatus[] = NON_TERMINAL;

/** Section 8.6 deployment checklist template. Seeded onto a placement at DEPLOYMENT_PREP. */
export const DEPLOYMENT_CHECKLIST_TEMPLATE: ReadonlyArray<{ label: string; isRequired: boolean }> = [
  { label: "Equipment and internet check completed", isRequired: true },
  { label: "Client tool accounts provisioned", isRequired: true },
  { label: "Schedule and timezone confirmed with client and agent", isRequired: true },
  { label: "Client kickoff call scheduled", isRequired: true },
  { label: "Agent briefed on client communication rules", isRequired: true },
  { label: "Welcome pack sent to client", isRequired: false },
];

/** Section 8.6 and Section 14 Q6: monthly equivalent of a rate. */
export function monthlyEquivalent(rate: { amount: number; unit: "HOURLY" | "MONTHLY" }, hoursPerMonth: number): number {
  return rate.unit === "HOURLY" ? rate.amount * hoursPerMonth : rate.amount;
}

/** Deposit amount in minor units for a policy against a billing rate. */
export function computeDeposit(policy: { type: "ONE_MONTH" | "TWO_WEEKS" | "FIXED" | "PERCENTAGE" | "CUSTOM"; value: number; currency: string | null }, rate: { amount: number; currency: string; unit: "HOURLY" | "MONTHLY" }, hoursPerMonth: number, custom?: number | null): { amount: number; currency: string } {
  const monthly = monthlyEquivalent(rate, hoursPerMonth);
  switch (policy.type) {
    case "ONE_MONTH":
      return { amount: monthly, currency: rate.currency };
    case "TWO_WEEKS":
      return { amount: Math.round(monthly / 2), currency: rate.currency };
    case "FIXED":
      return { amount: policy.value, currency: policy.currency ?? rate.currency };
    case "PERCENTAGE":
      return { amount: Math.round((monthly * policy.value) / 10_000), currency: rate.currency };
    case "CUSTOM":
      if (custom === null || custom === undefined || custom <= 0) throw new Error("A custom deposit policy needs an amount.");
      return { amount: custom, currency: rate.currency };
  }
}
