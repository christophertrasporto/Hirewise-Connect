import { z } from "zod";
import type { PrismaClient, Tx } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { interviewRepository } from "@/server/repositories/interview.repository";
import { shortlistRepository } from "@/server/repositories/shortlist.repository";
import { agentRepository } from "@/server/repositories/agent.repository";
import { requirementRepository } from "@/server/repositories/requirement.repository";
import { jobRepository } from "@/server/repositories/job.repository";
import { clientRepository } from "@/server/repositories/client.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { assertRequestTransition, OPEN_REQUEST_STATUSES, type InterviewRequestStatus } from "@/server/state/interview-request";
import { toRequestAgentView, toRequestClientView, toRequestStaffView, type RequestRecord } from "@/server/views/interview.views";
import { assertMarketplaceAccess } from "./search.service";
import { createPlacementFromSelection } from "./placement.service";
import { reserveForClient } from "./reservation.service";

// ---------------------------------------------------------------------------
// Create (Section 8.5)
// ---------------------------------------------------------------------------

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const interviewRequestSchema = z.object({
  candidateIds: z.array(z.string().min(1)).min(1, "Choose at least one shortlisted candidate.").max(6, "Up to six candidates per request."),
  requirementId: optionalText(40),
  preferredDate: optionalText(20),
  preferredTime: optionalText(40),
  timezone: z.string().trim().min(2).max(80),
  notes: optionalText(2000),
  role: z.string().trim().min(2, "Role is required.").max(80),
  schedule: optionalText(200),
  targetStartDate: optionalText(20),
});
export type InterviewRequestInput = z.infer<typeof interviewRequestSchema>;

