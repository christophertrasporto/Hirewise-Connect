import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { threadRepository, type ThreadRecord, type MessageRecord } from "@/server/repositories/thread.repository";
import { interviewRepository } from "@/server/repositories/interview.repository";
import { flagRepository } from "@/server/repositories/flag.repository";
import { partnerRepository } from "@/server/repositories/partner.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { getSetting } from "@/server/services/setting.service";
import { clientIdentityDisclosedTo } from "@/server/services/disclosure.service";
import { agencyNameReplacements } from "@/server/services/client-safe-document.service";
import { scanMessage } from "@/lib/message-filter";
import { redactForClient, clientLabelFrom } from "@/lib/client-redaction";
import { toThreadView, toMessageView, type ThreadAudience } from "@/server/views/thread.views";

/**
 * Mediated message threads (v2 phase 6a, feature 11). Every pre-placement conversation is Client ↔ Hirewise ↔
 * Partner Team or agent: nobody addresses the other side directly, Hirewise is in every thread, and contact details
 * are masked (default) or held (setting) and always flagged. The interview thread is one kind of thread.
 */

type Visibility = "ALL" | "HIREWISE_ONLY" | "CLIENT_AND_HIREWISE" | "AGENT_AND_HIREWISE" | "AGENCY_AND_HIREWISE";

export async function participation(db: Db, actor: Actor, thread: ThreadRecord): Promise<ThreadAudience> {
  if (actor.role === "CLIENT") {
    if (!actor.clientId || thread.clientId !== actor.clientId) throw new NotFoundError();
    return "CLIENT";
  }
  if (actor.role === "AGENT") {
    const candidate = thread.interviewRequest?.candidates.some((c) => c.agentProfileId === actor.agentProfileId) ?? false;
    if (!actor.agentProfileId || (thread.agentProfileId !== actor.agentProfileId && !candidate)) throw new NotFoundError();
    return "AGENT";
  }
  if (actor.agency && thread.agencyId === actor.agency.id && !actor.permissions.has("interview.read_all") && !actor.permissions.has("thread.moderate")) {
    if (!actor.permissions.has("agency.team.read")) throw new ForbiddenError("Thread access needs agency.team.read");
    return "AGENCY";
  }
  if (actor.permissions.has("thread.moderate") || actor.permissions.has("interview.read_all")) return "STAFF";
  throw new NotFoundError();
}

function canSee(m: MessageRecord, who: ThreadAudience, actor: Actor) {
  if (m.blockedAt && who !== "STAFF" && m.authorUserId !== actor.userId) return false;
  if (m.heldForReview && who !== "STAFF" && m.authorUserId !== actor.userId) return false;
  if (who === "STAFF" || m.visibleTo === "ALL") return true;
  if (who === "CLIENT") return m.visibleTo === "CLIENT_AND_HIREWISE";
  if (who === "AGENT") return m.visibleTo === "AGENT_AND_HIREWISE";
  return m.visibleTo === "AGENCY_AND_HIREWISE";
}

