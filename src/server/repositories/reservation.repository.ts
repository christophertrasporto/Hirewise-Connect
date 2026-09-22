import type { Db } from "@/server/db/types";

export const reservationRepository = {
  create(db: Db, d: { agentProfileId: string; clientId: string; placementId: string | null; reservedById: string; reason: string | null; expiresAt: Date }) {
    return db.reservation.create({ data: { ...d, placementId: d.placementId ?? undefined, reason: d.reason ?? undefined } });
  },

  findById(db: Db, id: string) {
    return db.reservation.findUnique({ where: { id }, include: { agentProfile: { select: { id: true, displayName: true, availabilityStatus: true } }, client: { select: { id: true, companyName: true } }, reservedBy: { select: { id: true, email: true } } } });
  },

  activeForAgent(db: Db, agentProfileId: string) {
    return db.reservation.findFirst({ where: { agentProfileId, status: { in: ["ACTIVE", "EXTENDED"] } } });
  },

  listActive(db: Db, take = 100) {
    return db.reservation.findMany({ where: { status: { in: ["ACTIVE", "EXTENDED"] } }, include: { agentProfile: { select: { id: true, displayName: true, availabilityStatus: true } }, client: { select: { id: true, companyName: true } }, reservedBy: { select: { id: true, email: true } } }, orderBy: { expiresAt: "asc" }, take });
  },

  due(db: Db, now: Date) {
    return db.reservation.findMany({ where: { status: { in: ["ACTIVE", "EXTENDED"] }, expiresAt: { lte: now } }, include: { agentProfile: { select: { id: true, displayName: true } }, client: { select: { companyName: true } } } });
  },

  expiringWithin(db: Db, from: Date, to: Date) {
    return db.reservation.findMany({ where: { status: { in: ["ACTIVE", "EXTENDED"] }, expiresAt: { gt: from, lte: to } }, include: { agentProfile: { select: { id: true, displayName: true } }, client: { select: { companyName: true } } } });
  },

  extend(db: Db, id: string, expiresAt: Date) {
    return db.reservation.update({ where: { id }, data: { expiresAt, status: "EXTENDED", extensions: { increment: 1 } } });
  },

  setStatus(db: Db, id: string, status: "RELEASED" | "EXPIRED" | "CONVERTED") {
    return db.reservation.update({ where: { id }, data: { status } });
  },

  /** The availability status in force before the reservation (for restoring on expiry). */
  async availabilityBefore(db: Db, agentProfileId: string, before: Date) {
    const prev = await db.agentAvailability.findFirst({ where: { agentProfileId, setAt: { lt: before }, status: { not: "RESERVED" } }, orderBy: { setAt: "desc" } });
    return prev?.status ?? "AVAILABLE";
  },
};
