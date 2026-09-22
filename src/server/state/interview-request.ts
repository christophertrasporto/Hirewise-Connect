import type { Actor } from "@/server/auth/actor";
import type { PermissionKey } from "@/server/policies/permissions";
import { ForbiddenError } from "@/server/policies/authorize";

/** InterviewRequest.status transitions — MASTER_PROMPT.md Section 5.4. */
export type InterviewRequestStatus = "REQUESTED" | "SALES_REVIEW" | "CLIENT_CONFIRMATION" | "CANDIDATE_CONFIRMATION" | "SCHEDULED" | "COMPLETED" | "CLIENT_DECISION_PENDING" | "CLOSED" | "CANCELLED";

type Transition = { from: InterviewRequestStatus; to: InterviewRequestStatus; by: PermissionKey | "CLIENT_OWNER" | "SYSTEM"; requiresReason?: boolean };

export const INTERVIEW_REQUEST_TRANSITIONS: readonly Transition[] = [
  { from: "REQUESTED", to: "SALES_REVIEW", by: "interview.coordinate" },
  { from: "SALES_REVIEW", to: "CLIENT_CONFIRMATION", by: "interview.coordinate" },
  { from: "CLIENT_CONFIRMATION", to: "CANDIDATE_CONFIRMATION", by: "CLIENT_OWNER" },
  { from: "CLIENT_CONFIRMATION", to: "CANDIDATE_CONFIRMATION", by: "interview.coordinate" },
  { from: "CANDIDATE_CONFIRMATION", to: "SCHEDULED", by: "interview.schedule" },
  { from: "SCHEDULED", to: "COMPLETED", by: "SYSTEM" },
  { from: "COMPLETED", to: "CLIENT_DECISION_PENDING", by: "SYSTEM" },
  { from: "CLIENT_DECISION_PENDING", to: "CLIENT_CONFIRMATION", by: "SYSTEM" }, // second interview requested
  { from: "CLIENT_DECISION_PENDING", to: "CLOSED", by: "SYSTEM" },
  { from: "REQUESTED", to: "CANCELLED", by: "CLIENT_OWNER", requiresReason: true },
  { from: "SALES_REVIEW", to: "CANCELLED", by: "CLIENT_OWNER", requiresReason: true },
  { from: "CLIENT_CONFIRMATION", to: "CANCELLED", by: "CLIENT_OWNER", requiresReason: true },
  { from: "CANDIDATE_CONFIRMATION", to: "CANCELLED", by: "CLIENT_OWNER", requiresReason: true },
  { from: "SCHEDULED", to: "CANCELLED", by: "CLIENT_OWNER", requiresReason: true },
  { from: "REQUESTED", to: "CANCELLED", by: "interview.coordinate", requiresReason: true },
  { from: "SALES_REVIEW", to: "CANCELLED", by: "interview.coordinate", requiresReason: true },
  { from: "CLIENT_CONFIRMATION", to: "CANCELLED", by: "interview.coordinate", requiresReason: true },
  { from: "CANDIDATE_CONFIRMATION", to: "CANCELLED", by: "interview.coordinate", requiresReason: true },
  { from: "SCHEDULED", to: "CANCELLED", by: "interview.coordinate", requiresReason: true },
];

export class IllegalTransitionError extends Error {
  readonly status = 409;
  constructor(from: string, to: string) {
    super(`Cannot move interview request from ${from} to ${to}`);
    this.name = "IllegalTransitionError";
  }
}

/** Statuses at or beyond scheduling: the client company name may be disclosed to the candidate (Section 6, footnote 9). */
export const DISCLOSE_COMPANY_FROM: readonly InterviewRequestStatus[] = ["SCHEDULED", "COMPLETED", "CLIENT_DECISION_PENDING", "CLOSED"];

export function assertRequestTransition(actor: Actor, request: { status: InterviewRequestStatus; clientId: string }, to: InterviewRequestStatus, reason?: string, system = false): void {
  const candidates = INTERVIEW_REQUEST_TRANSITIONS.filter((t) => t.from === request.status && t.to === to);
  if (candidates.length === 0) throw new IllegalTransitionError(request.status, to);
  const ok = candidates.some((t) => {
    if (t.by === "SYSTEM") return system;
    if (t.by === "CLIENT_OWNER") return actor.role === "CLIENT" && actor.clientId === request.clientId;
    return actor.permissions.has(t.by);
  });
  if (!ok) throw new ForbiddenError(`Not allowed to move this request to ${to}`);
  if (candidates.every((t) => t.requiresReason) && !reason?.trim()) throw new Error(`A reason is required to move to ${to}`);
}

export const OPEN_REQUEST_STATUSES: readonly InterviewRequestStatus[] = ["REQUESTED", "SALES_REVIEW", "CLIENT_CONFIRMATION", "CANDIDATE_CONFIRMATION", "SCHEDULED", "COMPLETED", "CLIENT_DECISION_PENDING"];
