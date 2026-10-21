import type { OpportunityRecord, SubmissionRecord } from "@/server/repositories/opportunity.repository";
import { clientLabelFrom } from "@/lib/client-redaction";

/**
 * Allow-list projections for opportunities (v2 phase 6b, INV-A3).
 * Agencies and talent never see the client (masked label only) or other agencies' submissions; clients never see
 * agency names or agent display names (labels and Partner Teams only); staff see everything.
 */

function base(o: OpportunityRecord) {
  return {
    id: o.id,
    title: o.title,
    roleSummary: o.roleSummary,
    skills: o.skills,
    software: o.software,
    industry: o.industry,
    experienceLevel: o.experienceLevel,
    schedule: o.schedule,
    timezone: o.timezone,
    startDate: o.startDate,
    headcount: o.headcount,
    status: o.status,
    publishedAt: o.publishedAt,
    closedAt: o.closedAt,
  };
}

function submissionForAgency(s: SubmissionRecord) {
  return { id: s.id, agentProfileId: s.agentProfileId, displayName: s.agentProfile.displayName, primaryRole: s.agentProfile.primaryRole, status: s.status, note: s.note, reviewNote: s.status === "DECLINED" ? s.reviewNote : null, withdrawnReason: s.withdrawnReason, createdAt: s.createdAt, reviewedAt: s.reviewedAt };
}

/** Agency view: the masked client, the agency's own submissions only. */
export function toOpportunityAgencyView(o: OpportunityRecord, agencyId: string) {
  const mine = o.submissions.filter((s) => s.agencyId === agencyId);
  return { ...base(o), clientLabel: o.maskedClientLabel, mySubmissions: mine.map(submissionForAgency), openSlots: Math.max(0, o.headcount - o.submissions.filter((s) => s.status === "SELECTED").length) };
}
export type OpportunityAgencyView = ReturnType<typeof toOpportunityAgencyView>;

/** Direct talent view: the masked client and the agent's own submission. */
export function toOpportunityAgentView(o: OpportunityRecord, agentProfileId: string) {
  const mine = o.submissions.find((s) => s.agentProfileId === agentProfileId);
  return { ...base(o), clientLabel: o.maskedClientLabel, mySubmission: mine ? { id: mine.id, status: mine.status, note: mine.note, reviewNote: mine.status === "DECLINED" ? mine.reviewNote : null, viaAgency: !!mine.agencyId, createdAt: mine.createdAt } : null };
}
export type OpportunityAgentView = ReturnType<typeof toOpportunityAgentView>;

/** Client view: counts only; the candidates come as client-safe cards from the service. */
export function toOpportunityClientView(o: OpportunityRecord) {
  const approved = o.submissions.filter((s) => ["APPROVED_FOR_CLIENT", "INTERVIEWING", "SELECTED", "NOT_SELECTED"].includes(s.status));
  return {
    ...base(o),
    requirementId: o.requirementId,
    visibility: o.visibility === "DIRECT_ONLY" ? "Hirewise Direct talent" : o.visibility === "SELECTED_AGENCIES" ? "Selected Partner Teams" : "All Partner Teams and Hirewise Direct talent",
    candidatesInReview: o.submissions.filter((s) => s.status === "PENDING_REVIEW").length,
    candidatesApproved: approved.length,
    candidateStatuses: approved.map((s) => ({ agentProfileId: s.agentProfileId, status: s.status, partnerTeam: s.agency ? { code: s.agency.clientFacingCode, name: s.agency.clientFacingName ?? `Hirewise Certified Partner Team ${s.agency.clientFacingCode ?? ""}` } : null, name: s.agentProfile.clientLabel ?? clientLabelFrom(null, s.agentProfile.displayName) })),
  };
}
export type OpportunityClientView = ReturnType<typeof toOpportunityClientView>;

export function toSubmissionStaffView(s: SubmissionRecord) {
  return {
    id: s.id,
    agentProfileId: s.agentProfileId,
    displayName: s.agentProfile.displayName,
    clientLabel: s.agentProfile.clientLabel,
    primaryRole: s.agentProfile.primaryRole,
    availabilityStatus: s.agentProfile.availabilityStatus,
    verificationLevel: s.agentProfile.verificationLevel,
    agency: s.agency ? { id: s.agency.id, name: s.agency.name, code: s.agency.clientFacingCode } : null,
    submittedBy: s.submittedBy.email,
    note: s.note,
    status: s.status,
    reviewNote: s.reviewNote,
    reviewedAt: s.reviewedAt,
    withdrawnReason: s.withdrawnReason,
    interviewRequestId: s.interviewRequestId,
    createdAt: s.createdAt,
  };
}

export function toOpportunityStaffView(o: OpportunityRecord) {
  return {
    ...base(o),
    requirementId: o.requirementId,
    visibility: o.visibility,
    maskedClientLabel: o.maskedClientLabel,
    client: { id: o.client.id, companyName: o.client.companyName, accountManagerUserId: o.client.accountManagerUserId },
    sharedWith: o.agencies.map((a) => ({ id: a.agency.id, name: a.agency.name })),
    publishedBy: o.publishedBy.email,
    closedReason: o.closedReason,
    submissions: o.submissions.map(toSubmissionStaffView),
    pendingReview: o.submissions.filter((s) => s.status === "PENDING_REVIEW").length,
  };
}
export type OpportunityStaffView = ReturnType<typeof toOpportunityStaffView>;
