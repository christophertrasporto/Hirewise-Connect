import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { agentRepository, type SearchWhere } from "@/server/repositories/agent.repository";
import { shortlistRepository } from "@/server/repositories/shortlist.repository";
import { clientRepository } from "@/server/repositories/client.repository";
import { toCandidateCardView, toCandidateClientView, type CandidateCardView } from "@/server/views/agent.views";
import { timezoneOffsetHours } from "@/lib/timezones";

const VERIFICATION_ORDER = ["PROFILE_SUBMITTED", "PROFILE_VERIFIED", "SKILLS_ASSESSED", "HIREWISE_CERTIFIED", "INTERVIEW_READY", "DEPLOYMENT_READY"] as const;
const AVAILABILITY_ORDER = ["AVAILABLE", "AVAILABLE_SOON", "INTERVIEWING", "RESERVED", "PAUSED", "PLACED", "UNAVAILABLE"] as const;

export const searchFiltersSchema = z.object({
  q: z.string().trim().max(120).optional(),
  role: z.string().trim().max(80).optional(),
  skills: z.array(z.string()).max(10).optional(),
  software: z.array(z.string()).max(10).optional(),
  industry: z.string().trim().max(80).optional(),
  level: z.array(z.enum(["ENTRY", "JUNIOR", "MID", "SENIOR", "LEAD"])).optional(),
  availability: z.array(z.enum(["AVAILABLE", "AVAILABLE_SOON", "INTERVIEWING", "RESERVED", "PLACED", "PAUSED"])).optional(),
  setup: z.enum(["REMOTE", "OFFICE", "HYBRID"]).optional(),
  languages: z.array(z.string()).max(5).optional(),
  verification: z.enum(VERIFICATION_ORDER).optional(),
  campaign: z.coerce.boolean().optional(),
  /** Maximum hour difference from the client's timezone; 0 disables. */
  tzWithin: z.coerce.number().int().min(0).max(12).optional(),
  sort: z.enum(["recommended", "newest", "experience"]).optional(),
});
export type SearchFilters = z.infer<typeof searchFiltersSchema>;

/**
 * Marketplace access (Section 14 Q2, GATED): an ACTIVE client, or staff with agent.read_public.
 * Returns the client's timezone for overlap calculations.
 */
export async function assertMarketplaceAccess(db: PrismaClient, actor: Actor): Promise<{ clientId: string | null; timezone: string | null }> {
  if (actor.role === "CLIENT") {
    if (!actor.clientId) throw new ForbiddenError("No client");
    const c = await clientRepository.findById(db, actor.clientId);
    if (!c) throw new NotFoundError();
    if (c.status !== "ACTIVE") throw new ForbiddenError("Your account is not active yet. Hirewise will notify you once it is.");
    return { clientId: c.id, timezone: c.timezone };
  }
  if (actor.permissions.has("agent.read_public")) return { clientId: null, timezone: null };
  throw new ForbiddenError("Marketplace access requires an active client account");
}

/**
 * Section 8.3 search. SQL narrows by structured filters; timezone overlap and the
 * default sort (verification, availability, recency) are applied in memory on the
 * capped result set. Every returned row is a client-safe card.
 */
