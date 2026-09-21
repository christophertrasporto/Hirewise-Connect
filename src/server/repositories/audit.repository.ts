import type { Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";

export type AuditInsert = {
  actorUserId: string | null;
  actorRole: Prisma.AuditLogCreateInput["actorRole"];
  action: string;
  entityType: string;
  entityId: string;
  previousValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  reason?: string | null;
  ipAddress?: string | null;
};

export const auditRepository = {
  insert(db: Db, row: AuditInsert) {
    return db.auditLog.create({
      data: {
        actorUserId: row.actorUserId,
        actorRole: row.actorRole,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        previousValue: row.previousValue ?? undefined,
        newValue: row.newValue ?? undefined,
        reason: row.reason ?? undefined,
        ipAddress: row.ipAddress ?? undefined,
      },
    });
  },

  listForEntity(db: Db, entityType: string, entityId: string, take = 50) {
    return db.auditLog.findMany({ where: { entityType, entityId }, orderBy: { createdAt: "desc" }, take });
  },
};
