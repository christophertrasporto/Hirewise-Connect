import type { Prisma, DisclosureScope, DisclosureGrantor } from "@prisma/client";
import type { Db } from "@/server/db/types";

/** v2 phase 5: explicit, revocable disclosure grants. */

const grantInclude = {
  client: { select: { id: true, companyName: true } },
  agentProfile: { select: { id: true, displayName: true, clientLabel: true } },
  agency: { select: { id: true, name: true, clientFacingName: true, clientFacingCode: true } },
  grantedByUser: { select: { id: true, email: true } },
} satisfies Prisma.DisclosureGrantInclude;
export type DisclosureGrantRecord = Prisma.DisclosureGrantGetPayload<{ include: typeof grantInclude }>;

function activeWhere(now: Date): Prisma.DisclosureGrantWhereInput {
  return { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

export const disclosureRepository = {
  active(db: Db, q: { scope: DisclosureScope; clientId: string; agentProfileId?: string | null; agencyId?: string | null }, now = new Date()) {
    return db.disclosureGrant.findFirst({ where: { scope: q.scope, clientId: q.clientId, agentProfileId: q.agentProfileId ?? null, agencyId: q.agencyId ?? null, ...activeWhere(now) }, include: grantInclude });
  },

  /** Subjects (agent profile ids or agency ids) a client holds an active grant for, in one scope. */
  async activeSubjectsForClient(db: Db, clientId: string, scope: DisclosureScope, now = new Date()) {
    const rows = await db.disclosureGrant.findMany({ where: { clientId, scope, ...activeWhere(now) }, select: { agentProfileId: true, agencyId: true } });
    return new Set(rows.map((r) => r.agentProfileId ?? r.agencyId ?? "").filter(Boolean));
  },

  /** Clients whose identity one agent may see (CLIENT_IDENTITY). */
  async activeClientsForAgent(db: Db, agentProfileId: string, now = new Date()) {
    const rows = await db.disclosureGrant.findMany({ where: { agentProfileId, scope: "CLIENT_IDENTITY", ...activeWhere(now) }, select: { clientId: true } });
    return new Set(rows.map((r) => r.clientId));
  },

  create(db: Db, d: { scope: DisclosureScope; clientId: string; agentProfileId: string | null; agencyId: string | null; grantedBy: DisclosureGrantor; grantedById: string | null; reason: string; interviewId?: string | null; expiresAt?: Date | null }) {
    return db.disclosureGrant.create({ data: { scope: d.scope, clientId: d.clientId, agentProfileId: d.agentProfileId, agencyId: d.agencyId, grantedBy: d.grantedBy, grantedById: d.grantedById, reason: d.reason, interviewId: d.interviewId ?? null, expiresAt: d.expiresAt ?? null }, include: grantInclude });
  },

  revoke(db: Db, id: string, d: { revokedById: string | null; revokeReason: string }) {
    return db.disclosureGrant.update({ where: { id }, data: { revokedAt: new Date(), revokedById: d.revokedById, revokeReason: d.revokeReason }, include: grantInclude });
  },

  findById(db: Db, id: string) {
    return db.disclosureGrant.findUnique({ where: { id }, include: grantInclude });
  },

  listFor(db: Db, q: { agentProfileId?: string; agencyId?: string; clientId?: string }, take = 100) {
    return db.disclosureGrant.findMany({ where: { ...(q.agentProfileId ? { agentProfileId: q.agentProfileId } : {}), ...(q.agencyId ? { agencyId: q.agencyId } : {}), ...(q.clientId ? { clientId: q.clientId } : {}) }, include: grantInclude, orderBy: { grantedAt: "desc" }, take });
  },
};