export async function createInterviewRequest(db: PrismaClient, actor: Actor, input: InterviewRequestInput) {
  const access = await assertMarketplaceAccess(db, actor);
  if (!access.clientId) throw new ForbiddenError("Only clients request interviews");
  const clientId = access.clientId;
  // Candidates must be on the client's active shortlist and approved (Section 8.5).
  const shortlisted = new Set((await shortlistRepository.activeAgentIds(db, clientId)).map((s) => s.agentProfileId));
  const approved = await agentRepository.findManyApproved(db, input.candidateIds);
  const ids = approved.filter((a) => shortlisted.has(a.id)).map((a) => a.id);
  if (ids.length === 0) throw new NotFoundError("Choose candidates from your shortlist");
  if (input.requirementId) {
    const req = await requirementRepository.findById(db, input.requirementId);
    if (!req || req.clientId !== clientId) throw new NotFoundError("Requirement not found");
  }
  const client = await clientRepository.findById(db, clientId);

  const created = await db.$transaction(async (tx) => {
    const r = await interviewRepository.createRequest(tx, {
      clientId,
      requirementId: input.requirementId || null,
      requestedById: actor.userId,
      preferredDate: input.preferredDate ? new Date(input.preferredDate) : null,
      preferredTime: input.preferredTime || null,
      timezone: input.timezone,
      notes: input.notes || null,
      role: input.role,
      schedule: input.schedule || null,
      targetStartDate: input.targetStartDate ? new Date(input.targetStartDate) : null,
      assignedSalesUserId: client?.accountManagerUserId ?? null,
      candidateIds: ids,
    });
    for (const id of ids) await shortlistRepository.upsertIntroduction(tx, clientId, id, "INTERVIEW");
    if (input.requirementId) await requirementRepository.setStatus(tx, input.requirementId, "IN_PROGRESS");
    await audit(tx, { actor, action: "INTERVIEW_REQUESTED", entityType: "InterviewRequest", entityId: r.id, newValue: { candidates: ids, role: input.role } });
    await publishEvent(tx, "INTERVIEW_REQUESTED", { requestId: r.id, clientId, companyName: client?.companyName ?? "Client", accountManagerUserId: client?.accountManagerUserId ?? null, candidateCount: ids.length, role: input.role });
    return r;
  });
  return created.id;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function loadRequest(db: PrismaClient | Tx, id: string): Promise<RequestRecord> {
  const r = await interviewRepository.findRequest(db, id);
  if (!r) throw new NotFoundError();
  return r;
}

function assertStaffOrOwner(actor: Actor, r: RequestRecord, permission: "interview.read_all" | "interview.coordinate" | "interview.schedule") {
  if (actor.role === "CLIENT") {
    if (actor.clientId !== r.clientId) throw new NotFoundError();
    return "CLIENT" as const;
  }
  if (actor.role === "AGENT") {
    if (!r.candidates.some((c) => c.agentProfileId === actor.agentProfileId)) throw new NotFoundError();
    return "AGENT" as const;
  }
  authorize(actor, permission);
  return "STAFF" as const;
}

export async function getRequest(db: PrismaClient, actor: Actor, id: string) {
  const r = await loadRequest(db, id);
  const who = assertStaffOrOwner(actor, r, "interview.read_all");
  if (who === "CLIENT") return { audience: who, request: toRequestClientView(r) };
  if (who === "AGENT") return { audience: who, request: toRequestAgentView(r, actor.agentProfileId!) };
  return { audience: who, request: toRequestStaffView(r, { canPrivateContact: actor.permissions.has("agent.read_private_contact") }) };
}

export async function listRequestsForClient(db: PrismaClient, actor: Actor) {
  if (actor.role !== "CLIENT" || !actor.clientId) return [];
  return (await interviewRepository.listForClient(db, actor.clientId)).map(toRequestClientView);
}

export async function listRequestsForAgent(db: PrismaClient, actor: Actor) {
  if (actor.role !== "AGENT" || !actor.agentProfileId) return [];
  return (await interviewRepository.listForAgent(db, actor.agentProfileId)).map((r) => toRequestAgentView(r, actor.agentProfileId!));
}

export async function listRequestsForStaff(db: PrismaClient, actor: Actor, filter: "open" | "mine" | "all" | InterviewRequestStatus = "open") {
  authorize(actor, "interview.read_all");
  const where = filter === "open" ? { status: [...OPEN_REQUEST_STATUSES] } : filter === "mine" ? { assignedSalesUserId: actor.userId } : filter === "all" ? {} : { status: [filter] };
  const rows = await interviewRepository.listForStaff(db, where);
  const canPrivate = actor.permissions.has("agent.read_private_contact");
  return rows.map((r) => toRequestStaffView(r, { canPrivateContact: canPrivate }));
}

// ---------------------------------------------------------------------------
// Workflow (Section 5.4)
// ---------------------------------------------------------------------------

async function move(tx: Tx, actor: Actor, r: RequestRecord, to: InterviewRequestStatus, opts: { reason?: string; system?: boolean; extra?: { assignedSalesUserId?: string; cancelledReason?: string } } = {}) {
  assertRequestTransition(actor, { status: r.status as InterviewRequestStatus, clientId: r.clientId }, to, opts.reason, opts.system);
  await interviewRepository.setStatus(tx, r.id, to, opts.extra ?? {});
  await audit(tx, { actor, action: "INTERVIEW_REQUEST_STATUS_CHANGED", entityType: "InterviewRequest", entityId: r.id, previousValue: { status: r.status }, newValue: { status: to }, reason: opts.reason });
}

/** Sales picks up a request. Assigns themselves when no account manager exists. */
export async function startSalesReview(db: PrismaClient, actor: Actor, id: string) {
  const r = await loadRequest(db, id);
  assertStaffOrOwner(actor, r, "interview.coordinate");
  await db.$transaction(async (tx) => {
    await move(tx, actor, r, "SALES_REVIEW", { extra: { assignedSalesUserId: r.assignedSalesUserId ?? actor.userId } });
  });
}

/** Sales proposes times to the client (mediated message) and hands over for confirmation. */
export async function proposeSlots(db: PrismaClient, actor: Actor, id: string, message: string) {
  const r = await loadRequest(db, id);
  assertStaffOrOwner(actor, r, "interview.coordinate");
  const body = message.trim();
  if (body.length < 5) throw new Error("Describe the proposed times.");
  await db.$transaction(async (tx) => {
    await interviewRepository.createMessage(tx, { interviewRequestId: r.id, authorUserId: actor.userId, authorRole: actor.role, body, visibleTo: "CLIENT_AND_HIREWISE", heldForReview: false });
    await move(tx, actor, r, "CLIENT_CONFIRMATION");
    const contactUserId = r.client.contacts[0]?.userId;
    if (contactUserId) await publishEvent(tx, "INTERVIEW_SLOTS_PROPOSED", { requestId: r.id, userId: contactUserId, email: r.client.contacts[0]!.businessEmail, role: r.role, audience: "CLIENT" });
  });
}

/** The client confirms the proposed times; candidates are then asked to confirm. */
export async function clientConfirmSlots(db: PrismaClient, actor: Actor, id: string, message?: string) {
  const r = await loadRequest(db, id);
  if (assertStaffOrOwner(actor, r, "interview.coordinate") === "AGENT") throw new ForbiddenError("Not allowed");
  await db.$transaction(async (tx) => {
    if (message?.trim()) await interviewRepository.createMessage(tx, { interviewRequestId: r.id, authorUserId: actor.userId, authorRole: actor.role, body: message.trim(), visibleTo: "CLIENT_AND_HIREWISE", heldForReview: false });
    await move(tx, actor, r, "CANDIDATE_CONFIRMATION");
    for (const c of r.candidates.filter((c) => c.status !== "DECLINED" && c.status !== "WITHDRAWN")) {
      await publishEvent(tx, "CANDIDATE_CONFIRMATION_REQUESTED", { requestId: r.id, agentProfileId: c.agentProfileId, userId: c.agentProfile.userId, email: c.agentProfile.user.email, role: r.role, schedule: r.schedule, timezone: r.timezone });
    }
    if (r.assignedSalesUserId) await publishEvent(tx, "CLIENT_CONFIRMED_SLOTS", { requestId: r.id, salesUserId: r.assignedSalesUserId, companyName: r.client.companyName });
  });
}

/** A candidate confirms or declines. Never sees the company before scheduling. */
export async function candidateRespond(db: PrismaClient, actor: Actor, id: string, response: "CONFIRMED" | "DECLINED") {
  const r = await loadRequest(db, id);
  if (assertStaffOrOwner(actor, r, "interview.read_all") !== "AGENT") throw new ForbiddenError("Only the candidate can respond");
  if (!["CANDIDATE_CONFIRMATION", "CLIENT_CONFIRMATION", "SALES_REVIEW", "REQUESTED"].includes(r.status)) throw new Error("This request is no longer awaiting your response.");
  await db.$transaction(async (tx) => {
    await interviewRepository.setCandidateStatus(tx, r.id, actor.agentProfileId!, response);
    await audit(tx, { actor, action: "CANDIDATE_RESPONDED", entityType: "InterviewRequest", entityId: r.id, newValue: { agentProfileId: actor.agentProfileId, response } });
    if (r.assignedSalesUserId) await publishEvent(tx, "CANDIDATE_RESPONDED", { requestId: r.id, salesUserId: r.assignedSalesUserId, displayName: r.candidates.find((c) => c.agentProfileId === actor.agentProfileId)?.agentProfile.displayName ?? "Candidate", response });
  });
}

export const scheduleSchema = z.object({
  items: z.array(z.object({ agentProfileId: z.string().min(1), scheduledAt: z.string().min(1, "Pick a date and time."), durationMin: z.coerce.number().int().min(15).max(180).default(30), meetingLink: z.string().trim().url("Enter a full meeting link").optional().or(z.literal("")) })).min(1, "Schedule at least one candidate."),
  timezone: z.string().trim().min(2).max(80),
});

/** Sales creates Interview rows, moves the request to SCHEDULED, sets availability, and queues reminders. */
export async function scheduleInterviews(db: PrismaClient, actor: Actor, id: string, input: z.infer<typeof scheduleSchema>) {
  const r = await loadRequest(db, id);
  assertStaffOrOwner(actor, r, "interview.schedule");
  const candidateIds = new Set(r.candidates.filter((c) => c.status !== "DECLINED" && c.status !== "WITHDRAWN").map((c) => c.agentProfileId));
  const items = input.items.filter((i) => candidateIds.has(i.agentProfileId));
  if (items.length === 0) throw new Error("None of the chosen candidates are eligible.");
  await db.$transaction(async (tx) => {
    for (const it of items) {
      const scheduledAt = new Date(it.scheduledAt);
      if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now()) throw new Error("Interview time must be in the future.");
      const round = r.interviews.filter((x) => x.agentProfileId === it.agentProfileId).reduce((m, x) => Math.max(m, x.round), 0) + 1;
      const iv = await interviewRepository.createInterview(tx, { interviewRequestId: r.id, agentProfileId: it.agentProfileId, round, scheduledAt, timezone: input.timezone, durationMin: it.durationMin, meetingLink: it.meetingLink || null, coordinatorUserId: actor.userId });
      const cand = r.candidates.find((c) => c.agentProfileId === it.agentProfileId)!;
      if (cand.agentProfile.availabilityStatus === "AVAILABLE") await agentRepository.setAvailability(tx, it.agentProfileId, "INTERVIEWING", { setById: actor.userId, reason: `Interview scheduled (${r.id})` });
      for (const [label, ms] of [["24h", 24 * 3_600_000], ["1h", 3_600_000]] as const) {
        const runAt = new Date(scheduledAt.getTime() - ms);
        if (runAt.getTime() > Date.now()) await jobRepository.enqueue(tx, "INTERVIEW_REMINDER", { interviewId: iv.id, label }, runAt);
      }
      await audit(tx, { actor, action: "INTERVIEW_SCHEDULED", entityType: "Interview", entityId: iv.id, newValue: { requestId: r.id, agentProfileId: it.agentProfileId, scheduledAt: scheduledAt.toISOString(), round } });
      await publishEvent(tx, "INTERVIEW_SCHEDULED", { interviewId: iv.id, requestId: r.id, clientUserId: r.client.contacts[0]?.userId ?? null, clientEmail: r.client.contacts[0]?.businessEmail ?? null, agentUserId: cand.agentProfile.userId, agentEmail: cand.agentProfile.user.email, companyName: r.client.companyName, displayName: cand.agentProfile.displayName, scheduledAt: scheduledAt.toISOString(), timezone: input.timezone, meetingLink: it.meetingLink || null, salesUserId: r.assignedSalesUserId });
    }
    await move(tx, actor, r, "SCHEDULED");
  });
}

