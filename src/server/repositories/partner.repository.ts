import type { Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";
import { agentSelfInclude } from "@/server/repositories/agent.repository";

/** v2 phase 5: client-facing Partner Team identity and the aggregates a client may see about a team. */

export const partnerTeamSelect = {
  id: true,
  name: true,
  status: true,
  opportunityAccess: true,
  joinedAt: true,
  clientFacingCode: true,
  clientFacingName: true,
  clientFacingSpecializations: true,
} satisfies Prisma.AgencySelect;
export type PartnerTeamRecord = Prisma.AgencyGetPayload<{ select: typeof partnerTeamSelect }>;

const memberStatsSelect = {
  id: true,
  yearsExperience: true,
  availabilityStatus: true,
  verificationLevel: true,
  certifications: { where: { status: "APPROVED" as const }, select: { template: { select: { name: true } } } },
  enrollments: { select: { status: true } },
} satisfies Prisma.AgentProfileSelect;
export type PartnerMemberStats = Prisma.AgentProfileGetPayload<{ select: typeof memberStatsSelect }>;

export const partnerRepository = {
  /** Next client-facing code from the sequence created by the phase 5 data migration. */
  async allocateCode(db: Db): Promise<string> {
    const rows = await db.$queryRaw<Array<{ n: bigint | number }>>`SELECT nextval('agency_client_code_seq') AS n`;
    const n = Number(rows[0]?.n ?? 0);
    return `HWC-${String(n).padStart(3, "0")}`;
  },

  setClientFacing(db: Db, agencyId: string, d: { clientFacingCode: string; clientFacingName: string }) {
    return db.agency.update({ where: { id: agencyId }, data: d, select: { id: true } });
  },

  updateClientFacing(db: Db, agencyId: string, d: { clientFacingName?: string; clientFacingSpecializations?: string[] }) {
    return db.agency.update({ where: { id: agencyId }, data: d, select: { id: true, clientFacingName: true, clientFacingSpecializations: true } });
  },

  updatePrivateIdentity(db: Db, agencyId: string, d: { legalName: string | null; addressLine: string | null; registrationDetails: string | null; billingEmail: string | null }) {
    return db.agency.update({ where: { id: agencyId }, data: d, select: { id: true } });
  },

  /** Teams a client may browse: active, with opportunity access, and at least one approved member. */
  listVisible(db: Db) {
    return db.agency.findMany({
      where: { status: "ACTIVE", opportunityAccess: true, clientFacingCode: { not: null }, primaryAgents: { some: { status: "APPROVED", deletedAt: null } } },
      select: partnerTeamSelect,
      orderBy: { joinedAt: "asc" },
    });
  },

  findByCode(db: Db, code: string) {
    return db.agency.findFirst({ where: { clientFacingCode: code }, select: partnerTeamSelect });
  },

  findById(db: Db, id: string) {
    return db.agency.findUnique({ where: { id }, select: partnerTeamSelect });
  },

  /** Names of every agency, for redaction of free text that mentions them. */
  allNames(db: Db) {
    return db.agency.findMany({ select: { id: true, name: true, clientFacingCode: true, clientFacingName: true } });
  },

  memberStats(db: Db, agencyId: string) {
    return db.agentProfile.findMany({ where: { primaryAgencyId: agencyId, status: "APPROVED", deletedAt: null }, select: memberStatsSelect });
  },

  approvedMembers(db: Db, agencyId: string, take = 100) {
    return db.agentProfile.findMany({ where: { primaryAgencyId: agencyId, status: "APPROVED", deletedAt: null, availabilityStatus: { not: "UNAVAILABLE" } }, include: agentSelfInclude(), orderBy: [{ approvedAt: "desc" }], take });
  },

  /** Count of approved members per agency, for the staff side-by-side view. */
  async approvedMemberCount(db: Db, agencyId: string) {
    return db.agentProfile.count({ where: { primaryAgencyId: agencyId, status: "APPROVED", deletedAt: null } });
  },
};
