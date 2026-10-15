import type { ExitRequestRecord } from "@/server/repositories/exit.repository";

/**
 * Exit request projections. AGENT sees their own request and the decisions; OWNER sees the member and the Hirewise
 * stage; STAFF sees everything. No identity keys, no client details.
 */
export function toExitRequestView(r: ExitRequestRecord, audience: "AGENT" | "OWNER" | "STAFF") {
  return {
    id: r.id,
    membershipId: r.membershipId,
    agencyId: r.agencyId,
    agencyName: r.membership.agency?.name ?? null,
    agentProfileId: r.agentProfileId,
    displayName: r.membership.agentProfile.displayName,
    agentEmail: audience === "AGENT" ? null : r.membership.agentProfile.user.email,
    type: r.type,
    reason: r.reason,
    effectiveOption: r.effectiveOption,
    requestedEffectiveDate: r.requestedEffectiveDate,
    status: r.status,
    adminRequired: r.adminRequired,
    adminRequiredReason: audience === "STAFF" ? r.adminRequiredReason : r.adminRequired ? "Hirewise review required" : null,
    agencyDecision: r.agencyDecision,
    agencyDecisionNote: r.agencyDecisionNote,
    agencyDecidedAt: r.agencyDecidedAt,
    adminDecision: r.adminDecision,
    adminDecisionNote: r.adminDecisionNote,
    adminDecidedAt: r.adminDecidedAt,
    escalatedAt: r.escalatedAt,
    effectiveAt: r.effectiveAt,
    completedAt: r.completedAt,
    membershipStatus: r.membership.status,
    joinedAt: r.membership.joinedAt,
    createdAt: r.createdAt,
  };
}
export type ExitRequestView = ReturnType<typeof toExitRequestView>;
