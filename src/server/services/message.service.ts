import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { interviewRepository } from "@/server/repositories/interview.repository";
import { flagRepository } from "@/server/repositories/flag.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { scanMessage } from "@/lib/message-filter";

type Visibility = "ALL" | "HIREWISE_ONLY" | "CLIENT_AND_HIREWISE" | "AGENT_AND_HIREWISE";

async function participation(db: PrismaClient, actor: Actor, requestId: string) {
  const r = await interviewRepository.findRequest(db, requestId);
  if (!r) throw new NotFoundError();
  if (actor.role === "CLIENT") {
    if (actor.clientId !== r.clientId) throw new NotFoundError();
    return { r, who: "CLIENT" as const };
  }
  if (actor.role === "AGENT") {
    if (!r.candidates.some((c) => c.agentProfileId === actor.agentProfileId)) throw new NotFoundError();
    return { r, who: "AGENT" as const };
  }
  authorize(actor, "interview.read_all");
  return { r, who: "STAFF" as const };
}

/**
 * Post to the mediated thread (Sections 8.5, 8.8). Clients and agents never address each
 * other directly: their messages go to Hirewise, who relays. Contact details are held for
 * Sales review and flagged; rate talk is flagged.
 */
export async function postMessage(db: PrismaClient, actor: Actor, requestId: string, body: string, visibleTo?: Visibility) {
  const text = body.trim();
  if (text.length < 1 || text.length > 4000) throw new Error("Message must be between 1 and 4000 characters.");
  const { r, who } = await participation(db, actor, requestId);
  if (["CANCELLED", "CLOSED"].includes(r.status)) throw new Error("This conversation is closed.");
  const visibility: Visibility = who === "CLIENT" ? "CLIENT_AND_HIREWISE" : who === "AGENT" ? "AGENT_AND_HIREWISE" : (visibleTo ?? "ALL");
  if (who === "STAFF") authorize(actor, "interview.coordinate");

  const scan = who === "STAFF" ? { contactInfo: false, rateTalk: false, reasons: [] as string[] } : scanMessage(text);
  const held = scan.contactInfo;

  const result = await db.$transaction(async (tx) => {
    const m = await interviewRepository.createMessage(tx, { interviewRequestId: r.id, authorUserId: actor.userId, authorRole: actor.role, body: text, visibleTo: visibility, heldForReview: held });
    if (scan.contactInfo || scan.rateTalk) {
      await flagRepository.create(tx, { userId: actor.userId, rule: scan.contactInfo ? "CONTACT_INFO_IN_MESSAGE" : "RATE_DISCUSSION_IN_MESSAGE", details: { reasons: scan.reasons, messageId: m.id }, relatedType: "InterviewRequest", relatedId: r.id });
    }
    if (held) {
      await audit(tx, { actor, action: "MESSAGE_HELD", entityType: "InterviewMessage", entityId: m.id, newValue: { reasons: scan.reasons } });
      await publishEvent(tx, "MESSAGE_HELD_FOR_REVIEW", { requestId: r.id, messageId: m.id, salesUserId: r.assignedSalesUserId, authorRole: actor.role, reasons: scan.reasons });
    } else {
      await publishEvent(tx, "MESSAGE_POSTED", { requestId: r.id, messageId: m.id, authorRole: actor.role, visibleTo: visibility, clientUserId: r.client.contacts[0]?.userId ?? null, agentUserIds: r.candidates.map((c) => c.agentProfile.userId), salesUserId: r.assignedSalesUserId, preview: text.slice(0, 80) });
    }
    return { id: m.id, held, reasons: scan.reasons, rateTalk: scan.rateTalk };
  });
  return result;
}

/** Messages the actor may see. Held messages are visible only to their author and to Hirewise. */
export async function listMessages(db: PrismaClient, actor: Actor, requestId: string) {
  const { r, who } = await participation(db, actor, requestId);
  const rows = await interviewRepository.listMessages(db, r.id);
  const visible = rows.filter((m) => {
    if (m.blockedAt && who !== "STAFF" && m.authorUserId !== actor.userId) return false;
    if (m.heldForReview && who !== "STAFF" && m.authorUserId !== actor.userId) return false;
    if (who === "STAFF") return true;
    if (m.visibleTo === "ALL") return true;
    if (who === "CLIENT") return m.visibleTo === "CLIENT_AND_HIREWISE";
    return m.visibleTo === "AGENT_AND_HIREWISE";
  });
  const authors = new Map((await interviewRepository.authorsByIds(db, [...new Set(visible.map((m) => m.authorUserId))])).map((a) => [a.id, a]));
  return visible.map((m) => {
    const a = authors.get(m.authorUserId);
    const isStaff = !["CLIENT", "AGENT"].includes(m.authorRole);
    // Names: Hirewise staff appear as "Hirewise"; clients see agent display names; agents see the company only via the request view.
    const authorLabel = isStaff ? "Hirewise" : m.authorRole === "AGENT" ? (a?.agentProfile?.displayName ?? "Candidate") : who === "STAFF" ? (a?.clientContact?.name ?? "Client") : "Client";
    return { id: m.id, body: m.body, authorRole: m.authorRole, authorLabel, mine: m.authorUserId === actor.userId, visibleTo: m.visibleTo, heldForReview: m.heldForReview, blocked: !!m.blockedAt, createdAt: m.createdAt };
  });
}

export async function reviewHeldMessage(db: PrismaClient, actor: Actor, messageId: string, decision: "RELEASE" | "BLOCK") {
  authorize(actor, "interview.coordinate");
  const m = await interviewRepository.findMessage(db, messageId);
  if (!m) throw new NotFoundError();
  await db.$transaction(async (tx) => {
    if (decision === "RELEASE") await interviewRepository.releaseMessage(tx, m.id, actor.userId);
    else await interviewRepository.blockMessage(tx, m.id, actor.userId);
    await audit(tx, { actor, action: decision === "RELEASE" ? "MESSAGE_RELEASED" : "MESSAGE_BLOCKED", entityType: "InterviewMessage", entityId: m.id });
  });
}

export async function listHeldMessages(db: PrismaClient, actor: Actor) {
  authorize(actor, "interview.coordinate");
  const rows = await interviewRepository.heldMessages(db);
  return rows.map((m) => ({ id: m.id, body: m.body, authorRole: m.authorRole, createdAt: m.createdAt, requestId: m.interviewRequest.id, role: m.interviewRequest.role, companyName: m.interviewRequest.client.companyName }));
}

export async function listOpenFlags(db: PrismaClient, actor: Actor) {
  authorize(actor, "flag.review");
  return flagRepository.listOpen(db);
}

export async function markFlagReviewed(db: PrismaClient, actor: Actor, id: string) {
  authorize(actor, "flag.review");
  await flagRepository.markReviewed(db, id, actor.userId);
}

export function assertCanPost(actor: Actor) {
  if (!["CLIENT", "AGENT"].includes(actor.role) && !actor.permissions.has("interview.coordinate")) throw new ForbiddenError("Not allowed");
}
