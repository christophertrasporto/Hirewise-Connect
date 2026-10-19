import type { Prisma } from "@/server/db/types";
import type { agentSelfInclude } from "@/server/repositories/agent.repository";
import { redactForClient, clientLabelFrom } from "@/lib/client-redaction";

type AgentSelfRecord = Prisma.AgentProfileGetPayload<{ include: ReturnType<typeof agentSelfInclude> }>;

/** Client-safe certification: template name, validity, and only the scores the template allows (Section 6, footnote 3). */
function certificationsForClient(a: AgentSelfRecord) {
  return a.certifications
    .filter((c) => c.status === "APPROVED")
    .map((c) => {
      const scores: Record<string, number> = {};
      if (c.assessment) {
        for (const key of c.template.clientVisibleScores) {
          const v = (c.assessment as Record<string, unknown>)[key];
          if (typeof v === "number") scores[key] = v;
        }
      }
      return { id: c.id, name: c.template.name, badgeKey: c.template.badgeKey, issuedAt: c.issuedAt, expiresAt: c.expiresAt, resultLabel: c.assessment?.resultLabel?.label ?? null, scores };
    });
}

function assessmentSummaryForClient(a: AgentSelfRecord) {
  const best = [...a.assessments].sort((x, y) => (y.resultLabel?.rank ?? 0) - (x.resultLabel?.rank ?? 0))[0];
  return best?.resultLabel ? { label: best.resultLabel.label, rank: best.resultLabel.rank, courseTitle: best.course?.title ?? null } : null;
}

/** PUBLISHED client rate for client-facing views (INV-C3). */
function clientRateFor(a: AgentSelfRecord) {
  const r = a.billingRates[0];
  return r ? { amount: r.amount, currency: r.currency, unit: r.unit, label: `${r.currency} ${(r.amount / 100).toFixed(2)} / ${r.unit === "HOURLY" ? "hour" : "month"}` } : null;
}

function coachEvaluationForClient(a: AgentSelfRecord) {
  const ev = a.coachEvaluations[0];
  if (!ev || !ev.visibleToClients) return null;
  return { summary: ev.summary, communication: ev.communication, reliability: ev.reliability, coachability: ev.coachability, overall: ev.overallLabel?.label ?? null };
}

/**
 * Allowlist projections (INV-A3). Never spread a record. Each function names
 * every field it returns so a new column in the schema is private by default.
 */

export type AgentSelfView = ReturnType<typeof toAgentSelfView>;

/** The agent looking at their own profile: everything except review internals are theirs to see. */
export function toAgentSelfView(a: AgentSelfRecord) {
  return {
    id: a.id,
    displayName: a.displayName,
    // v2 phase 5: what clients see instead of the display name, and the Partner Team they see instead of the agency.
    clientLabel: a.clientLabel ?? clientLabelFrom(a.privateContact?.fullLegalName, a.displayName),
    clientLabelOverride: a.clientLabelOverride,
    partnerTeam: partnerTeamFor(a),
    headline: a.headline,
    primaryRole: a.primaryRole,
    summary: a.summary,
    photoKey: a.photoKey,
    yearsExperience: a.yearsExperience,
    experienceLevel: a.experienceLevel,
    locationCity: a.locationCity,
    locationCountry: a.locationCountry,
    timezone: a.timezone,
    languages: a.languages,
    workSetup: a.workSetup,
    preferredShift: a.preferredShift,
    equipmentSummary: a.equipmentSummary,
    internetSummary: a.internetSummary,
    status: a.status,
    verificationLevel: a.verificationLevel,
    availabilityStatus: a.availabilityStatus,
    availableFrom: a.availableFrom,
    profileCompletion: a.profileCompletion,
    submittedAt: a.submittedAt,
    approvedAt: a.approvedAt,
    privateContact: a.privateContact
      ? { fullLegalName: a.privateContact.fullLegalName, personalEmail: a.privateContact.personalEmail, phone: a.privateContact.phone, addressLine: a.privateContact.addressLine, hasResume: !!a.privateContact.resumeKey }
      : null,
    skills: a.skills.map((s) => ({ skillId: s.skillId, name: s.skill.name, category: s.skill.category, level: s.level, yearsUsed: s.yearsUsed, verified: !!s.verifiedById })),
    experiences: a.experiences.map((e) => ({ id: e.id, company: e.company, title: e.title, industry: e.industry, startDate: e.startDate, endDate: e.endDate, description: e.description, isCampaign: e.isCampaign, campaignType: e.campaignType })),
    industries: a.industryExperiences.map((i) => ({ industry: i.industry, years: i.years })),
    software: a.softwareExperiences.map((s) => ({ softwareId: s.softwareId, name: s.software.name, level: s.level })),
    // Media: the agent sees status and feedback on their own items.
    videos: a.videos.map((v) => ({ id: v.id, status: v.status, isCurrent: v.isCurrent, durationSec: v.durationSec, reviewFeedback: v.reviewFeedback, createdAt: v.createdAt })),
    recordings: a.recordings.map((r) => ({ id: r.id, kind: r.kind, title: r.title, status: r.status, durationSec: r.durationSec, reviewFeedback: r.reviewFeedback, createdAt: r.createdAt })),
    portfolio: a.portfolioItems.map((p) => ({ id: p.id, title: p.title, status: p.status, url: p.url, reviewFeedback: p.reviewFeedback })),
    // Academy: the agent sees their certifications and their coach's feedback (not internal-only areasForImprovement wording is theirs to see too).
    certifications: a.certifications.map((c) => ({ id: c.id, name: c.template.name, badgeKey: c.template.badgeKey, status: c.status, issuedAt: c.issuedAt, expiresAt: c.expiresAt, certificateNumber: c.certificateNumber, verificationCode: c.verificationCode })),
    assessments: a.assessments.map((s) => ({ id: s.id, courseTitle: s.course?.title ?? null, type: s.type, examScore: s.examScore, practicalScore: s.practicalScore, roleplayScore: s.roleplayScore, communicationScore: s.communicationScore, result: s.resultLabel?.label ?? null, strengths: s.strengths, areasForImprovement: s.areasForImprovement, assessedAt: s.assessedAt })),
    courses: a.enrollments.map((e) => ({ courseId: e.course.id, title: e.course.title, category: e.course.category, status: e.status, paymentStatus: e.paymentStatus, completedAt: e.completion?.completedAt ?? null, examScore: e.completion?.examScore ?? null })),
    // Section 14 Q4 / INV-C2: the agent learns only that a client rate exists, never the amount.
    clientRatePublished: a.billingRates.length > 0,
  };
}

