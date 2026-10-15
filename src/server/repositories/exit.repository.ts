import type { Prisma, ExitRequestStatus, ExitRequestType, ExitEffectiveOption, ExitDecision, SeatReleaseRule } from "@prisma/client";
import type { Db } from "@/server/db/types";

const OPEN: ExitRequestStatus[] = ["PENDING_AGENCY", "PENDING_ADMIN", "APPROVED"];
const PLACEMENT_OPEN = ["PENDING", "INTERVIEWING", "SELECTED", "AWAITING_AGREEMENT", "AWAITING_DEPOSIT", "DEPLOYMENT_PREP", "ACTIVE", "PAUSED"] as const;

const exitInclude = {
  membership: { select: { id: true, status: true, agencyId: true, agentProfileId: true, joinedAt: true, seatLedgerEntryId: true, seatReleasedAt: true, effectiveEndAt: true, agentProfile: { select: { id: true, displayName: true, userId: true, user: { select: { email: true } } } }, agency: { select: { id: true, name: true, ownerUserId: true, planStartedAt: true, owner: { select: { email: true } }, plan: { select: { billingPeriod: true } } } } } },
} satisfies Prisma.ExitRequestInclude;

export type ExitRequestRecord = Prisma.ExitRequestGetPayload<{ include: typeof exitInclude }>;

