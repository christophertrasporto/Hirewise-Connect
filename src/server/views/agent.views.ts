import type { Prisma } from "@/server/db/types";
import type { agentSelfInclude } from "@/server/repositories/agent.repository";

type AgentSelfRecord = Prisma.AgentProfileGetPayload<{ include: ReturnType<typeof agentSelfInclude> }>;

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
  };
}

export type CandidateClientView = ReturnType<typeof toCandidateClientView>;

/**
 * What a client may see (Section 6). Only APPROVED media, no private contact,
 * no review feedback, no internal notes. Rates and certifications join in later phases.
 */
export function toCandidateClientView(a: AgentSelfRecord) {
  return {
    id: a.id,
    displayName: a.displayName,
    headline: a.headline,
    primaryRole: a.primaryRole,
    summary: a.summary,
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
    experiences: a.experiences.map((e) => ({ title: e.title, industry: e.industry, startDate: e.startDate, endDate: e.endDate, description: e.description, isCampaign: e.isCampaign, campaignType: e.campaignType })),
    industries: a.industryExperiences.map((i) => ({ industry: i.industry, years: i.years })),
    software: a.softwareExperiences.map((s) => ({ name: s.software.name, level: s.level })),
    videos: a.videos.filter((v) => v.status === "APPROVED").map((v) => ({ id: v.id, durationSec: v.durationSec })),
    recordings: a.recordings.filter((r) => r.status === "APPROVED").map((r) => ({ id: r.id, kind: r.kind, title: r.title, durationSec: r.durationSec })),
    portfolio: a.portfolioItems.filter((p) => p.status === "APPROVED").map((p) => ({ id: p.id, title: p.title, description: p.description, url: p.url })),
  };
}

export type CandidateCardView = ReturnType<typeof toCandidateCardView> & { shortlisted?: boolean; tzDiffHours?: number | null };

/** Search result card for clients: the smallest client-safe subset. */
export function toCandidateCardView(a: AgentSelfRecord) {
  return {
    id: a.id,
    displayName: a.displayName,
    headline: a.headline,
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
    hasVideo: a.videos.some((v) => v.status === "APPROVED"),
    approvedRecordings: a.recordings.filter((r) => r.status === "APPROVED").length,
    campaignExperience: a.experiences.some((e) => e.isCampaign),
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
