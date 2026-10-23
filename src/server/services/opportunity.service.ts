import { z } from "zod";
import { seedRequirementsFromSkills, unmetRequirements, opportunityRequirements } from "@/server/services/skills.service";
import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { systemActor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { assertAgencyScope, requireActiveAgency } from "@/server/policies/ownership";
import { opportunityRepository, type OpportunityRecord } from "@/server/repositories/opportunity.repository";
import { requirementRepository } from "@/server/repositories/requirement.repository";
import { clientRepository } from "@/server/repositories/client.repository";
import { interviewRepository } from "@/server/repositories/interview.repository";
import { shortlistRepository } from "@/server/repositories/shortlist.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { getSetting } from "@/server/services/setting.service";
import { ensureRequestThread } from "@/server/services/thread.service";
import { clientSafeContextFor } from "@/server/services/client-safe-document.service";
import { assertMarketplaceAccess } from "@/server/services/search.service";
import { maskedClientLabel } from "@/lib/client-redaction";
import { toCandidateCardView } from "@/server/views/agent.views";
import { toOpportunityAgencyView, toOpportunityAgentView, toOpportunityClientView, toOpportunityStaffView, toSubmissionStaffView } from "@/server/views/opportunity.views";

/**
 * Opportunities and submissions (v2 phase 6b, feature 12). Hirewise publishes a client requirement to agencies and
 * direct talent with the client masked; eligible agents are submitted (by their agency, or by themselves when
 * direct); Hirewise reviews; approved candidates reach the client, who requests interviews from the opportunity.
 * Agency A never sees agency B's submissions. An agent with an active membership cannot submit themselves.
 */

export const publishSchema = z.object({
  requirementId: z.string().min(1, "Choose a requirement."),
  visibility: z.enum(["ALL_AGENCIES", "SELECTED_AGENCIES", "DIRECT_ONLY"]).default("ALL_AGENCIES"),
  agencyIds: z.array(z.string().min(1)).default([]),
  roleSummary: z.string().trim().max(2000).optional().or(z.literal("")),
  headcount: z.coerce.number().int().min(1).max(500).optional(),
});

export const submitSchema = z.object({
  opportunityId: z.string().min(1),
  agentProfileId: z.string().min(1, "Choose an agent."),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const interviewFromOpportunitySchema = z.object({
  opportunityId: z.string().min(1),
  agentProfileIds: z.array(z.string().min(1)).min(1, "Choose at least one candidate.").max(6),
  timezone: z.string().trim().min(2).max(80),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  requestedWindows: z.string().trim().max(1000).optional().or(z.literal("")),
});

// ---------------------------------------------------------------------------
// Hirewise: publish, close, review
// ---------------------------------------------------------------------------

export async function publishOpportunity(db: PrismaClient, actor: Actor, raw: z.input<typeof publishSchema>) {
  authorize(actor, "opportunity.manage");
  const input = publishSchema.parse(raw);
  const req = await requirementRepository.findById(db, input.requirementId);
  if (!req) throw new NotFoundError();
  if (req.status === "CLOSED" || req.status === "FILLED") throw new Error("This requirement is closed.");
  if (await opportunityRepository.findByRequirement(db, req.id)) throw new Error("This requirement is already published as an opportunity.");
  if (input.visibility === "SELECTED_AGENCIES" && input.agencyIds.length === 0) throw new Error("Choose at least one agency for a selected-agencies opportunity.");
  const client = await clientRepository.findById(db, req.clientId);
  if (!client) throw new NotFoundError();
  const names = await opportunityRepository.resolveNames(db, req.skills, req.software);
  return db.$transaction(async (tx) => {
    const o = await opportunityRepository.create(tx, {
      requirementId: req.id,
      clientId: req.clientId,
      title: req.title,
      roleSummary: input.roleSummary || req.jobDescription || req.role,
      maskedClientLabel: maskedClientLabel({ industry: client.industry, country: client.country }),
      skills: names.skills,
      software: names.software,
      industry: req.industry,
      experienceLevel: req.experienceLevel,
      schedule: req.schedule,
      timezone: req.timezone,
      startDate: req.startDate,
      headcount: input.headcount ?? req.agentsRequired,
      visibility: input.visibility,
      publishedById: actor.userId,
      agencyIds: input.visibility === "SELECTED_AGENCIES" ? [...new Set(input.agencyIds)] : [],
    });
    if (req.status === "OPEN") await requirementRepository.setStatus(tx, req.id, "IN_PROGRESS");
    await audit(tx, { actor, action: "OPPORTUNITY_PUBLISHED", entityType: "Opportunity", entityId: o.id, newValue: { requirementId: req.id, visibility: input.visibility, agencyIds: o.agencies.map((a) => a.agencyId), headcount: o.headcount } });
    await seedRequirementsFromSkills(tx, o.id, req.skills);
    await publishEvent(tx, "OPPORTUNITY_PUBLISHED", { opportunityId: o.id, title: o.title, visibility: o.visibility, agencyIds: o.agencies.map((a) => a.agencyId) });
    return toOpportunityStaffView(o);
  });
}

export async function closeOpportunity(db: PrismaClient, actor: Actor, id: string, status: "FILLED" | "CLOSED", reason: string) {
  authorize(actor, "opportunity.manage");
  const o = await opportunityRepository.findById(db, id);
  if (!o) throw new NotFoundError();
  if (o.status === "FILLED" || o.status === "CLOSED") throw new Error("This opportunity is already closed.");
  if (!reason.trim()) throw new Error("A reason is required.");
  return db.$transaction(async (tx) => {
    const u = await opportunityRepository.setStatus(tx, o.id, status, { closedReason: reason.trim() });
    for (const s of o.submissions.filter((x) => x.status === "PENDING_REVIEW" || x.status === "APPROVED_FOR_CLIENT")) {
      await opportunityRepository.updateSubmission(tx, s.id, { status: "WITHDRAWN", withdrawnReason: `Opportunity ${status.toLowerCase()}: ${reason.trim()}` });
    }
    if (status === "FILLED") await requirementRepository.setStatus(tx, o.requirementId, "FILLED");
    await audit(tx, { actor, action: "OPPORTUNITY_CLOSED", entityType: "Opportunity", entityId: o.id, previousValue: { status: o.status }, newValue: { status }, reason: reason.trim() });
    return toOpportunityStaffView(u);
  });
}

export async function listOpportunitiesForStaff(db: PrismaClient, actor: Actor, status?: "OPEN" | "INTERVIEWING" | "FILLED" | "CLOSED") {
  if (!actor.permissions.has("opportunity.manage")) authorize(actor, "requirement.read");
  return (await opportunityRepository.listForStaff(db, status)).map(toOpportunityStaffView);
}

export async function getOpportunityForStaff(db: PrismaClient, actor: Actor, id: string) {
  if (!actor.permissions.has("opportunity.manage")) authorize(actor, "requirement.read");
  const o = await opportunityRepository.findById(db, id);
  if (!o) throw new NotFoundError();
  return { ...toOpportunityStaffView(o), requirements: await opportunityRequirements(db, o.id) };
}

export async function reviewSubmission(db: PrismaClient, actor: Actor, submissionId: string, decision: "APPROVE" | "DECLINE", note?: string) {
  authorize(actor, "opportunity.manage");
  const s = await opportunityRepository.findSubmission(db, submissionId);
  if (!s) throw new NotFoundError();
  if (s.status !== "PENDING_REVIEW") throw new Error("Only pending submissions can be reviewed.");
  const reviewNote = note?.trim() || null;
  if (decision === "DECLINE" && !reviewNote) throw new Error("A note is required to decline.");
  const status = decision === "APPROVE" ? "APPROVED_FOR_CLIENT" : "DECLINED";
  return db.$transaction(async (tx) => {
    const u = await opportunityRepository.updateSubmission(tx, s.id, { status, reviewNote, reviewedById: actor.userId, reviewedAt: new Date() });
    await audit(tx, { actor, action: "SUBMISSION_REVIEWED", entityType: "Submission", entityId: s.id, previousValue: { status: s.status }, newValue: { status }, reason: reviewNote ?? undefined });
    if (status === "APPROVED_FOR_CLIENT") await shortlistRepository.upsertIntroduction(tx, s.opportunity.clientId, s.agentProfileId, "SHORTLIST");
    await publishEvent(tx, "SUBMISSION_REVIEWED", { submissionId: s.id, opportunityId: s.opportunityId, title: s.opportunity.title, outcome: status, submitterUserId: s.submittedById, agentUserId: s.agentProfile.userId, displayName: s.agentProfile.displayName, clientUserId: status === "APPROVED_FOR_CLIENT" ? (s.opportunity.client.contacts[0]?.userId ?? null) : null, note: reviewNote });
    return toSubmissionStaffView(u);
  });
}

// ---------------------------------------------------------------------------
// Agencies and talent: browse and submit
// ---------------------------------------------------------------------------

type Eligibility = { eligible: boolean; reason: string | null };

async function eligibilityFor(db: Db, p: { status: string; availabilityStatus: string; certifications: number; assessments: number }, membership: "AGENCY" | "DIRECT"): Promise<Eligibility> {
  const s = await getSetting(db, "opportunities");
  if (p.status !== "APPROVED") return { eligible: false, reason: "Profile is not approved for the marketplace." };
  if (!["AVAILABLE", "AVAILABLE_SOON"].includes(p.availabilityStatus)) return { eligible: false, reason: `Availability is ${p.availabilityStatus.toLowerCase().replace(/_/g, " ")}.` };
  if (s.requireActiveCredentials && p.certifications + p.assessments === 0) return { eligible: false, reason: "No active certification or final assessment yet (agency-sponsored items revoked at exit do not count)." };
  void membership;
  return { eligible: true, reason: null };
}

/** Open opportunities for the actor's agency, each with the agency's own submissions and the members it could submit. */
export async function listOpportunitiesForAgency(db: PrismaClient, actor: Actor) {
  authorize(actor, "agency.opportunities.read");
  const agencyId = requireActiveAgency(actor);
  const [rows, members] = await Promise.all([opportunityRepository.listForAgency(db, agencyId), opportunityRepository.agencyMembersForSubmission(db, agencyId)]);
  const eligibleMembers = await Promise.all(members.filter((m) => m.status === "ACTIVE").map(async (m) => ({ id: m.agentProfile.id, displayName: m.agentProfile.displayName, primaryRole: m.agentProfile.primaryRole, availabilityStatus: m.agentProfile.availabilityStatus, verificationLevel: m.agentProfile.verificationLevel, activeCertifications: m.agentProfile._count.certifications, finalAssessments: m.agentProfile._count.assessments, ...(await eligibilityFor(db, { status: m.agentProfile.status, availabilityStatus: m.agentProfile.availabilityStatus, certifications: m.agentProfile._count.certifications, assessments: m.agentProfile._count.assessments }, "AGENCY")) })));
  const settings = await getSetting(db, "opportunities");
  // Skills system: per opportunity, which requirements each eligible member still misses.
  const requirements: Record<string, Awaited<ReturnType<typeof opportunityRequirements>>> = {};
  const unmet: Record<string, Record<string, string[]>> = {};
  for (const o of rows) {
    requirements[o.id] = await opportunityRequirements(db, o.id);
    unmet[o.id] = {};
    if (requirements[o.id].length) for (const m of eligibleMembers) unmet[o.id][m.id] = await unmetRequirements(db, m.id, o.id);
  }
  return { opportunities: rows.map((o) => ({ ...toOpportunityAgencyView(o, agencyId), requirements: requirements[o.id] })), members: eligibleMembers, unmet, maxSubmissionsPerAgency: settings.maxSubmissionsPerAgency };
}

export async function agencySubmissions(db: PrismaClient, actor: Actor, agencyId?: string) {
  const id = agencyId ?? actor.agency?.id;
  if (!id) throw new NotFoundError();
  assertAgencyScope(actor, id, "agency.read");
  if (!actor.permissions.has("agency.read")) authorize(actor, "agency.opportunities.read");
  return (await opportunityRepository.submissionsForAgency(db, id)).map((s) => ({ ...toSubmissionStaffView(s), opportunity: { id: s.opportunity.id, title: s.opportunity.title, status: s.opportunity.status, clientLabel: s.opportunity.maskedClientLabel } }));
}

/** Open opportunities for direct and independent talent, with the agent's own submissions. Agency agents see only what their agency submitted for them. */
export async function listOpportunitiesForAgent(db: PrismaClient, actor: Actor) {
  if (actor.role !== "AGENT" || !actor.agentProfileId) return { opportunities: [], agencyAgent: false, eligibility: null as Eligibility | null };
  const facts = await opportunityRepository.profileFacts(db, actor.agentProfileId);
  if (!facts) return { opportunities: [], agencyAgent: false, eligibility: null as Eligibility | null };
  const agencyAgent = facts.agencyMemberships.length > 0 || !!facts.primaryAgencyId;
  if (agencyAgent) {
    const mine = await opportunityRepository.submissionsForAgent(db, actor.agentProfileId);
    return { opportunities: mine.map((s) => toOpportunityAgentView(s.opportunity, actor.agentProfileId!)), agencyAgent: true, eligibility: null as Eligibility | null };
  }
  const rows = await opportunityRepository.listForDirectTalent(db);
  const eligibility = await eligibilityFor(db, { status: facts.status, availabilityStatus: facts.availabilityStatus, certifications: facts._count.certifications, assessments: facts._count.assessments }, "DIRECT");
  return { opportunities: rows.map((o) => toOpportunityAgentView(o, actor.agentProfileId!)), agencyAgent: false, eligibility };
}

/** An agency submits a member, or direct talent submits themselves. Exclusivity: agency agents never self-submit. */
export async function submitAgent(db: PrismaClient, actor: Actor, raw: z.input<typeof submitSchema>) {
  const input = submitSchema.parse(raw);
  const o = await opportunityRepository.findById(db, input.opportunityId);
  if (!o) throw new NotFoundError();
  if (o.status !== "OPEN" && o.status !== "INTERVIEWING") throw new Error("This opportunity is no longer open for submissions.");
  const facts = await opportunityRepository.profileFacts(db, input.agentProfileId);
  if (!facts) throw new NotFoundError();
  const settings = await getSetting(db, "opportunities");
  let agencyId: string | null = null;
  if (actor.role === "AGENT") {
    if (actor.agentProfileId !== facts.id) throw new NotFoundError();
    if (facts.agencyMemberships.length > 0 || facts.primaryAgencyId) throw new ForbiddenError("Your agency submits you to opportunities. Ask your agency owner.");
    if (o.visibility === "SELECTED_AGENCIES") throw new NotFoundError();
  } else {
    authorize(actor, "agency.submissions.create");
    agencyId = requireActiveAgency(actor);
    if (o.visibility === "DIRECT_ONLY") throw new NotFoundError();
    if (o.visibility === "SELECTED_AGENCIES" && !o.agencies.some((a) => a.agencyId === agencyId)) throw new NotFoundError();
    const active = facts.agencyMemberships.find((m) => m.agencyId === agencyId && m.status === "ACTIVE");
    if (!active) throw new NotFoundError("This agent is not an active member of your agency.");
  }
  const eligibility = await eligibilityFor(db, { status: facts.status, availabilityStatus: facts.availabilityStatus, certifications: facts._count.certifications, assessments: facts._count.assessments }, agencyId ? "AGENCY" : "DIRECT");
  if (!eligibility.eligible) throw new Error(eligibility.reason ?? "Not eligible.");
  const missing = await unmetRequirements(db, facts.id, o.id);
  if (missing.length) throw new Error(`Requirements not met: ${missing.join("; ")}.`);
  if (await opportunityRepository.openSubmission(db, o.id, facts.id)) throw new Error("This agent already has an open submission on this opportunity.");
  if (agencyId) {
    const open = await opportunityRepository.countOpenForAgency(db, o.id, agencyId);
    if (open >= settings.maxSubmissionsPerAgency) throw new Error(`Your agency already has ${open} open submission(s) on this opportunity (limit ${settings.maxSubmissionsPerAgency}).`);
  }
  return db.$transaction(async (tx) => {
    const s = await opportunityRepository.createSubmission(tx, { opportunityId: o.id, agentProfileId: facts.id, agencyId, submittedById: actor.userId, note: input.note || null });
    await audit(tx, { actor, action: "SUBMISSION_CREATED", entityType: "Submission", entityId: s.id, newValue: { opportunityId: o.id, agentProfileId: facts.id, agencyId } });
    await publishEvent(tx, "SUBMISSION_CREATED", { submissionId: s.id, opportunityId: o.id, title: o.title, agencyName: s.agency?.name ?? null, displayName: facts.displayName, accountManagerUserId: o.client.accountManagerUserId });
    return { id: s.id, status: s.status };
  });
}

/** The submitter (agency or direct talent) or staff withdraws an open submission. */
export async function withdrawSubmission(db: PrismaClient, actor: Actor, submissionId: string, reason: string) {
  const s = await opportunityRepository.findSubmission(db, submissionId);
  if (!s) throw new NotFoundError();
  const staff = actor.permissions.has("opportunity.manage");
  if (!staff) {
    if (s.agencyId) {
      if (actor.agency?.id !== s.agencyId) throw new NotFoundError();
      authorize(actor, "agency.submissions.create");
    } else if (actor.role !== "AGENT" || actor.agentProfileId !== s.agentProfileId) throw new NotFoundError();
  }
  if (!["PENDING_REVIEW", "APPROVED_FOR_CLIENT"].includes(s.status)) throw new Error("Only pending or approved submissions can be withdrawn.");
  if (!reason.trim()) throw new Error("A reason is required.");
  await db.$transaction(async (tx) => {
    await opportunityRepository.updateSubmission(tx, s.id, { status: "WITHDRAWN", withdrawnReason: reason.trim() });
    await audit(tx, { actor, action: "SUBMISSION_WITHDRAWN", entityType: "Submission", entityId: s.id, previousValue: { status: s.status }, reason: reason.trim() });
    await publishEvent(tx, "SUBMISSION_WITHDRAWN", { submissionId: s.id, opportunityId: s.opportunityId, title: s.opportunity.title, displayName: s.agentProfile.displayName, agencyName: s.agency?.name ?? null, reason: reason.trim(), accountManagerUserId: s.opportunity.client.accountManagerUserId, byExit: false });
  });
}

/** Exit action (phase 3 spec item): open submissions of the leaving agent made by that agency are withdrawn; Hirewise is notified. */
export async function withdrawSubmissionsOnExit(db: Db, p: { agentProfileId: string; agencyId: string; agencyName: string; displayName: string; reason: string }) {
  const actor = systemActor();
  const open = await opportunityRepository.openSubmissionsForAgent(db, p.agentProfileId, p.agencyId);
  for (const s of open) {
    await opportunityRepository.updateSubmission(db, s.id, { status: "WITHDRAWN", withdrawnReason: `Agency membership ended: ${p.reason}` });
    await audit(db, { actor, action: "SUBMISSION_WITHDRAWN", entityType: "Submission", entityId: s.id, previousValue: { status: s.status }, reason: `Agency membership ended: ${p.reason}` });
    await publishEvent(db, "SUBMISSION_WITHDRAWN", { submissionId: s.id, opportunityId: s.opportunityId, title: s.opportunity.title, displayName: p.displayName, agencyName: p.agencyName, reason: `Agency membership ended: ${p.reason}`, accountManagerUserId: s.opportunity.client.accountManagerUserId, byExit: true });
  }
  return open.length;
}

// ---------------------------------------------------------------------------
// Clients: see approved candidates and request interviews
// ---------------------------------------------------------------------------

async function clientCandidates(db: Db, o: OpportunityRecord) {
  const profiles = await opportunityRepository.approvedCandidateProfiles(db, o.id);
  const safe = await clientSafeContextFor(db, profiles.map((p) => p.id));
  const statusOf = new Map(o.submissions.map((s) => [s.agentProfileId, s.status]));
  return profiles.map((p) => ({ ...toCandidateCardView(p, { audience: "CLIENT", clientSafe: safe.get(p.id) }), submissionStatus: statusOf.get(p.id) ?? null }));
}

export async function listOpportunitiesForClient(db: PrismaClient, actor: Actor) {
  const access = await assertMarketplaceAccess(db, actor);
  if (!access.clientId) throw new ForbiddenError("Only clients see their opportunities");
  return (await opportunityRepository.listForClient(db, access.clientId)).map(toOpportunityClientView);
}

export async function getOpportunityForClient(db: PrismaClient, actor: Actor, id: string) {
  const access = await assertMarketplaceAccess(db, actor);
  if (!access.clientId) throw new ForbiddenError("Only clients see their opportunities");
  const o = await opportunityRepository.findById(db, id);
  if (!o || o.clientId !== access.clientId) throw new NotFoundError();
  return { opportunity: { ...toOpportunityClientView(o), requirements: await opportunityRequirements(db, o.id) }, candidates: await clientCandidates(db, o) };
}

/** The client requests interviews with approved candidates on their opportunity (no shortlist needed). */
export async function requestInterviewsFromOpportunity(db: PrismaClient, actor: Actor, raw: z.input<typeof interviewFromOpportunitySchema>) {
  const input = interviewFromOpportunitySchema.parse(raw);
  const access = await assertMarketplaceAccess(db, actor);
  if (!access.clientId) throw new ForbiddenError("Only clients request interviews");
  const o = await opportunityRepository.findById(db, input.opportunityId);
  if (!o || o.clientId !== access.clientId) throw new NotFoundError();
  const approved = o.submissions.filter((s) => s.status === "APPROVED_FOR_CLIENT" && input.agentProfileIds.includes(s.agentProfileId));
  if (approved.length === 0) throw new Error("Choose candidates Hirewise has approved for you.");
  const client = await clientRepository.findById(db, access.clientId);
  return db.$transaction(async (tx) => {
    const r = await interviewRepository.createRequest(tx, {
      clientId: access.clientId!,
      requirementId: o.requirementId,
      requestedById: actor.userId,
      preferredDate: null,
      preferredTime: null,
      timezone: input.timezone,
      notes: input.notes || null,
      role: o.title,
      schedule: o.schedule,
      targetStartDate: o.startDate,
      assignedSalesUserId: client?.accountManagerUserId ?? null,
      candidateIds: approved.map((s) => s.agentProfileId),
      requestedWindows: (input.requestedWindows ?? "").split(/\n/).map((w) => w.trim()).filter(Boolean).slice(0, 10),
    });
    await ensureRequestThread(tx, actor, r.id);
    for (const s of approved) {
      await opportunityRepository.updateSubmission(tx, s.id, { status: "INTERVIEWING", interviewRequestId: r.id });
      await shortlistRepository.upsertIntroduction(tx, access.clientId!, s.agentProfileId, "INTERVIEW");
    }
    if (o.status === "OPEN") await opportunityRepository.setStatus(tx, o.id, "INTERVIEWING");
    await audit(tx, { actor, action: "INTERVIEW_REQUESTED", entityType: "InterviewRequest", entityId: r.id, newValue: { opportunityId: o.id, candidates: approved.map((s) => s.agentProfileId), role: o.title } });
    await publishEvent(tx, "INTERVIEW_REQUESTED", { requestId: r.id, clientId: access.clientId!, companyName: client?.companyName ?? "Client", accountManagerUserId: client?.accountManagerUserId ?? null, candidateCount: approved.length, role: o.title });
    return r.id;
  });
}

/** Called from the interview decision flow: a selected or rejected candidate's submission follows the outcome. */
export async function syncSubmissionOutcomeTx(tx: Db, actor: Actor, p: { interviewRequestId: string; agentProfileId: string; decision: "SELECTED" | "NOT_SELECTED" }) {
  for (const s of await opportunityRepository.submissionsForRequest(tx, p.interviewRequestId, p.agentProfileId)) {
    await opportunityRepository.updateSubmission(tx, s.id, { status: p.decision });
    await audit(tx, { actor, action: "SUBMISSION_REVIEWED", entityType: "Submission", entityId: s.id, previousValue: { status: s.status }, newValue: { status: p.decision }, reason: "Client decision" });
  }
}

export async function pendingSubmissionCount(db: Db) {
  return opportunityRepository.countPendingReview(db);
}
