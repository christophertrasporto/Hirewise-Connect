import type { Prisma } from "@/server/db/types";
import type { requestInclude } from "@/server/repositories/interview.repository";
import type { placementInclude } from "@/server/repositories/placement.repository";
import { DISCLOSE_COMPANY_FROM, type InterviewRequestStatus } from "@/server/state/interview-request";
import { clientLabelFrom, maskedClientLabel } from "@/lib/client-redaction";

/** What a client may call an agent: the client label, or the legal name once an AGENT_IDENTITY grant exists. */
export function clientNameFor(a: { displayName: string; clientLabel: string | null; privateContact?: { fullLegalName: string } | null }, disclosed: boolean) {
  const label = a.clientLabel ?? clientLabelFrom(a.privateContact?.fullLegalName, a.displayName);
  return disclosed ? a.privateContact?.fullLegalName ?? label : label;
}

export type RequestRecord = Prisma.InterviewRequestGetPayload<{ include: ReturnType<typeof requestInclude> }>;
type PlacementRecord = Prisma.PlacementGetPayload<{ include: ReturnType<typeof placementInclude> }>;

/** Client's own interview request: candidates by client label (legal name only with a disclosure grant); no sales notes, no internal feedback. */
export function toRequestClientView(r: RequestRecord, disclosed: Set<string> = new Set()) {
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
    requestedWindows: (r.requestedWindows as string[] | null) ?? [],
    accountManagerAssigned: !!r.assignedSalesUserId,
    cancelledReason: r.cancelledReason,
    createdAt: r.createdAt,
    candidates: r.candidates.map((c) => ({ agentProfileId: c.agentProfileId, name: clientNameFor(c.agentProfile, disclosed.has(c.agentProfileId)), identityDisclosed: disclosed.has(c.agentProfileId), primaryRole: c.agentProfile.primaryRole, status: c.status })),
    interviews: r.interviews.map((i) => ({ id: i.id, agentProfileId: i.agentProfileId, name: clientNameFor(i.agentProfile, disclosed.has(i.agentProfileId)), round: i.round, scheduledAt: i.scheduledAt, timezone: i.timezone, durationMin: i.durationMin, meetingLink: i.meetingLink, status: i.status, clientDecision: i.clientDecision, clientFeedback: i.clientFeedback })),
  };
}

/**
 * Agent's view of a request they are a candidate on. Anonymised until scheduling
 * (Section 6, footnote 9): role, schedule, timezone, start date. Never client contact or notes.
 */
export function toRequestAgentView(r: RequestRecord, agentProfileId: string, opts: { clientIdentity: boolean } = { clientIdentity: false }) {
  const disclose = opts.clientIdentity;
  const me = r.candidates.find((c) => c.agentProfileId === agentProfileId);
  return {
    id: r.id,
    status: r.status,
    role: r.role,
    schedule: r.schedule,
    timezone: r.timezone,
    targetStartDate: r.targetStartDate,
    companyName: disclose ? r.client.companyName : null,
    /** Always safe to show: the company once disclosed, otherwise an industry and country label (phase 5). */
    clientLabel: disclose ? r.client.companyName : maskedClientLabel(r.client),
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
    requestedWindows: (r.requestedWindows as string[] | null) ?? [],
    client: { id: r.client.id, companyName: r.client.companyName, timezone: r.client.timezone, contactName: r.client.contacts[0]?.name ?? null, contactEmail: r.client.contacts[0]?.businessEmail ?? null, accountManagerUserId: r.client.accountManagerUserId },
    requirement: r.requirement ? { id: r.requirement.id, title: r.requirement.title, role: r.requirement.role } : null,
    assignedSales: r.assignedSales ? { id: r.assignedSales.id, email: r.assignedSales.email } : null,
    candidates: r.candidates.map((c) => ({
      agentProfileId: c.agentProfileId,
      displayName: c.agentProfile.displayName,
      clientLabel: c.agentProfile.clientLabel,
      legalName: opts.canPrivateContact || scheduled ? c.agentProfile.privateContact?.fullLegalName ?? null : null,
      email: opts.canPrivateContact ? c.agentProfile.user.email : null,
      primaryRole: c.agentProfile.primaryRole,
      availabilityStatus: c.agentProfile.availabilityStatus,
      timezone: c.agentProfile.timezone,
      status: c.status,
      respondedAt: c.respondedAt,
    })),
    interviews: r.interviews.map((i) => ({ id: i.id, agentProfileId: i.agentProfileId, displayName: i.agentProfile.displayName, round: i.round, scheduledAt: i.scheduledAt, timezone: i.timezone, durationMin: i.durationMin, meetingLink: i.meetingLink, linkSource: i.linkSource, participants: (i.participants as Array<{ label: string; role: string }> | null) ?? [], status: i.status, clientDecision: i.clientDecision, clientFeedback: i.clientFeedback, internalFeedback: i.internalFeedback })),
  };
}

export function toPlacementView(p: PlacementRecord, audience: "CLIENT" | "AGENT" | "STAFF", opts: { agentIdentity?: boolean; clientIdentity?: boolean } = {}) {
  return {
    id: p.id,
    status: p.status,
    positionTitle: p.positionTitle,
    schedule: p.schedule,
    timezone: p.timezone,
    startDate: p.startDate,
    createdAt: p.createdAt,
    activatedAt: p.activatedAt,
    agent: { id: p.agentProfile.id, name: audience === "CLIENT" ? clientNameFor(p.agentProfile, !!opts.agentIdentity) : p.agentProfile.displayName, primaryRole: p.agentProfile.primaryRole },
    // Agents see the company through a CLIENT_IDENTITY grant (created with the placement); otherwise a masked label (phase 5).
    client: audience === "AGENT" ? { companyName: opts.clientIdentity ? p.client.companyName : maskedClientLabel(p.client) } : { id: p.client.id, companyName: p.client.companyName, timezone: p.client.timezone },
    accountManager: audience === "STAFF" ? p.accountManager : null,
    cancelledReason: audience === "STAFF" ? p.cancelledReason : null,
  };
}