function recipientsOf(thread: ThreadRecord, visibility: Visibility, authorUserId: string): string[] {
  const ids = new Set<string>();
  const client = visibility === "ALL" || visibility === "CLIENT_AND_HIREWISE";
  const agent = visibility === "ALL" || visibility === "AGENT_AND_HIREWISE";
  const agency = visibility === "ALL" || visibility === "AGENCY_AND_HIREWISE";
  if (client) for (const c of thread.client?.contacts ?? []) if (c.userId) ids.add(c.userId);
  if (agent) {
    if (thread.agentProfile) ids.add(thread.agentProfile.userId);
    for (const c of thread.interviewRequest?.candidates ?? []) ids.add(c.agentProfile.userId);
  }
  if (agency && thread.agency) for (const u of thread.agency.users) ids.add(u.userId);
  if (thread.assignedStaffUserId) ids.add(thread.assignedStaffUserId);
  else if (thread.client?.accountManagerUserId) ids.add(thread.client.accountManagerUserId);
  ids.delete(authorUserId);
  return [...ids];
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/** The interview request's thread, created on first use for requests that predate phase 6a. */
export async function ensureRequestThread(db: Db, actor: Actor, requestId: string): Promise<ThreadRecord> {
  const existing = await threadRepository.findByRequest(db, requestId);
  if (existing) return existing;
  const r = await interviewRepository.findRequest(db, requestId);
  if (!r) throw new NotFoundError();
  const t = await threadRepository.create(db, { kind: "INTERVIEW_REQUEST", title: `Interview request: ${r.role}`, subjectType: "InterviewRequest", subjectId: r.id, interviewRequestId: r.id, clientId: r.clientId, assignedStaffUserId: r.assignedSalesUserId });
  await audit(db, { actor, action: "THREAD_CREATED", entityType: "MessageThread", entityId: t.id, newValue: { kind: "INTERVIEW_REQUEST", requestId: r.id } });
  return t;
}

/** A client asks Hirewise about a Partner Team. One open enquiry per client and team; the team's owner is in the thread. */
export async function openEnquiryThread(db: PrismaClient, actor: Actor, agencyCode: string): Promise<ThreadRecord> {
  if (actor.role !== "CLIENT" || !actor.clientId) throw new ForbiddenError("Only clients open Partner Team enquiries");
  const { assertMarketplaceAccess } = await import("@/server/services/search.service");
  const access = await assertMarketplaceAccess(db, actor);
  const team = await partnerRepository.findByCode(db, agencyCode.trim().toUpperCase());
  if (!team || team.status !== "ACTIVE") throw new NotFoundError();
  const existing = await threadRepository.findEnquiry(db, { clientId: access.clientId!, agencyId: team.id });
  if (existing) return existing;
  const { clientRepository } = await import("@/server/repositories/client.repository");
  const client = await clientRepository.findById(db, access.clientId!);
  const t = await threadRepository.create(db, { kind: "PARTNER_ENQUIRY", title: `Enquiry: ${team.clientFacingName ?? team.clientFacingCode}`, subjectType: "Agency", subjectId: team.id, clientId: access.clientId!, agencyId: team.id, assignedStaffUserId: client?.accountManagerUserId ?? null });
  await audit(db, { actor, action: "THREAD_CREATED", entityType: "MessageThread", entityId: t.id, newValue: { kind: "PARTNER_ENQUIRY", agencyId: team.id } });
  return t;
}

/** A conversation with Hirewise for the actor (client, agent, or agency), reused while open. */
export async function openSupportThread(db: PrismaClient, actor: Actor, opts: { agentProfileId?: string | null; agencyId?: string | null; title?: string } = {}): Promise<ThreadRecord> {
  const scope = actor.role === "CLIENT" ? { clientId: actor.clientId ?? null, agentProfileId: opts.agentProfileId ?? null, agencyId: opts.agencyId ?? null } : actor.role === "AGENT" ? { agentProfileId: actor.agentProfileId ?? null } : actor.agency ? { agencyId: actor.agency.id } : null;
  if (!scope) throw new ForbiddenError("Staff reply inside existing threads");
  const existing = await threadRepository.findSupport(db, scope);
  if (existing) return existing;
  const t = await threadRepository.create(db, { kind: "SUPPORT", title: opts.title ?? "Conversation with Hirewise", ...scope, assignedStaffUserId: null });
  await audit(db, { actor, action: "THREAD_CREATED", entityType: "MessageThread", entityId: t.id, newValue: { kind: "SUPPORT" } });
  return t;
}

export async function closeThread(db: PrismaClient, actor: Actor, threadId: string, reason: string) {
  authorize(actor, "thread.moderate");
  const t = await threadRepository.findById(db, threadId);
  if (!t) throw new NotFoundError();
  await db.$transaction(async (tx) => {
    await threadRepository.setStatus(tx, t.id, "CLOSED");
    await audit(tx, { actor, action: "THREAD_CLOSED", entityType: "MessageThread", entityId: t.id, reason });
  });
}

export async function listMyThreads(db: PrismaClient, actor: Actor) {
  if (actor.role === "CLIENT") {
    if (!actor.clientId) return [];
    return (await threadRepository.listFor(db, { clientId: actor.clientId })).map((t) => toThreadView(t, "CLIENT"));
  }
  if (actor.role === "AGENT") {
    if (!actor.agentProfileId) return [];
    const requestIds = (await interviewRepository.listForAgent(db, actor.agentProfileId)).map((r) => r.id);
    const disclosed = await clientIdentityDisclosedTo(db, actor.agentProfileId);
    return (await threadRepository.listFor(db, { agentProfileId: actor.agentProfileId, candidateRequestIds: requestIds })).map((t) => toThreadView(t, "AGENT", { clientDisclosed: !!t.clientId && disclosed.has(t.clientId) }));
  }
  if (actor.agency && !actor.permissions.has("thread.moderate")) {
    if (!actor.permissions.has("agency.team.read")) return [];
    return (await threadRepository.listFor(db, { agencyId: actor.agency.id })).map((t) => toThreadView(t, "AGENCY"));
  }
  authorize(actor, "thread.moderate");
  return (await threadRepository.listForStaff(db, { status: "OPEN" })).map((t) => toThreadView(t, "STAFF"));
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function postToThread(db: PrismaClient, actor: Actor, threadId: string, body: string, visibleTo?: Visibility) {
  const text = body.trim();
  if (text.length < 1 || text.length > 4000) throw new Error("Message must be between 1 and 4000 characters.");
  const thread = await threadRepository.findById(db, threadId);
  if (!thread) throw new NotFoundError();
  const who = await participation(db, actor, thread);
  if (thread.status === "CLOSED" || (thread.interviewRequest && ["CLOSED", "CANCELLED"].includes(thread.interviewRequest.status))) throw new Error("This conversation is closed.");
  if (who === "STAFF" && !actor.permissions.has("interview.coordinate") && !actor.permissions.has("thread.moderate")) throw new ForbiddenError("Posting needs interview.coordinate");
  const visibility: Visibility = who === "CLIENT" ? "CLIENT_AND_HIREWISE" : who === "AGENT" ? "AGENT_AND_HIREWISE" : who === "AGENCY" ? "AGENCY_AND_HIREWISE" : (visibleTo ?? "ALL");
  const settings = await getSetting(db, "messaging");
  const scan = who === "STAFF" ? { contactInfo: false, rateTalk: false, reasons: [] as string[] } : scanMessage(text);
  const mask = scan.contactInfo && settings.contactDetails === "MASK";
  const held = scan.contactInfo && settings.contactDetails === "BLOCK";
  const delivered = mask ? redactForClient(text, { agencyNames: await agencyNameReplacements(db) }).text : text;
  return db.$transaction(async (tx) => {
    const m = await threadRepository.createMessage(tx, { threadId: thread.id, authorUserId: actor.userId, authorRole: actor.role, body: delivered, originalBody: mask ? text : null, findings: scan.reasons, visibleTo: visibility, heldForReview: held, maskedAt: mask ? new Date() : null });
    if (scan.contactInfo || (scan.rateTalk && settings.flagRateTalk)) {
      await flagRepository.create(tx, { userId: actor.userId, rule: scan.contactInfo ? "CONTACT_INFO_IN_MESSAGE" : "RATE_DISCUSSION_IN_MESSAGE", details: { reasons: scan.reasons, messageId: m.id, threadId: thread.id, masked: mask }, relatedType: thread.interviewRequestId ? "InterviewRequest" : "MessageThread", relatedId: thread.interviewRequestId ?? thread.id });
    }
    if (mask) await audit(tx, { actor, action: "MESSAGE_MASKED", entityType: "Message", entityId: m.id, newValue: { reasons: scan.reasons, threadId: thread.id } });
    if (held) {
      await audit(tx, { actor, action: "MESSAGE_HELD", entityType: "Message", entityId: m.id, newValue: { reasons: scan.reasons, threadId: thread.id } });
      await publishEvent(tx, "MESSAGE_HELD_FOR_REVIEW", { requestId: thread.interviewRequestId ?? thread.id, messageId: m.id, salesUserId: thread.assignedStaffUserId ?? thread.client?.accountManagerUserId ?? null, authorRole: actor.role, reasons: scan.reasons });
    } else {
      await publishEvent(tx, "THREAD_MESSAGE_POSTED", { threadId: thread.id, messageId: m.id, kind: thread.kind, title: thread.title, authorRole: actor.role, visibleTo: visibility, recipientUserIds: recipientsOf(thread, visibility, actor.userId), preview: delivered.slice(0, 80), masked: mask });
    }
    return { id: m.id, held, masked: mask, reasons: scan.reasons, rateTalk: scan.rateTalk };
  });
}

export async function listThreadMessages(db: PrismaClient, actor: Actor, threadId: string) {
  const thread = await threadRepository.findById(db, threadId);
  if (!thread) throw new NotFoundError();
  const who = await participation(db, actor, thread);
  const rows = (await threadRepository.listMessages(db, thread.id)).filter((m) => canSee(m, who, actor));
  const authors = new Map((await threadRepository.authorsByIds(db, [...new Set(rows.map((m) => m.authorUserId))])).map((a) => [a.id, a]));
  const clientDisclosed = who === "AGENT" && actor.agentProfileId && thread.clientId ? (await clientIdentityDisclosedTo(db, actor.agentProfileId)).has(thread.clientId) : false;
  const messages = rows.map((m) => {
    const a = authors.get(m.authorUserId);
    const isStaff = !["CLIENT", "AGENT", "AGENCY_OWNER", "AGENCY_MANAGER", "APPLICANT"].includes(m.authorRole);
    const profile = a?.agentProfiles[0];
    const label = isStaff
      ? "Hirewise"
      : m.authorRole === "AGENT"
        ? who === "CLIENT"
          ? (profile?.clientLabel ?? clientLabelFrom(null, profile?.displayName ?? "Candidate"))
          : (profile?.displayName ?? "Candidate")
        : m.authorRole === "CLIENT"
          ? who === "STAFF"
            ? (a?.clientContact?.name ?? thread.client?.companyName ?? "Client")
            : clientDisclosed && thread.client
              ? thread.client.companyName
              : "Client"
          : who === "CLIENT"
            ? (thread.agency?.clientFacingName ?? "Partner Team")
            : (thread.agency?.name ?? "Agency");
    return toMessageView(m, who, label, m.authorUserId === actor.userId);
  });
  return { thread: toThreadView(thread, who, { clientDisclosed }), audience: who, messages };
}

export async function reviewHeldThreadMessage(db: PrismaClient, actor: Actor, messageId: string, decision: "RELEASE" | "BLOCK") {
  if (!actor.permissions.has("thread.moderate")) authorize(actor, "interview.coordinate");
  const m = await threadRepository.findMessage(db, messageId);
  if (!m) throw new NotFoundError();
  await db.$transaction(async (tx) => {
    if (decision === "RELEASE") await threadRepository.releaseMessage(tx, m.id, actor.userId);
    else await threadRepository.blockMessage(tx, m.id, actor.userId);
    await audit(tx, { actor, action: decision === "RELEASE" ? "MESSAGE_RELEASED" : "MESSAGE_BLOCKED", entityType: "Message", entityId: m.id });
  });
}

export async function listHeldThreadMessages(db: PrismaClient, actor: Actor) {
  if (!actor.permissions.has("thread.moderate")) authorize(actor, "interview.coordinate");
  return (await threadRepository.heldMessages(db)).map((m) => ({ id: m.id, body: m.body, authorRole: m.authorRole, createdAt: m.createdAt, threadId: m.thread.id, requestId: m.thread.interviewRequestId, title: m.thread.title, companyName: m.thread.client?.companyName ?? null }));
}

export async function listMaskedMessages(db: PrismaClient, actor: Actor, days = 7) {
  authorize(actor, "thread.moderate");
  return (await threadRepository.maskedMessages(db, new Date(Date.now() - days * 86_400_000))).map((m) => ({ id: m.id, body: m.body, originalBody: m.originalBody, findings: m.findings, authorRole: m.authorRole, createdAt: m.createdAt, threadId: m.thread.id, requestId: m.thread.interviewRequestId, title: m.thread.title, companyName: m.thread.client?.companyName ?? null }));
}
