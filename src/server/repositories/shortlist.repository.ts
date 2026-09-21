import type { Db } from "@/server/db/types";
import { agentSelfInclude } from "./agent.repository";

export const shortlistRepository = {
  async defaultForClient(db: Db, clientId: string, createdById: string) {
    const existing = await db.shortlist.findFirst({ where: { clientId, isDefault: true } });
    if (existing) return existing;
    return db.shortlist.create({ data: { clientId, createdById, isDefault: true } });
  },

  findById(db: Db, id: string) {
    return db.shortlist.findUnique({ where: { id }, select: { id: true, clientId: true, name: true } });
  },

  activeEntries(db: Db, shortlistId: string) {
    return db.shortlistCandidate.findMany({
      where: { shortlistId, removedAt: null },
      include: { agentProfile: { include: agentSelfInclude() } },
      orderBy: { addedAt: "desc" },
    });
  },

  activeEntry(db: Db, shortlistId: string, agentProfileId: string) {
    return db.shortlistCandidate.findFirst({ where: { shortlistId, agentProfileId, removedAt: null } });
  },

  activeAgentIds(db: Db, clientId: string) {
    return db.shortlistCandidate.findMany({ where: { removedAt: null, shortlist: { clientId } }, select: { agentProfileId: true } });
  },

  add(db: Db, shortlistId: string, agentProfileId: string, addedById: string) {
    return db.shortlistCandidate.create({ data: { shortlistId, agentProfileId, addedById } });
  },

  remove(db: Db, shortlistId: string, agentProfileId: string) {
    return db.shortlistCandidate.updateMany({ where: { shortlistId, agentProfileId, removedAt: null }, data: { removedAt: new Date() } });
  },

  setNote(db: Db, shortlistId: string, agentProfileId: string, note: string | null) {
    return db.shortlistCandidate.updateMany({ where: { shortlistId, agentProfileId, removedAt: null }, data: { note } });
  },

  /** Sales/admin: recent shortlist activity across clients (or one client). */
  recentActivity(db: Db, clientIds: string[] | null, take = 100) {
    return db.shortlistCandidate.findMany({
      where: clientIds ? { shortlist: { clientId: { in: clientIds } } } : {},
      include: { shortlist: { include: { client: { select: { id: true, companyName: true, accountManagerUserId: true } } } }, agentProfile: { select: { id: true, displayName: true, primaryRole: true, status: true, availabilityStatus: true } } },
      orderBy: { addedAt: "desc" },
      take,
    });
  },

  countActive(db: Db) {
    return db.shortlistCandidate.count({ where: { removedAt: null } });
  },

  recordView(db: Db, clientId: string, agentProfileId: string) {
    return db.candidateView.create({ data: { clientId, agentProfileId } });
  },

  recentlyViewed(db: Db, clientId: string, take = 8) {
    return db.candidateView.findMany({ where: { clientId }, orderBy: { viewedAt: "desc" }, distinct: ["agentProfileId"], take, include: { agentProfile: { include: agentSelfInclude() } } });
  },

  async upsertIntroduction(db: Db, clientId: string, agentProfileId: string, event: "VIEW" | "SHORTLIST" | "INTERVIEW") {
    const existing = await db.introduction.findUnique({ where: { clientId_agentProfileId: { clientId, agentProfileId } } });
    if (existing) return existing;
    return db.introduction.create({ data: { clientId, agentProfileId, firstEvent: event } });
  },
};