/** Sales records the outcome of one interview. When none remain scheduled, the request moves to CLIENT_DECISION_PENDING. */
export async function completeInterview(db: PrismaClient, actor: Actor, interviewId: string, status: "COMPLETED" | "NO_SHOW_CLIENT" | "NO_SHOW_AGENT" | "CANCELLED", internalFeedback?: string) {
  authorize(actor, "interview.coordinate");
  const iv = await interviewRepository.findInterview(db, interviewId);
  if (!iv) throw new NotFoundError();
  if (iv.status !== "SCHEDULED") throw new Error("This interview is not scheduled.");
  await db.$transaction(async (tx) => {
    await interviewRepository.setInterviewStatus(tx, iv.id, status, internalFeedback ?? null);
    await audit(tx, { actor, action: "INTERVIEW_STATUS_CHANGED", entityType: "Interview", entityId: iv.id, previousValue: { status: "SCHEDULED" }, newValue: { status }, reason: internalFeedback });
    const r = await loadRequest(tx, iv.interviewRequestId);
    const remaining = r.interviews.filter((x) => x.status === "SCHEDULED").length;
    if (remaining === 0 && r.status === "SCHEDULED") {
      await move(tx, actor, r, "COMPLETED", { system: true });
      await move(tx, actor, { ...r, status: "COMPLETED" }, "CLIENT_DECISION_PENDING", { system: true });
      const contactUserId = r.client.contacts[0]?.userId;
      if (contactUserId) await publishEvent(tx, "CLIENT_DECISION_REQUESTED", { requestId: r.id, userId: contactUserId, email: r.client.contacts[0]!.businessEmail, role: r.role });
    }
  });
}