export async function searchCandidates(db: PrismaClient, actor: Actor, filters: SearchFilters) {
  const access = await assertMarketplaceAccess(db, actor);
  const minVerification = filters.verification ? VERIFICATION_ORDER.slice(VERIFICATION_ORDER.indexOf(filters.verification)) : undefined;
  const where: SearchWhere = {
    text: filters.q || undefined,
    role: filters.role || undefined,
    skillIds: filters.skills?.length ? filters.skills : undefined,
    softwareIds: filters.software?.length ? filters.software : undefined,
    industry: filters.industry || undefined,
    experienceLevels: filters.level?.length ? filters.level : undefined,
    availability: filters.availability?.length ? filters.availability : ["AVAILABLE", "AVAILABLE_SOON"],
    workSetup: filters.setup,
    languages: filters.languages?.length ? filters.languages : undefined,
    minVerification: minVerification ? [...minVerification] : undefined,
    campaignOnly: filters.campaign || undefined,
  };
  const rows = await agentRepository.searchApproved(db, where);
  const shortlisted = access.clientId ? new Set((await shortlistRepository.activeAgentIds(db, access.clientId)).map((s) => s.agentProfileId)) : new Set<string>();
  const clientOffset = access.timezone ? timezoneOffsetHours(access.timezone) : null;

  let cards: CandidateCardView[] = rows.map((r) => {
    const card = toCandidateCardView(r);
    const agentOffset = r.timezone ? timezoneOffsetHours(r.timezone) : null;
    const tzDiff = clientOffset !== null && agentOffset !== null ? Math.abs(clientOffset - agentOffset) : null;
    return { ...card, shortlisted: shortlisted.has(r.id), tzDiffHours: tzDiff === null ? null : Math.min(tzDiff, 24 - tzDiff) };
  });

  if (filters.tzWithin && clientOffset !== null) cards = cards.filter((c) => c.tzDiffHours != null && c.tzDiffHours <= (filters.tzWithin ?? 0));

  const sort = filters.sort ?? "recommended";
  cards.sort((a, b) => {
    if (sort === "experience") return (b.yearsExperience ?? 0) - (a.yearsExperience ?? 0);
    if (sort === "newest") return (b.approvedAt?.getTime() ?? 0) - (a.approvedAt?.getTime() ?? 0);
    const v = VERIFICATION_ORDER.indexOf(b.verificationLevel) - VERIFICATION_ORDER.indexOf(a.verificationLevel);
    if (v !== 0) return v;
    const av = AVAILABILITY_ORDER.indexOf(a.availabilityStatus) - AVAILABILITY_ORDER.indexOf(b.availabilityStatus);
    if (av !== 0) return av;
    return (b.approvedAt?.getTime() ?? 0) - (a.approvedAt?.getTime() ?? 0);
  });

  return { cards, total: cards.length, clientTimezone: access.timezone };
}

/** Candidate profile for a client. Records the view and the introduction (Section 8.3). */
export async function getCandidateForClient(db: PrismaClient, actor: Actor, agentProfileId: string) {
  const access = await assertMarketplaceAccess(db, actor);
  const p = await agentRepository.findApprovedById(db, agentProfileId);
  if (!p) throw new NotFoundError();
  let shortlisted = false;
  if (access.clientId) {
    await shortlistRepository.recordView(db, access.clientId, p.id);
    await shortlistRepository.upsertIntroduction(db, access.clientId, p.id, "VIEW");
    const list = await shortlistRepository.defaultForClient(db, access.clientId, actor.userId);
    shortlisted = !!(await shortlistRepository.activeEntry(db, list.id, p.id));
  }
  return { candidate: toCandidateClientView(p), shortlisted };
}

/** Client dashboard: newest approved candidates matching the client's requested services. */
export async function recommendedForClient(db: PrismaClient, actor: Actor, take = 6) {
  if (actor.role !== "CLIENT" || !actor.clientId) return [];
  const c = await clientRepository.findById(db, actor.clientId);
  if (!c || c.status !== "ACTIVE") return [];
  const roles = c.onboarding?.servicesNeeded ?? [];
  const rows = await agentRepository.searchApproved(db, { availability: ["AVAILABLE", "AVAILABLE_SOON"] }, 60);
  const scored = rows
    .map((r) => {
      const hay = `${r.primaryRole ?? ""} ${r.skills.map((s) => s.skill.name).join(" ")}`.toLowerCase();
      const score = roles.reduce((n, svc) => n + (hay.includes(svc.toLowerCase()) ? 1 : 0), 0);
      return { r, score };
    })
    .sort((a, b) => b.score - a.score || (b.r.approvedAt?.getTime() ?? 0) - (a.r.approvedAt?.getTime() ?? 0))
    .slice(0, take);
  return scored.map(({ r }) => toCandidateCardView(r));
}

export async function recentlyViewedForClient(db: PrismaClient, actor: Actor, take = 6) {
  if (actor.role !== "CLIENT" || !actor.clientId) return [];
  const rows = await shortlistRepository.recentlyViewed(db, actor.clientId, take);
  return rows.filter((v) => v.agentProfile.status === "APPROVED").map((v) => toCandidateCardView(v.agentProfile));
}