/** v2 phase 5: who the projection is for. Clients get labels, redaction, and only client-safe media. */
export type Audience = "CLIENT" | "STAFF";
export type ClientSafeContext = { videoIds: Set<string>; recordingIds: Set<string>; portfolio: Map<string, string>; documents: Array<{ id: string; type: string; title: string }> };
export type CandidateViewOptions = {
  audience: Audience;
  /** Legal name to show in place of the label: only when the requesting client holds an AGENT_IDENTITY grant. */
  legalName?: string | null;
  /** Approved client-safe rows for this agent. Absent means a client sees no media and no documents. */
  clientSafe?: ClientSafeContext;
  /** Further agency names to replace in free text (the agent's own agency is always replaced). */
  agencyNames?: Array<{ name: string; replacement: string }>;
};
const CLIENT_ONLY: CandidateViewOptions = { audience: "CLIENT" };

export function partnerTeamFor(a: { primaryAgency: { clientFacingCode: string | null; clientFacingName: string | null } | null }) {
  const ag = a.primaryAgency;
  return ag?.clientFacingCode ? { code: ag.clientFacingCode, name: ag.clientFacingName ?? `Hirewise Certified Partner Team ${ag.clientFacingCode}` } : null;
}

function clientLabelOf(a: AgentSelfRecord) {
  return a.clientLabel ?? clientLabelFrom(a.privateContact?.fullLegalName, a.displayName);
}

function redactor(a: AgentSelfRecord, opts: CandidateViewOptions) {
  if (opts.audience !== "CLIENT") return (t: string | null) => t;
  const team = partnerTeamFor(a);
  const names = [...(opts.agencyNames ?? []), ...(a.primaryAgency ? [{ name: a.primaryAgency.name, replacement: team?.name ?? "a Hirewise Partner Team" }] : [])];
  return (t: string | null) => (t ? redactForClient(t, { agencyNames: names }).text : t);
}

export type CandidateClientView = ReturnType<typeof toCandidateClientView>;

/**
 * What a client may see (Section 6, phase 5). The client label instead of the display name, redacted free text,
 * no private contact, no review feedback, no internal notes, no raw links, and only media and documents with an
 * APPROVED_FOR_CLIENT client-safe row. Staff get the same shape with the display name and unredacted text.
 */
