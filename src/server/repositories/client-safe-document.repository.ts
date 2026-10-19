import type { Prisma, ClientSafeDocumentType, ClientSafeSourceType, SanitizationStatus } from "@prisma/client";
import type { Db } from "@/server/db/types";

/** v2 phase 5: client-safe versions of source items. Originals are never touched here. */

const docInclude = {
  agentProfile: { select: { id: true, displayName: true, clientLabel: true, primaryRole: true, status: true, userId: true, user: { select: { email: true } } } },
  reviewedBy: { select: { id: true, email: true } },
} satisfies Prisma.ClientSafeDocumentInclude;
export type ClientSafeDocumentRecord = Prisma.ClientSafeDocumentGetPayload<{ include: typeof docInclude }>;

export const OPEN_STATUSES: SanitizationStatus[] = ["PENDING", "AUTO_SANITIZED", "NEEDS_MANUAL_REVIEW"];

export const clientSafeDocumentRepository = {
  /** One row per source item and original key; a re-upload (new key) creates a fresh row and the old one is left as history. */
  upsertSource(db: Db, d: { agentProfileId: string; type: ClientSafeDocumentType; sourceType: ClientSafeSourceType; sourceId: string; originalStorageKey: string; status: SanitizationStatus; sanitizedStorageKey?: string | null; autoNote?: string | null; findings?: Prisma.InputJsonValue | null }) {
    return db.clientSafeDocument.upsert({
      where: { sourceType_sourceId_originalStorageKey: { sourceType: d.sourceType, sourceId: d.sourceId, originalStorageKey: d.originalStorageKey } },
      create: { agentProfileId: d.agentProfileId, type: d.type, sourceType: d.sourceType, sourceId: d.sourceId, originalStorageKey: d.originalStorageKey, status: d.status, sanitizedStorageKey: d.sanitizedStorageKey ?? null, autoNote: d.autoNote ?? null, findings: d.findings ?? undefined },
      update: {},
      include: docInclude,
    });
  },

  findById(db: Db, id: string) {
    return db.clientSafeDocument.findUnique({ where: { id }, include: docInclude });
  },

  findBySource(db: Db, sourceType: ClientSafeSourceType, sourceId: string) {
    return db.clientSafeDocument.findFirst({ where: { sourceType, sourceId }, orderBy: { createdAt: "desc" }, include: docInclude });
  },

  approvedBySource(db: Db, sourceType: ClientSafeSourceType, sourceId: string) {
    return db.clientSafeDocument.findFirst({ where: { sourceType, sourceId, status: "APPROVED_FOR_CLIENT" }, orderBy: { createdAt: "desc" }, include: docInclude });
  },

  approvedForAgent(db: Db, agentProfileId: string) {
    return db.clientSafeDocument.findMany({ where: { agentProfileId, status: "APPROVED_FOR_CLIENT" }, orderBy: { createdAt: "asc" }, include: docInclude });
  },

  listForAgent(db: Db, agentProfileId: string) {
    return db.clientSafeDocument.findMany({ where: { agentProfileId }, orderBy: { createdAt: "desc" }, include: docInclude });
  },

  queue(db: Db, take = 200) {
    return db.clientSafeDocument.findMany({ where: { status: { in: OPEN_STATUSES } }, orderBy: { createdAt: "asc" }, include: docInclude, take });
  },

  pendingGenerated(db: Db, take = 50) {
    return db.clientSafeDocument.findMany({ where: { status: "PENDING", sourceType: { in: ["CERTIFICATION", "PROFILE"] } }, orderBy: { createdAt: "asc" }, include: docInclude, take });
  },

  setStatus(db: Db, id: string, d: { status: SanitizationStatus; sanitizedStorageKey?: string | null; reviewedById?: string | null; reviewNote?: string | null; autoNote?: string | null; findings?: Prisma.InputJsonValue | null }) {
    return db.clientSafeDocument.update({
      where: { id },
      data: { status: d.status, ...(d.sanitizedStorageKey !== undefined ? { sanitizedStorageKey: d.sanitizedStorageKey } : {}), ...(d.reviewedById !== undefined ? { reviewedById: d.reviewedById, reviewedAt: new Date() } : {}), ...(d.reviewNote !== undefined ? { reviewNote: d.reviewNote } : {}), ...(d.autoNote !== undefined ? { autoNote: d.autoNote } : {}), ...(d.findings !== undefined && d.findings !== null ? { findings: d.findings } : {}) },
      include: docInclude,
    });
  },

  countOpen(db: Db) {
    return db.clientSafeDocument.count({ where: { status: { in: OPEN_STATUSES } } });
  },

  /** Source details needed to generate or serve a document. */
  certificationFor(db: Db, id: string) {
    return db.certification.findUnique({ where: { id }, include: { template: { select: { name: true, description: true } }, agentProfile: { select: { id: true, clientLabel: true, displayName: true } } } });
  },
};
