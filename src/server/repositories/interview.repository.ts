import type { ClientDecision, InterviewCandidateStatus, InterviewRequestStatus, InterviewStatus, MessageVisibility, Prisma, RoleKey } from "@prisma/client";
import type { Db } from "@/server/db/types";

export function requestInclude() {
  return {
    client: { select: { id: true, companyName: true, timezone: true, accountManagerUserId: true, contacts: { where: { isPrimary: true }, select: { name: true, userId: true, businessEmail: true } } } },
    requirement: { select: { id: true, title: true, role: true } },
    candidates: { include: { agentProfile: { select: { id: true, displayName: true, primaryRole: true, availabilityStatus: true, userId: true, timezone: true, privateContact: { select: { fullLegalName: true } }, user: { select: { email: true } } } } }, orderBy: { createdAt: "asc" } },
    interviews: { include: { agentProfile: { select: { id: true, displayName: true } } }, orderBy: [{ round: "asc" }, { scheduledAt: "asc" }] },
    assignedSales: { select: { id: true, email: true } },
  } satisfies Prisma.InterviewRequestInclude;
}

export const interviewRepository = {
  createRequest(db: Db, d: { clientId: string; requirementId: string | null; requestedById: string; preferredDate: Date | null; preferredTime: string | null; timezone: string; notes: string | null; role: string; schedule: string | null; targetStartDate: Date | null; assignedSalesUserId: string | null; candidateIds: string[] }) {
    return db.interviewRequest.create({
      data: {
        clientId: d.clientId,
        requirementId: d.requirementId ?? undefined,
        requestedById: d.requestedById,
        preferredDate: d.preferredDate ?? undefined,
        preferredTime: d.preferredTime ?? undefined,
        timezone: d.timezone,
        notes: d.notes ?? undefined,
        role: d.role,
        schedule: d.schedule ?? undefined,
        targetStartDate: d.targetStartDate ?? undefined,
        assignedSalesUserId: d.assignedSalesUserId ?? undefined,
        candidates: { create: d.candidateIds.map((agentProfileId) => ({ agentProfileId })) },
      },
      include: requestInclude(),
    });
  },

  findRequest(db: Db, id: string) {
    return db.interviewRequest.findUnique({ where: { id }, include: requestInclude() });
  },

  listForClient(db: Db, clientId: string) {
    return db.interviewRequest.findMany({ where: { clientId }, include: requestInclude(), orderBy: { createdAt: "desc" } });
  },

  listForAgent(db: Db, agentProfileId: string) {
    return db.interviewRequest.findMany({ where: { candidates: { some: { agentProfileId } } }, include: requestInclude(), orderBy: { createdAt: "desc" } });
  },

  listForStaff(db: Db, where: { status?: InterviewRequestStatus[]; assignedSalesUserId?: string }, take = 100) {
    return db.interviewRequest.findMany({
      where: { ...(where.status ? { status: { in: where.status } } : {}), ...(where.assignedSalesUserId ? { assignedSalesUserId: where.assignedSalesUserId } : {}) },
      include: requestInclude(),
      orderBy: { createdAt: "desc" },
      take,
    });
  },

  setStatus(db: Db, id: string, status: InterviewRequestStatus, extra: { assignedSalesUserId?: string; cancelledReason?: string; salesNotes?: string } = {}) {
    return db.interviewRequest.update({ where: { id }, data: { status, ...extra } });
  },

  setCandidateStatus(db: Db, requestId: string, agentProfileId: string, status: InterviewCandidateStatus) {
    return db.interviewRequestCandidate.updateMany({ where: { interviewRequestId: requestId, agentProfileId }, data: { status, respondedAt: new Date() } });
  },

  createInterview(db: Db, d: { interviewRequestId: string; agentProfileId: string; round: number; scheduledAt: Date; timezone: string; durationMin: number; meetingLink: string | null; coordinatorUserId: string; meetingProvider?: string | null; meetingExternalId?: string | null }) {
    return db.interview.create({ data: { ...d, meetingLink: d.meetingLink ?? undefined } });
  },

  findInterview(db: Db, id: string) {
    return db.interview.findUnique({ where: { id }, include: { interviewRequest: { include: requestInclude() }, agentProfile: { select: { id: true, displayName: true, userId: true, availabilityStatus: true, user: { select: { email: true } } } } } });
  },

  setInterviewStatus(db: Db, id: string, status: InterviewStatus, internalFeedback?: string | null) {
    return db.interview.update({ where: { id }, data: { status, internalFeedback: internalFeedback ?? undefined } });
  },

  setClientDecision(db: Db, id: string, decision: ClientDecision, clientFeedback: string | null) {
    return db.interview.update({ where: { id }, data: { clientDecision: decision, clientFeedback, decidedAt: new Date() } });
  },

  cancelScheduledInterviews(db: Db, requestId: string) {
    return db.interview.updateMany({ where: { interviewRequestId: requestId, status: "SCHEDULED" }, data: { status: "CANCELLED" } });
  },

  upcomingInterviews(db: Db, from: Date, to: Date, take = 50) {
    return db.interview.findMany({ where: { status: "SCHEDULED", scheduledAt: { gte: from, lte: to } }, include: { agentProfile: { select: { id: true, displayName: true } }, interviewRequest: { select: { id: true, clientId: true, role: true, client: { select: { companyName: true } } } } }, orderBy: { scheduledAt: "asc" }, take });
  },

  otherScheduledForAgent(db: Db, agentProfileId: string, excludingRequestId: string) {
    return db.interview.count({ where: { agentProfileId, status: "SCHEDULED", interviewRequestId: { not: excludingRequestId } } });
  },

  countByStatus(db: Db) {
    return db.interviewRequest.groupBy({ by: ["status"], _count: { _all: true } });
  },

  // Messages
  createMessage(db: Db, d: { interviewRequestId: string; authorUserId: string; authorRole: RoleKey; body: string; visibleTo: MessageVisibility; heldForReview: boolean }) {
    return db.interviewMessage.create({ data: d });
  },

  listMessages(db: Db, interviewRequestId: string) {
    return db.interviewMessage.findMany({ where: { interviewRequestId }, orderBy: { createdAt: "asc" } });
  },

  findMessage(db: Db, id: string) {
    return db.interviewMessage.findUnique({ where: { id } });
  },

  releaseMessage(db: Db, id: string, releasedById: string) {
    return db.interviewMessage.update({ where: { id }, data: { heldForReview: false, releasedById, releasedAt: new Date() } });
  },

  blockMessage(db: Db, id: string, releasedById: string) {
    return db.interviewMessage.update({ where: { id }, data: { heldForReview: true, releasedById, blockedAt: new Date() } });
  },

  heldMessages(db: Db, take = 50) {
    return db.interviewMessage.findMany({ where: { heldForReview: true, blockedAt: null }, include: { interviewRequest: { select: { id: true, role: true, client: { select: { companyName: true } } } } }, orderBy: { createdAt: "asc" }, take });
  },

  authorsByIds(db: Db, ids: string[]) {
    return db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, role: { select: { key: true } }, agentProfile: { select: { displayName: true } }, clientContact: { select: { name: true } } } });
  },
};