export function toCandidateClientView(a: AgentSelfRecord, opts: CandidateViewOptions = CLIENT_ONLY) {
  const client = opts.audience === "CLIENT";
  const r = redactor(a, opts);
  const safe = opts.clientSafe;
  const mediaOk = (kind: "video" | "recording", id: string) => !client || (kind === "video" ? !!safe?.videoIds.has(id) : !!safe?.recordingIds.has(id));
  return {
    id: a.id,
    name: client ? opts.legalName ?? clientLabelOf(a) : a.displayName,
    identityDisclosed: client ? !!opts.legalName : false,
    partnerTeam: partnerTeamFor(a),
    talentType: a.talentType,
    headline: r(a.headline),
    primaryRole: a.primaryRole,
    summary: r(a.summary),
    photoKey: a.photoKey,
    yearsExperience: a.yearsExperience,
    experienceLevel: a.experienceLevel,
    locationCountry: a.locationCountry,
    timezone: a.timezone,
    languages: a.languages,
    workSetup: a.workSetup,
    preferredShift: a.preferredShift,
    verificationLevel: a.verificationLevel,
    availabilityStatus: a.availabilityStatus,
    availableFrom: a.availableFrom,
    skills: a.skills.map((s) => ({ name: s.skill.name, category: s.skill.category, level: s.level, yearsUsed: s.yearsUsed, verified: !!s.verifiedById })),
    experiences: a.experiences.map((e) => ({ title: e.title, industry: e.industry, startDate: e.startDate, endDate: e.endDate, description: r(e.description), isCampaign: e.isCampaign, campaignType: e.campaignType })),
    industries: a.industryExperiences.map((i) => ({ industry: i.industry, years: i.years })),
    software: a.softwareExperiences.map((s) => ({ name: s.software.name, level: s.level })),
    videos: a.videos.filter((v) => v.status === "APPROVED" && mediaOk("video", v.id)).map((v) => ({ id: v.id, durationSec: v.durationSec })),
    recordings: a.recordings.filter((x) => x.status === "APPROVED" && mediaOk("recording", x.id)).map((x) => ({ id: x.id, kind: x.kind, title: x.title, durationSec: x.durationSec })),
    // Portfolio links and files reach a client only as an approved client-safe document (decision 3).
    portfolio: a.portfolioItems
      .filter((item) => item.status === "APPROVED" && (!client || safe?.portfolio.has(item.id)))
      .map((item) => ({ id: item.id, title: item.title, description: r(item.description), documentId: client ? safe?.portfolio.get(item.id) ?? null : null, link: client ? null : item.url })),
    documents: client ? safe?.documents ?? [] : [],
    // Academy (Section 6): approved certifications, the best assessment label, and a client-visible coach evaluation.
    certifications: certificationsForClient(a),
    assessment: assessmentSummaryForClient(a),
    coachEvaluation: coachEvaluationForClient(a),
    completedCourses: a.enrollments.filter((e) => e.status === "COMPLETED").map((e) => ({ title: e.course.title, category: e.course.category })),
    clientRate: clientRateFor(a),
  };
}

export type CandidateCardView = ReturnType<typeof toCandidateCardView> & { shortlisted?: boolean; tzDiffHours?: number | null };

/** Search result card: a subset of the client view. */
export function toCandidateCardView(a: AgentSelfRecord, opts: CandidateViewOptions = CLIENT_ONLY) {
  const client = opts.audience === "CLIENT";
  const r = redactor(a, opts);
  const safe = opts.clientSafe;
  return {
    id: a.id,
    name: client ? clientLabelOf(a) : a.displayName,
    partnerTeam: partnerTeamFor(a),
    headline: r(a.headline),
    primaryRole: a.primaryRole,
    photoKey: a.photoKey,
    yearsExperience: a.yearsExperience,
    experienceLevel: a.experienceLevel,
    locationCountry: a.locationCountry,
    timezone: a.timezone,
    languages: a.languages,
    workSetup: a.workSetup,
    verificationLevel: a.verificationLevel,
    availabilityStatus: a.availabilityStatus,
    availableFrom: a.availableFrom,
    approvedAt: a.approvedAt,
    skills: a.skills.slice(0, 6).map((s) => ({ name: s.skill.name, level: s.level })),
    industries: a.industryExperiences.map((i) => i.industry),
    hasVideo: a.videos.some((v) => v.status === "APPROVED" && (!client || !!safe?.videoIds.has(v.id))),
    approvedRecordings: a.recordings.filter((x) => x.status === "APPROVED" && (!client || !!safe?.recordingIds.has(x.id))).length,
    campaignExperience: a.experiences.some((e) => e.isCampaign),
    certifications: a.certifications.filter((c) => c.status === "APPROVED").map((c) => ({ name: c.template.name, badgeKey: c.template.badgeKey })),
    assessmentLabel: assessmentSummaryForClient(a)?.label ?? null,
    clientRate: clientRateFor(a),
  };
}

/** Recruiter and admin queue row. Includes login email (staff need it) but no password or MFA fields. */
export function toAgentStaffListView(a: { id: string; displayName: string; primaryRole: string | null; status: string; verificationLevel: string; availabilityStatus: string; profileCompletion: number; submittedAt: Date | null; createdAt: Date; user: { email: string }; skills: Array<{ skill: { name: string } }> }) {
  return {
    id: a.id,
    displayName: a.displayName,
    primaryRole: a.primaryRole,
    status: a.status,
    verificationLevel: a.verificationLevel,
    availabilityStatus: a.availabilityStatus,
    profileCompletion: a.profileCompletion,
    submittedAt: a.submittedAt,
    createdAt: a.createdAt,
    email: a.user.email,
    skills: a.skills.map((s) => s.skill.name),
  };
}
