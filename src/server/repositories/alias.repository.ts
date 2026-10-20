import type { AliasOwnerType } from "@prisma/client";
import type { Db } from "@/server/db/types";

/** v2 phase 6a: platform email aliases. */
export const aliasRepository = {
  find(db: Db, ownerType: AliasOwnerType, ownerId: string) {
    return db.emailAlias.findUnique({ where: { ownerType_ownerId: { ownerType, ownerId } } });
  },

  findByAlias(db: Db, alias: string) {
    return db.emailAlias.findUnique({ where: { alias: alias.toLowerCase() } });
  },

  async nextNumber(db: Db): Promise<number> {
    const rows = await db.$queryRaw<Array<{ n: bigint | number }>>`SELECT nextval('email_alias_seq') AS n`;
    return Number(rows[0]?.n ?? 0);
  },

  create(db: Db, d: { alias: string; ownerType: AliasOwnerType; ownerId: string; routingTarget: string | null }) {
    return db.emailAlias.create({ data: { alias: d.alias.toLowerCase(), ownerType: d.ownerType, ownerId: d.ownerId, routingTarget: d.routingTarget } });
  },

  setActive(db: Db, id: string, active: boolean) {
    return db.emailAlias.update({ where: { id }, data: { active }, select: { id: true, alias: true, active: true } });
  },

  list(db: Db, take = 500) {
    return db.emailAlias.findMany({ orderBy: { createdAt: "desc" }, take });
  },

  /** Owners that have no alias yet, for the maintenance pass. */
  async missing(db: Db) {
    const [agents, agencies] = await Promise.all([
      db.agentProfile.findMany({ where: { status: "APPROVED", deletedAt: null }, select: { id: true } }),
      db.agency.findMany({ where: { status: "ACTIVE" }, select: { id: true } }),
    ]);
    const have = new Set((await db.emailAlias.findMany({ select: { ownerType: true, ownerId: true } })).map((a) => `${a.ownerType}:${a.ownerId}`));
    return { agents: agents.filter((a) => !have.has(`AGENT_PROFILE:${a.id}`)).map((a) => a.id), agencies: agencies.filter((a) => !have.has(`AGENCY:${a.id}`)).map((a) => a.id) };
  },
};
