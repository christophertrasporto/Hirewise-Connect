import type { ThreadRecord, MessageRecord } from "@/server/repositories/thread.repository";
import { maskedClientLabel, clientLabelFrom } from "@/lib/client-redaction";

/** v2 phase 6a: thread projections per audience (INV-A3). Clients see labels and Partner Teams; talent sees masked client labels. */

export type ThreadAudience = "CLIENT" | "AGENT" | "AGENCY" | "STAFF";

function counterpartFor(t: ThreadRecord, who: ThreadAudience, clientDisclosed: boolean): string {
  if (who === "STAFF") return [t.client?.companyName, t.agency?.name, t.agentProfile?.displayName].filter(Boolean).join(" · ") || "Hirewise";
  if (who === "CLIENT") {
    if (t.agency) return t.agency.clientFacingName ?? `Hirewise Certified Partner Team ${t.agency.clientFacingCode ?? ""}`.trim();
    if (t.agentProfile) return t.agentProfile.clientLabel ?? clientLabelFrom(t.agentProfile.privateContact?.fullLegalName, t.agentProfile.displayName);
    return "Hirewise";
  }
  // AGENT or AGENCY: the client only through a disclosure grant, otherwise the masked label.
  if (t.client) return clientDisclosed ? t.client.companyName : maskedClientLabel(t.client);
  return "Hirewise";
}

export function toThreadView(t: ThreadRecord, who: ThreadAudience, opts: { clientDisclosed?: boolean; unread?: number } = {}) {
  return {
    id: t.id,
    kind: t.kind,
    title: t.title,
    status: t.status,
    counterpart: counterpartFor(t, who, !!opts.clientDisclosed),
    requestId: t.interviewRequestId,
    lastMessageAt: t.lastMessageAt,
    createdAt: t.createdAt,
    assignedToHirewise: !!t.assignedStaffUserId,
    ...(who === "STAFF" ? { client: t.client ? { id: t.client.id, companyName: t.client.companyName } : null, agency: t.agency ? { id: t.agency.id, name: t.agency.name } : null, agent: t.agentProfile ? { id: t.agentProfile.id, displayName: t.agentProfile.displayName } : null, assignedStaff: t.assignedStaff?.email ?? null } : {}),
  };
}
export type ThreadView = ReturnType<typeof toThreadView>;

export function toMessageView(m: MessageRecord, who: ThreadAudience, authorLabel: string, mine: boolean) {
  return {
    id: m.id,
    body: m.body,
    /** Staff only: the text as typed when masking changed it. */
    originalBody: who === "STAFF" ? m.originalBody : null,
    masked: !!m.maskedAt,
    findings: who === "STAFF" || mine ? m.findings : [],
    authorRole: m.authorRole,
    authorLabel,
    mine,
    visibleTo: m.visibleTo,
    heldForReview: m.heldForReview,
    blocked: !!m.blockedAt,
    createdAt: m.createdAt,
  };
}
export type MessageView = ReturnType<typeof toMessageView>;
