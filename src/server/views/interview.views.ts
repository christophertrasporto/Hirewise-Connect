import type { Prisma } from "@/server/db/types";
import type { requestInclude } from "@/server/repositories/interview.repository";
import type { placementInclude } from "@/server/repositories/placement.repository";
import { DISCLOSE_COMPANY_FROM, type InterviewRequestStatus } from "@/server/state/interview-request";

export type RequestRecord = Prisma.InterviewRequestGetPayload<{ include: ReturnType<typeof requestInclude> }>;
type PlacementRecord = Prisma.PlacementGetPayload<{ include: ReturnType<typeof placementInclude> }>;

/** Client's own interview request: candidates by display name; no sales notes, no internal feedback. */
export function toRequestClientView(r: RequestRecord) {
  return {
    id: r.id,
    status: r.status,
    role: r.role,
    schedule: r.schedule,
    timezone: r.timezone,
    preferredDate: r.preferredDate,
    preferredTime: r.preferredTime,
    targetStartDate: r.targetStartDate,
    notes: r.notes,
    requirement: r.requirement ? { id: r.requirement.id, title: r.requirement.title } : null,
    accountManagerAssigned: !!r.assignedSalesUserId,
    cancelledReason: r.cancelledReason,
    createdAt: r.createdAt,
    candidates: r.candidates.map((c) => ({ agentProfileId: c.agentProfileId, displayName: c.agentProfile.displayName, primaryRole: c.agentProfile.primaryRole, status: c.status })),
    interviews: r.interviews.map((i) => ({ id: i.id, agentProfileId: i.agentProfileId, displayName: i.agentProfile.displayName, round: i.round, scheduledAt: i.scheduledAt, timezone: i.timezone, durationMin: i.durationMin, meetingLink: i.meetingLink, status: i.status, clientDecision: i.clientDecision, clientFeedback: i.clientFeedback })),
  };
}

/**
 * Agent's view of a request they are a candidate on. Anonymised until scheduling
 * (Section 6, footnote 9): role, schedule, timezone, start date. Never client contact or notes.
 */
export function toRequestAgentView(r: RequestRecord, agentProfileId: string) {
  const disclose = DISCLOSE_COMPANY_FROM.includes(r.status as InterviewRequestStatus);
  const me = r.candidates.find((c) => c.agentProfileId === agentProfileId);
  return {
    id: r.id,
    status: r.status,
    role: r.role,
    schedule: r.schedule,
    timezone: r.timezone,
    targetStartDate: r.targetStartDate,
    companyName: disclose ? r.client.companyName : null,
    myStatus: me?.status ?? "PENDING",
    createdAt: r.createdAt,
    interviews: r.interviews.filter((i) => i.agentProfileId === agentProfileId).map((i) => ({ id: i.id, round: i.round, scheduledAt: i.scheduledAt, timezone: i.timezone, durationMin: i.durationMin, meetingLink: i.meetingLink, status: i.status, outcome: i.clientDecision === "SELECTED" || i.clientDecision === "NOT_SELECTED" ? i.clientDecision : null })),
  };
}

/** Staff view: everything, with the candidate's legal name only when allowed (Section 6, footnote 1). */
export function toRequestStaffView(r: RequestRecord, opts: { canPrivateContact: boolean }) {
  const scheduled = DISCLOSE_COMPANY_FROM.includes(r.status as InterviewRequestStatus);
  return {
    id: r.id,
    status: r.status,
    role: r.role,
    schedule: r.schedule,
    timezone: r.timezone,
    preferredDate: r.preferredDate,
    preferredTime: r.preferredTime,
    targetStartDate: r.targetStartDate,
    notes: r.notes,
    salesNotes: r.salesNotes,
    cancelledReason: r.cancelledReason,
    createdAt: r.createdAt,
    client: { id: r.client.id, companyName: r.client.companyName, timezone: r.client.timezone, contactName: r.client.contacts[0]?.name ?? null, contactEmail: r.client.contacts[0]?.businessEmail ?? null, accountManagerUserId: r.client.accountManagerUserId },
    requirement: r.requirement ? { id: r.requirement.id, title: r.requirement.title, role: r.requirement.role } : null,
    assignedSales: r.assignedSales ? { id: r.assignedSales.id, email: r.assignedSales.email } : null,
    candidates: r.candidates.map((c) => ({
      agentProfileId: c.agentProfileId,
      displayName: c.agentProfile.displayName,
      legalName: opts.canPrivateContact || scheduled ? c.agentProfile.privateContact?.fullLegalName ?? null : null,
      email: opts.canPrivateContact ? c.agentProfile.user.email : null,
      primaryRole: c.agentProfile.primaryRole,
      availabilityStatus: c.agentProfile.availabilityStatus,
      timezone: c.agentProfile.timezone,
      status: c.status,
      respondedAt: c.respondedAt,
    })),
    interviews: r.interviews.map((i) => ({ id: i.id, agentProfileId: i.agentProfileId, displayName: i.agentProfile.displayName, round: i.round, scheduledAt: i.scheduledAt, timezone: i.timezone, durationMin: i.durationMin, meetingLink: i.meetingLink, status: i.status, clientDecision: i.clientDecision, clientFeedback: i.clientFeedback, internalFeedback: i.internalFeedback })),
  };
}

export function toPlacementView(p: PlacementRecord, audience: "CLIENT" | "AGENT" | "STAFF") {
  return {
    id: p.id,
    status: p.status,
    positionTitle: p.positionTitle,
    schedule: p.schedule,
    timezone: p.timezone,
    startDate: p.startDate,
    createdAt: p.createdAt,
    activatedAt: p.activatedAt,
    agent: { id: p.agentProfile.id, displayName: p.agentProfile.displayName, primaryRole: p.agentProfile.primaryRole },
    // Agents learn the company only once selected (placement exists), which is after scheduling by construction.
    client: audience === "AGENT" ? { companyName: p.client.companyName } : { id: p.client.id, companyName: p.client.companyName, timezone: p.client.timezone },
    accountManager: audience === "STAFF" ? p.accountManager : null,
    cancelledReason: audience === "STAFF" ? p.cancelledReason : null,
  };
}
