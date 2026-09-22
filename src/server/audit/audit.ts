import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/types";
import { auditRepository } from "@/server/repositories/audit.repository";

/** Sensitive actions from MASTER_PROMPT.md "Audit log". Extend as phases add features. */
export const AUDIT_ACTIONS = [
  "RATE_CHANGED",
  "PROFILE_APPROVED",
  "PROFILE_REJECTED",
  "PROFILE_SUSPENDED",
  "PROFILE_HIDDEN",
  "CERTIFICATION_APPROVED",
  "CERTIFICATION_REMOVED",
  "VIDEO_APPROVED",
  "RECORDING_APPROVED",
  "CLIENT_AGREEMENT_ACCEPTED",
  "AGENT_AGREEMENT_ACCEPTED",
  "CANDIDATE_SHORTLISTED",
  "INTERVIEW_REQUESTED",
  "INTERVIEW_SCHEDULED",
  "CANDIDATE_SELECTED",
  "DEPOSIT_RECORDED",
  "DEPOSIT_WAIVED",
  "PLACEMENT_ACTIVATED",
  "USER_SUSPENDED",
  "USER_CREATED",
  "PERMISSION_OVERRIDE_GRANTED",
  "SETTING_CHANGED",
  "VERIFICATION_SET_MANUALLY",
  "AVAILABILITY_CHANGED",
  "RESERVATION_CREATED",
  "MFA_ENROLLED",
  "CLIENT_REGISTERED",
  "CLIENT_ACTIVATED",
  "CLIENT_ACCOUNT_MANAGER_ASSIGNED",
  "AGENT_REGISTERED",
  "PROFILE_SUBMITTED",
  "PROFILE_UNDER_REVIEW",
  "PROFILE_REVISION_REQUIRED",
  "VIDEO_SUBMITTED",
  "RECORDING_SUBMITTED",
  "VIDEO_REVIEWED",
  "RECORDING_REVIEWED",
  "NOTE_ADDED",
  "REQUIREMENT_CREATED",
  "INTERVIEW_REQUEST_STATUS_CHANGED",
  "INTERVIEW_STATUS_CHANGED",
  "CANDIDATE_RESPONDED",
  "CLIENT_DECISION_RECORDED",
  "MESSAGE_HELD",
  "MESSAGE_RELEASED",
  "MESSAGE_BLOCKED",
  "RESERVATION_EXTENDED",
  "RESERVATION_RELEASED",
  "RESERVATION_EXPIRED",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export type AuditParams = {
  actor: Actor;
  action: AuditAction;
  entityType: string;
  entityId: string;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string;
  ipAddress?: string;
};

/**
 * Write an audit row inside the caller's transaction so the record can never be
 * out of sync with the state change it describes (Section 3.3).
 */
export async function audit(db: Db, p: AuditParams): Promise<void> {
  await auditRepository.insert(db, {
    actorUserId: p.actor.userId === "system" ? null : p.actor.userId,
    actorRole: p.actor.role,
    action: p.action,
    entityType: p.entityType,
    entityId: p.entityId,
    previousValue: toJson(p.previousValue),
    newValue: toJson(p.newValue),
    reason: p.reason ?? null,
    ipAddress: p.ipAddress ?? null,
  });
}

function toJson(v: unknown): JsonValue | null {
  if (v === undefined || v === null) return null;
  return JSON.parse(JSON.stringify(v)) as JsonValue;
}
