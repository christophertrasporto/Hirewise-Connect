import type { PartnerTeamRecord, PartnerMemberStats } from "@/server/repositories/partner.repository";
import type { ClientSafeDocumentRecord } from "@/server/repositories/client-safe-document.repository";
import type { DisclosureGrantRecord } from "@/server/repositories/disclosure.repository";

/**
 * Allow-list projections for client protection (v2 phase 5, INV-A3).
 * `toPartnerTeamClientView` is the only shape a client endpoint may receive about an agency: no real name, logo,
 * website, contact, owner, address, registration, or billing fields, unless an AGENCY_IDENTITY grant adds `disclosed`.
 */

export type TeamStats = {
  teamSize: number;
  qualifiedProfessionals: number;
  availableNow: number;
  inTraining: number;
  trainingCompletionPct: number | null;
  certifications: Array<{ name: string; count: number }>;
  avgYearsExperience: number | null;
  certifiedMembers: number;
};

export function computeTeamStats(members: PartnerMemberStats[]): TeamStats {
  const certCounts = new Map<string, number>();
  let completed = 0;
  let total = 0;
  let inTraining = 0;
  let years = 0;
  let yearsN = 0;
  let certified = 0;
  for (const m of members) {
    if (m.certifications.length) certified++;
    for (const c of m.certifications) certCounts.set(c.template.name, (certCounts.get(c.template.name) ?? 0) + 1);
    const active = m.enrollments.filter((e) => e.status !== "REVOKED" && e.status !== "DROPPED");
    total += active.length;
    completed += active.filter((e) => e.status === "COMPLETED").length;
    if (active.some((e) => e.status === "ENROLLED" || e.status === "IN_PROGRESS")) inTraining++;
    if (m.yearsExperience !== null) {
      years += m.yearsExperience;
      yearsN++;
    }
  }
  return {
    teamSize: members.length,
    qualifiedProfessionals: members.filter((m) => ["SKILLS_ASSESSED", "HIREWISE_CERTIFIED", "INTERVIEW_READY", "DEPLOYMENT_READY"].includes(m.verificationLevel)).length,
    availableNow: members.filter((m) => m.availabilityStatus === "AVAILABLE").length,
    inTraining,
    trainingCompletionPct: total ? Math.round((completed / total) * 100) : null,
    certifications: [...certCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    avgYearsExperience: yearsN ? Math.round((years / yearsN) * 10) / 10 : null,
    certifiedMembers: certified,
  };
}

/** Decision 7: placements that reached ACTIVE over selected submissions, shown only after five data points. */
export function performanceRatingFrom(inputs: { selected: number; active: number } | null): number | null {
  if (!inputs || inputs.selected < 5) return null;
  return Math.round(Math.min(1, inputs.active / inputs.selected) * 100);
}

export function toPartnerTeamClientView(t: PartnerTeamRecord, stats: TeamStats, disclosed: { name: string } | null = null, contactAlias: string | null = null, rating: { selected: number; active: number } | null = null) {
  const code = t.clientFacingCode ?? "";
  return {
    code,
    /** Platform alias for written contact with the team through Hirewise (phase 6a). */
    contactAlias,
    name: t.clientFacingName ?? `Hirewise Certified Partner Team ${code}`,
    specializations: t.clientFacingSpecializations,
    memberSince: t.joinedAt,
    teamSize: stats.teamSize,
    qualifiedProfessionals: stats.qualifiedProfessionals,
    certifiedMembers: stats.certifiedMembers,
    availableNow: stats.availableNow,
    inTraining: stats.inTraining,
    trainingCompletionPct: stats.trainingCompletionPct,
    certifications: stats.certifications,
    avgYearsExperience: stats.avgYearsExperience,
    /** Percent of selected submissions that reached an active placement (phase 6b, decision 7); null below five data points. */
    performanceRating: performanceRatingFrom(rating),
    /** Only with an active AGENCY_IDENTITY grant for the requesting client. */
    disclosed: disclosed ? { agencyName: disclosed.name } : null,
  };
}
export type PartnerTeamClientView = ReturnType<typeof toPartnerTeamClientView>;

export function toClientSafeDocumentStaffView(d: ClientSafeDocumentRecord) {
  return {
    id: d.id,
    type: d.type,
    sourceType: d.sourceType,
    sourceId: d.sourceId,
    status: d.status,
    isExternalLink: /^https?:\/\//i.test(d.originalStorageKey),
    hasSanitized: !!d.sanitizedStorageKey,
    findings: Array.isArray((d.findings as { text?: unknown } | null)?.text) ? ((d.findings as { text: string[] }).text) : [],
    autoNote: d.autoNote,
    reviewNote: d.reviewNote,
    reviewedAt: d.reviewedAt,
    reviewedBy: d.reviewedBy?.email ?? null,
    createdAt: d.createdAt,
    agent: { id: d.agentProfile.id, displayName: d.agentProfile.displayName, clientLabel: d.agentProfile.clientLabel, primaryRole: d.agentProfile.primaryRole, status: d.agentProfile.status },
  };
}
export type ClientSafeDocumentStaffView = ReturnType<typeof toClientSafeDocumentStaffView>;

/** The agent's own view: what clients can open and what is still waiting. No reviewer identity. */
export function toClientSafeDocumentOwnerView(d: ClientSafeDocumentRecord) {
  return { id: d.id, type: d.type, status: d.status, reviewNote: d.status === "REJECTED" ? d.reviewNote : null, createdAt: d.createdAt };
}

export function toDisclosureGrantView(g: DisclosureGrantRecord) {
  return {
    id: g.id,
    scope: g.scope,
    client: { id: g.client.id, companyName: g.client.companyName },
    agent: g.agentProfile ? { id: g.agentProfile.id, displayName: g.agentProfile.displayName, clientLabel: g.agentProfile.clientLabel } : null,
    agency: g.agency ? { id: g.agency.id, name: g.agency.name, clientFacingName: g.agency.clientFacingName, clientFacingCode: g.agency.clientFacingCode } : null,
    grantedBy: g.grantedBy,
    grantedByEmail: g.grantedByUser?.email ?? null,
    reason: g.reason,
    grantedAt: g.grantedAt,
    expiresAt: g.expiresAt,
    revokedAt: g.revokedAt,
    revokeReason: g.revokeReason,
    active: !g.revokedAt && (!g.expiresAt || g.expiresAt.getTime() > Date.now()),
  };
}
export type DisclosureGrantView = ReturnType<typeof toDisclosureGrantView>;