export const exitRepository = {
  create(db: Db, d: { membershipId: string; agencyId: string; agentProfileId: string; platformIdentityId: string | null; type: ExitRequestType; reason: string; effectiveOption: ExitEffectiveOption; requestedEffectiveDate: Date | null; status: ExitRequestStatus; requestedById: string; adminRequired: boolean; adminRequiredReason: string | null }) {
    return db.exitRequest.create({ data: { ...d, platformIdentityId: d.platformIdentityId ?? undefined, requestedEffectiveDate: d.requestedEffectiveDate ?? undefined, adminRequiredReason: d.adminRequiredReason ?? undefined }, include: exitInclude });
  },
  find(db: Db, id: string) {
    return db.exitRequest.findUnique({ where: { id }, include: exitInclude });
  },
  openForMembership(db: Db, membershipId: string) {
    return db.exitRequest.findFirst({ where: { membershipId, status: { in: OPEN } }, include: exitInclude });
  },
  update(db: Db, id: string, d: Partial<{ status: ExitRequestStatus; effectiveOption: ExitEffectiveOption; agencyDecision: ExitDecision; agencyDecidedById: string; agencyDecisionNote: string | null; agencyDecidedAt: Date; adminRequired: boolean; adminRequiredReason: string | null; adminDecision: ExitDecision; adminDecidedById: string; adminDecisionNote: string | null; adminDecidedAt: Date; escalatedAt: Date; effectiveAt: Date | null; completedAt: Date }>) {
    return db.exitRequest.update({ where: { id }, data: { ...d, agencyDecisionNote: d.agencyDecisionNote ?? undefined, adminDecisionNote: d.adminDecisionNote ?? undefined, adminRequiredReason: d.adminRequiredReason ?? undefined }, include: exitInclude });
  },
  listForAgency(db: Db, agencyId: string, statuses?: ExitRequestStatus[], take = 50) {
    return db.exitRequest.findMany({ where: { agencyId, ...(statuses ? { status: { in: statuses } } : {}) }, orderBy: { createdAt: "desc" }, take, include: exitInclude });
  },
  listForStaff(db: Db, status?: ExitRequestStatus, take = 100) {
    return db.exitRequest.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take, include: exitInclude });
  },
  async counts(db: Db) {
    const rows = await db.exitRequest.groupBy({ by: ["status"], _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<Record<ExitRequestStatus, number>>;
  },
  /** Agency-pending requests older than the owner response window. */
  staleForAgency(db: Db, before: Date) {
    return db.exitRequest.findMany({ where: { status: "PENDING_AGENCY", createdAt: { lte: before } }, include: exitInclude });
  },
  /** Approved requests whose effective date has passed, or that wait for the agent's assignments to end. */
  approvedDue(db: Db, now: Date) {
    return db.exitRequest.findMany({ where: { status: "APPROVED", OR: [{ effectiveAt: { lte: now } }, { effectiveOption: "END_OF_ASSIGNMENT", effectiveAt: null }] }, include: exitInclude });
  },
  openPlacementCount(db: Db, agentProfileId: string) {
    return db.placement.count({ where: { agentProfileId, status: { in: [...PLACEMENT_OPEN] } } });
  },

  // ---- memberships ended with a seat still held
  endedWithSeatHeld(db: Db) {
    return db.agencyMembership.findMany({ where: { status: "ENDED", seatLedgerEntryId: { not: null }, seatReleasedAt: null }, select: { id: true, agencyId: true, agentProfileId: true, seatReleaseRule: true, effectiveEndAt: true, leftAt: true, agency: { select: { planStartedAt: true, plan: { select: { billingPeriod: true } } } } } });
  },
  setMembershipExit(db: Db, membershipId: string, d: { exitRequestId?: string | null; effectiveEndAt?: Date | null; seatReleaseRule?: SeatReleaseRule | null; seatReleasedAt?: Date | null }) {
    return db.agencyMembership.update({ where: { id: membershipId }, data: d, select: { id: true } });
  },
  pendingReleaseCount(db: Db, agencyId: string) {
    return db.agencyMembership.count({ where: { agencyId, seatLedgerEntryId: { not: null }, seatReleasedAt: null, status: { in: ["ENDING", "ENDED"] } } });
  },

  // ---- former profiles
  markFormer(db: Db, agentProfileId: string, formerAgencyId: string) {
    return db.agentProfile.update({ where: { id: agentProfileId }, data: { status: "FORMER_AGENCY_AGENT", availabilityStatus: "UNAVAILABLE", hiddenAt: new Date(), primaryAgencyId: null, formerAgencyId, formerAt: new Date() }, select: { id: true } });
  },
  formerDue(db: Db, before: Date) {
    return db.agentProfile.findMany({ where: { status: "FORMER_AGENCY_AGENT", archivedAt: null, formerAt: { lte: before } }, select: { id: true, userId: true, displayName: true } });
  },
  archive(db: Db, agentProfileId: string) {
    return db.agentProfile.update({ where: { id: agentProfileId }, data: { status: "ARCHIVED", archivedAt: new Date() }, select: { id: true } });
  },
  reactivateFormer(db: Db, agentProfileId: string) {
    return db.agentProfile.update({ where: { id: agentProfileId }, data: { status: "DRAFT", hiddenAt: null, formerAgencyId: null, formerAt: null }, select: { id: true } });
  },
  /** A fresh profile for the same identity on rejoin: only the basics are copied. */
  async createFreshProfile(db: Db, fromProfileId: string, platformIdentityId: string | null, userId: string) {
    const from = await db.agentProfile.findUniqueOrThrow({ where: { id: fromProfileId }, select: { displayName: true, locationCity: true, locationCountry: true, timezone: true, primaryRole: true, privateContact: { select: { fullLegalName: true, personalEmail: true, phone: true } } } });
    return db.agentProfile.create({
      data: {
        userId,
        platformIdentityId: platformIdentityId ?? undefined,
        displayName: from.displayName,
        locationCity: from.locationCity,
        locationCountry: from.locationCountry,
        timezone: from.timezone,
        primaryRole: from.primaryRole,
        talentType: "AGENCY_AGENT",
        status: "DRAFT",
        availabilityStatus: "UNAVAILABLE",
        privateContact: from.privateContact ? { create: { fullLegalName: from.privateContact.fullLegalName, personalEmail: from.privateContact.personalEmail ?? undefined, phone: from.privateContact.phone ?? undefined } } : undefined,
      },
      select: { id: true },
    });
  },
  profileBasics(db: Db, agentProfileId: string) {
    return db.agentProfile.findUnique({ where: { id: agentProfileId }, select: { id: true, status: true, archivedAt: true, userId: true, platformIdentityId: true, formerAgencyId: true, formerAt: true, displayName: true } });
  },
};