export const decisionSchema = z.object({ decision: z.enum(["INTERESTED", "SECOND_INTERVIEW", "SELECTED", "NOT_SELECTED"]), feedback: z.string().trim().max(2000).optional().or(z.literal("")) });

/**
 * Client decision per interview (Section "Client selection"). SELECTED creates the
 * Placement and reserves the candidate; SECOND_INTERVIEW re-opens scheduling;
 * when every interview has a final decision the request closes.
 */
export async function recordClientDecision(db: PrismaClient, actor: Actor, interviewId: string, input: z.infer<typeof decisionSchema>) {
  const iv = await interviewRepository.findInterview(db, interviewId);
  if (!iv) throw new NotFoundError();
  const r = iv.interviewRequest;
  if (actor.role !== "CLIENT" || actor.clientId !== r.clientId) throw new NotFoundError();
  if (r.status !== "CLIENT_DECISION_PENDING") throw new Error("Decisions can be recorded once all interviews are complete.");
  if (iv.status !== "COMPLETED") throw new Error("This interview did not take place.");
  if (iv.clientDecision === "SELECTED" || iv.clientDecision === "NOT_SELECTED") throw new Error("A final decision was already recorded.");
  const feedback = input.feedback?.trim() || null;

  await db.$transaction(async (tx) => {
    await interviewRepository.setClientDecision(tx, iv.id, input.decision, feedback);
    await audit(tx, { actor, action: "CLIENT_DECISION_RECORDED", entityType: "Interview", entityId: iv.id, previousValue: { decision: iv.clientDecision }, newValue: { decision: input.decision }, reason: feedback ?? undefined });

    if (input.decision === "SELECTED") {
      const placement = await createPlacementFromSelection(tx, actor, { clientId: r.clientId, agentProfileId: iv.agentProfileId, requirementId: r.requirementId, interviewRequestId: r.id, interviewId: iv.id, positionTitle: r.role, schedule: r.schedule, timezone: r.timezone, startDate: r.targetStartDate, accountManagerUserId: r.assignedSalesUserId ?? r.client.accountManagerUserId });
      // The hold belongs to the account manager, who is warned before it expires.
      await reserveForClient(tx, actor, { agentProfileId: iv.agentProfileId, clientId: r.clientId, placementId: placement.id, reason: `Selected after interview (${r.id})`, system: true, reservedById: r.assignedSalesUserId ?? r.client.accountManagerUserId ?? null });
      await audit(tx, { actor, action: "CANDIDATE_SELECTED", entityType: "Placement", entityId: placement.id, newValue: { agentProfileId: iv.agentProfileId, requestId: r.id } });
      await publishEvent(tx, "CANDIDATE_SELECTED", { placementId: placement.id, requestId: r.id, clientId: r.clientId, companyName: r.client.companyName, agentProfileId: iv.agentProfileId, agentUserId: iv.agentProfile.userId, agentEmail: iv.agentProfile.user.email, displayName: iv.agentProfile.displayName, salesUserId: r.assignedSalesUserId });
    } else if (input.decision === "SECOND_INTERVIEW") {
      await interviewRepository.setCandidateStatus(tx, r.id, iv.agentProfileId, "PENDING");
      await move(tx, actor, r, "CLIENT_CONFIRMATION", { system: true });
      if (r.assignedSalesUserId) await publishEvent(tx, "SECOND_INTERVIEW_REQUESTED", { requestId: r.id, salesUserId: r.assignedSalesUserId, companyName: r.client.companyName, displayName: iv.agentProfile.displayName });
      return;
    } else if (input.decision === "NOT_SELECTED") {
      await publishEvent(tx, "CANDIDATE_NOT_SELECTED", { requestId: r.id, agentUserId: iv.agentProfile.userId, agentEmail: iv.agentProfile.user.email, role: r.role });
    }

    const fresh = await loadRequest(tx, r.id);
    const allDecided = fresh.interviews.filter((x) => x.status === "COMPLETED").every((x) => x.clientDecision === "SELECTED" || x.clientDecision === "NOT_SELECTED" || x.clientDecision === "INTERESTED");
    if (allDecided && fresh.status === "CLIENT_DECISION_PENDING") {
      await move(tx, actor, fresh, "CLOSED", { system: true });
      // Candidates still INTERVIEWING with no other scheduled interview go back to AVAILABLE unless reserved/selected.
      for (const c of fresh.candidates) {
        const selectedHere = fresh.interviews.some((x) => x.agentProfileId === c.agentProfileId && x.clientDecision === "SELECTED");
        if (selectedHere) continue;
        const others = await interviewRepository.otherScheduledForAgent(tx, c.agentProfileId, fresh.id);
        if (others === 0 && c.agentProfile.availabilityStatus === "INTERVIEWING") await agentRepository.setAvailability(tx, c.agentProfileId, "AVAILABLE", { setById: null, reason: `Interview request closed (${fresh.id})` });
      }
    }
  });
}

