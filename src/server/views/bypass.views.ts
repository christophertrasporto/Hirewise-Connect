import type { BypassReportRecord } from "@/server/repositories/bypass.repository";

/** v2 phase 6a: bypass case projections. Reporters see their own case without the reviewer's notes or the reported party's details. */

export function toBypassReportView(r: BypassReportRecord, audience: "STAFF" | "REPORTER") {
  const reportedLabel = r.reportedUser ? (r.reportedUser.agentProfiles[0]?.displayName ?? r.reportedUser.clientContact?.name ?? r.reportedUser.email) : r.reportedAgency ? r.reportedAgency.name : r.reportedClient ? r.reportedClient.companyName : null;
  const base = {
    id: r.id,
    status: r.status,
    description: r.description,
    relatedType: r.relatedType,
    relatedId: r.relatedId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    evidenceCount: r.evidenceDocumentIds.length,
    history: r.events.map((e) => ({ id: e.id, from: e.fromStatus, to: e.toStatus, note: audience === "STAFF" ? e.note : null, at: e.createdAt })),
  };
  if (audience === "REPORTER") return { ...base, decided: !!r.decidedAt };
  return {
    ...base,
    reporter: { userId: r.reporter.id, email: r.reporter.email, role: r.reporterRole },
    reported: { userId: r.reportedUser?.id ?? null, userStatus: r.reportedUser?.status ?? null, role: r.reportedUser?.role.key ?? null, agentProfileId: r.reportedUser?.agentProfiles[0]?.id ?? null, agentStatus: r.reportedUser?.agentProfiles[0]?.status ?? null, agencyId: r.reportedAgency?.id ?? null, agencyStatus: r.reportedAgency?.status ?? null, clientId: r.reportedClient?.id ?? r.reportedUser?.clientContact?.clientId ?? null, clientStatus: r.reportedClient?.status ?? null, label: reportedLabel },
    assignedTo: r.assignedTo?.email ?? null,
    decisionNotes: r.decisionNotes,
    restrictionEndsAt: r.restrictionEndsAt,
    decidedAt: r.decidedAt,
    evidenceDocumentIds: r.evidenceDocumentIds,
  };
}
export type BypassReportStaffView = ReturnType<typeof toBypassReportView> & { reporter: { userId: string; email: string; role: string } };
