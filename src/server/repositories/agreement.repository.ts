import type { RoleKey } from "@prisma/client";
import type { Db } from "@/server/db/types";

export const agreementRepository = {
  activeForRole(db: Db, role: RoleKey) {
    return db.agreement.findMany({ where: { isActive: true, requiredForRole: role }, orderBy: { type: "asc" } });
  },

  findById(db: Db, id: string) {
    return db.agreement.findUnique({ where: { id } });
  },

  acceptedIdsForUser(db: Db, userId: string, agreementIds: string[]) {
    return db.agreementAcceptance.findMany({ where: { userId, agreementId: { in: agreementIds }, placementId: null }, select: { agreementId: true } });
  },

  async recordAcceptance(db: Db, data: { agreementId: string; userId: string; bodyChecksum: string; ipAddress?: string | null; userAgent?: string | null }) {
    // Postgres treats NULL placementId as distinct in the unique index, so guard duplicates explicitly.
    const existing = await db.agreementAcceptance.findFirst({ where: { agreementId: data.agreementId, userId: data.userId, placementId: null }, select: { id: true } });
    if (existing) return existing;
    return db.agreementAcceptance.create({ data: { ...data, ipAddress: data.ipAddress ?? undefined, userAgent: data.userAgent ?? undefined }, select: { id: true } });
  },

  listAcceptancesForUser(db: Db, userId: string) {
    return db.agreementAcceptance.findMany({ where: { userId }, include: { agreement: { select: { type: true, version: true, title: true } } }, orderBy: { acceptedAt: "desc" } });
  },
};
