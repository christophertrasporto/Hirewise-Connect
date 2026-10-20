import type { Prisma, ThreadKind, ThreadStatus, MessageVisibility, RoleKey } from "@prisma/client";
import type { Db } from "@/server/db/types";

/** v2 phase 6a: mediated message threads. */

export const threadInclude = {
  client: { select: { id: true, companyName: true, industry: true, country: true, accountManagerUserId: true, contacts: { select: { userId: true, name: true, businessEmail: true, isPrimary: true } } } },
  agency: { select: { id: true, name: true, ownerUserId: true, clientFacingCode: true, clientFacingName: true, users: { select: { userId: true, role: true } } } },
  agentProfile: { select: { id: true, userId: true, displayName: true, clientLabel: true, primaryAgencyId: true, privateContact: { select: { fullLegalName: true } }, user: { select: { email: true } } } },
  interviewRequest: { select: { id: true, role: true, status: true, assignedSalesUserId: true, candidates: { select: { agentProfileId: true, agentProfile: { select: { userId: true, displayName: true, clientLabel: true, primaryAgencyId: true } } } } } },
  assignedStaff: { select: { id: true, email: true } },
} satisfies Prisma.MessageThreadInclude;
export type ThreadRecord = Prisma.MessageThreadGetPayload<{ include: typeof threadInclude }>;

const messageInclude = { thread: { select: { id: true, kind: true, title: true, clientId: true, agencyId: true, agentProfileId: true, interviewRequestId: true, client: { select: { companyName: true } } } } } satisfies Prisma.MessageInclude;
export type MessageRecord = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export const threadRepository = {
  create(db: Db, d: { kind: ThreadKind; title: string; subjectType?: string | null; subjectId?: string | null; interviewRequestId?: string | null; clientId?: string | null; agencyId?: string | null; agentProfileId?: string | null; assignedStaffUserId?: string | null }) {
    return db.messageThread.create({ data: { kind: d.kind, title: d.title, subjectType: d.subjectType ?? null, subjectId: d.subjectId ?? null, interviewRequestId: d.interviewRequestId ?? null, clientId: d.clientId ?? null, agencyId: d.agencyId ?? null, agentProfileId: d.agentProfileId ?? null, assignedStaffUserId: d.assignedStaffUserId ?? null }, include: threadInclude });
  },

  findById(db: Db, id: string) {
    return db.messageThread.findUnique({ where: { id }, include: threadInclude });
  },

  findByRequest(db: Db, interviewRequestId: string) {
    return db.messageThread.findUnique({ where: { interviewRequestId }, include: threadInclude });
  },

  findEnquiry(db: Db, q: { clientId: string; agencyId: string }) {
    return db.messageThread.findFirst({ where: { kind: "PARTNER_ENQUIRY", clientId: q.clientId, agencyId: q.agencyId, status: "OPEN" }, include: threadInclude });
  },

  findSupport(db: Db, q: { clientId?: string | null; agentProfileId?: string | null; agencyId?: string | null }) {
    return db.messageThread.findFirst({ where: { kind: "SUPPORT", status: "OPEN", clientId: q.clientId ?? null, agentProfileId: q.agentProfileId ?? null, agencyId: q.agencyId ?? null }, include: threadInclude });
  },

  setStatus(db: Db, id: string, status: ThreadStatus) {
    return db.messageThread.update({ where: { id }, data: { status, closedAt: status === "CLOSED" ? new Date() : null }, select: { id: true } });
  },

  assign(db: Db, id: string, assignedStaffUserId: string | null) {
    return db.messageThread.update({ where: { id }, data: { assignedStaffUserId }, select: { id: true } });
  },

  /** Threads an actor participates in, by the ids that identify them. */
  listFor(db: Db, q: { clientId?: string; agentProfileId?: string; agencyId?: string; candidateRequestIds?: string[] }, take = 100) {
    const or: Prisma.MessageThreadWhereInput[] = [];
    if (q.clientId) or.push({ clientId: q.clientId });
    if (q.agentProfileId) or.push({ agentProfileId: q.agentProfileId });
    if (q.agencyId) or.push({ agencyId: q.agencyId });
    if (q.candidateRequestIds?.length) or.push({ interviewRequestId: { in: q.candidateRequestIds } });
    if (!or.length) return Promise.resolve([] as ThreadRecord[]);
    return db.messageThread.findMany({ where: { OR: or }, include: threadInclude, orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], take });
  },

  listForStaff(db: Db, f: { status?: ThreadStatus; kind?: ThreadKind; assignedStaffUserId?: string } = {}, take = 200) {
    return db.messageThread.findMany({ where: { ...(f.status ? { status: f.status } : {}), ...(f.kind ? { kind: f.kind } : {}), ...(f.assignedStaffUserId ? { assignedStaffUserId: f.assignedStaffUserId } : {}) }, include: threadInclude, orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], take });
  },

  createMessage(db: Db, d: { threadId: string; authorUserId: string; authorRole: RoleKey; body: string; originalBody: string | null; findings: string[]; visibleTo: MessageVisibility; heldForReview: boolean; maskedAt: Date | null }) {
    return db.message.create({ data: d, include: messageInclude }).then(async (m) => {
      await db.messageThread.update({ where: { id: d.threadId }, data: { lastMessageAt: m.createdAt } });
      return m;
    });
  },

  listMessages(db: Db, threadId: string) {
    return db.message.findMany({ where: { threadId }, orderBy: { createdAt: "asc" }, include: messageInclude });
  },

  findMessage(db: Db, id: string) {
    return db.message.findUnique({ where: { id }, include: messageInclude });
  },

  releaseMessage(db: Db, id: string, releasedById: string) {
    return db.message.update({ where: { id }, data: { heldForReview: false, releasedById, releasedAt: new Date() }, select: { id: true } });
  },

  blockMessage(db: Db, id: string, releasedById: string) {
    return db.message.update({ where: { id }, data: { heldForReview: false, blockedAt: new Date(), releasedById, releasedAt: new Date() }, select: { id: true } });
  },

  heldMessages(db: Db, take = 50) {
    return db.message.findMany({ where: { heldForReview: true, blockedAt: null }, orderBy: { createdAt: "asc" }, include: messageInclude, take });
  },

  maskedMessages(db: Db, since: Date, take = 100) {
    return db.message.findMany({ where: { maskedAt: { gte: since } }, orderBy: { createdAt: "desc" }, include: messageInclude, take });
  },

  countHeld(db: Db) {
    return db.message.count({ where: { heldForReview: true, blockedAt: null } });
  },

  authorsByIds(db: Db, ids: string[]) {
    return db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, role: { select: { key: true } }, agentProfiles: { where: { archivedAt: null }, select: { displayName: true, clientLabel: true }, take: 1 }, clientContact: { select: { name: true } } } });
  },
};