export async function cancelRequest(db: PrismaClient, actor: Actor, id: string, reason: string) {
  const r = await loadRequest(db, id);
  if (assertStaffOrOwner(actor, r, "interview.coordinate") === "AGENT") throw new ForbiddenError("Not allowed");
  await db.$transaction(async (tx) => {
    await move(tx, actor, r, "CANCELLED", { reason, extra: { cancelledReason: reason } });
    await interviewRepository.cancelScheduledInterviews(tx, r.id);
    for (const c of r.candidates) {
      const others = await interviewRepository.otherScheduledForAgent(tx, c.agentProfileId, r.id);
      if (others === 0 && c.agentProfile.availabilityStatus === "INTERVIEWING") await agentRepository.setAvailability(tx, c.agentProfileId, "AVAILABLE", { setById: actor.userId, reason: `Interview request cancelled (${r.id})` });
    }
    await publishEvent(tx, "INTERVIEW_REQUEST_CANCELLED", { requestId: r.id, companyName: r.client.companyName, role: r.role, salesUserId: r.assignedSalesUserId, clientUserId: r.client.contacts[0]?.userId ?? null, agentUserIds: r.candidates.map((c) => c.agentProfile.userId), byRole: actor.role });
  });
}

export async function setSalesNotes(db: PrismaClient, actor: Actor, id: string, salesNotes: string) {
  const r = await loadRequest(db, id);
  assertStaffOrOwner(actor, r, "interview.coordinate");
  await interviewRepository.setStatus(db, r.id, r.status, { salesNotes: salesNotes.trim().slice(0, 4000) });
}

export async function upcomingInterviewsForStaff(db: PrismaClient, actor: Actor, days = 7) {
  authorize(actor, "interview.read_all");
  const now = new Date();
  const rows = await interviewRepository.upcomingInterviews(db, now, new Date(now.getTime() + days * 86_400_000));
  return rows.map((i) => ({ id: i.id, requestId: i.interviewRequest.id, scheduledAt: i.scheduledAt, timezone: i.timezone, displayName: i.agentProfile.displayName, companyName: i.interviewRequest.client.companyName, role: i.interviewRequest.role }));
}
