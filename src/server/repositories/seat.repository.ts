import type { Prisma, SeatLedgerType, SeatPurchaseStatus, SeatRequestStatus, BillingPeriod } from "@prisma/client";
import type { Db } from "@/server/db/types";

const requestInclude = { agency: { select: { id: true, name: true, ownerUserId: true, owner: { select: { email: true } } } } } satisfies Prisma.SeatRequestInclude;
const purchaseInclude = { agency: { select: { id: true, name: true, ownerUserId: true, owner: { select: { email: true } } } }, package: { select: { id: true, name: true } } } satisfies Prisma.SeatPurchaseInclude;

export type SeatRequestRecord = Prisma.SeatRequestGetPayload<{ include: typeof requestInclude }>;
export type SeatPurchaseRecord = Prisma.SeatPurchaseGetPayload<{ include: typeof purchaseInclude }>;

export const seatRepository = {
  // ---- plans and packages
  plans(db: Db, activeOnly = true) {
    return db.plan.findMany({ where: activeOnly ? { isActive: true } : {}, orderBy: { sortOrder: "asc" } });
  },
  planByKey(db: Db, key: string) {
    return db.plan.findUnique({ where: { key } });
  },
  planById(db: Db, id: string) {
    return db.plan.findUnique({ where: { id } });
  },
  upsertPlan(db: Db, d: { key: string; name: string; baseAgentSeats: number | null; priceMinor: number; currency: string; billingPeriod: BillingPeriod; trainingAccess: boolean; opportunityAccess: boolean; features: string[]; isActive: boolean; sortOrder: number }) {
    return db.plan.upsert({ where: { key: d.key }, create: d, update: d });
  },
  packages(db: Db, activeOnly = true) {
    return db.seatPackage.findMany({ where: activeOnly ? { isActive: true } : {}, orderBy: { sortOrder: "asc" } });
  },
  packageById(db: Db, id: string) {
    return db.seatPackage.findUnique({ where: { id } });
  },
  savePackage(db: Db, id: string | null, d: { name: string; seatCount: number; priceMinor: number; currency: string; isActive: boolean; sortOrder: number }) {
    return id ? db.seatPackage.update({ where: { id }, data: d }) : db.seatPackage.create({ data: d });
  },

  // ---- ledger
  async ledgerSums(db: Db, agencyId: string): Promise<{ sums: Partial<Record<SeatLedgerType, number>>; planReversed: number }> {
    const [rows, reversed] = await Promise.all([
      db.agencySeatLedger.groupBy({ by: ["changeType"], where: { agencyId }, _sum: { quantity: true } }),
      db.agencySeatLedger.aggregate({ where: { agencyId, changeType: "ADMIN_REMOVE", planId: { not: null } }, _sum: { quantity: true } }),
    ]);
    return { sums: Object.fromEntries(rows.map((r) => [r.changeType, r._sum.quantity ?? 0])), planReversed: reversed._sum.quantity ?? 0 };
  },
  ledgerHistory(db: Db, agencyId: string, take = 100) {
    return db.agencySeatLedger.findMany({ where: { agencyId }, orderBy: { createdAt: "desc" }, take, include: { plan: { select: { name: true } } } });
  },
  addLedger(db: Db, d: { agencyId: string; changeType: SeatLedgerType; quantity: number; reason: string | null; relatedAgentProfileId?: string | null; relatedMembershipId?: string | null; seatPurchaseId?: string | null; planId?: string | null; createdById: string | null; effectiveAt?: Date }) {
    return db.agencySeatLedger.create({ data: { ...d, reason: d.reason ?? undefined, relatedAgentProfileId: d.relatedAgentProfileId ?? undefined, relatedMembershipId: d.relatedMembershipId ?? undefined, seatPurchaseId: d.seatPurchaseId ?? undefined, planId: d.planId ?? undefined, createdById: d.createdById ?? undefined, effectiveAt: d.effectiveAt ?? undefined }, select: { id: true } });
  },
  /** Open memberships that never received a CONSUMED entry (agencies that joined before plans existed). */
  membershipsWithoutSeat(db: Db, agencyId: string) {
    return db.agencyMembership.findMany({ where: { agencyId, seatLedgerEntryId: null, status: { in: ["INVITED", "PENDING_VERIFICATION", "ACTIVE", "EXIT_REQUESTED", "REMOVAL_REQUESTED", "ENDING"] } }, select: { id: true, agentProfileId: true } });
  },

  // ---- seat requests
  createRequest(db: Db, d: { agencyId: string; requestedSeats: number; note: string | null; requestedById: string }) {
    return db.seatRequest.create({ data: { ...d, note: d.note ?? undefined }, include: requestInclude });
  },
  findRequest(db: Db, id: string) {
    return db.seatRequest.findUnique({ where: { id }, include: requestInclude });
  },
  listRequests(db: Db, f: { agencyId?: string; status?: SeatRequestStatus }, take = 100) {
    return db.seatRequest.findMany({ where: { ...(f.agencyId ? { agencyId: f.agencyId } : {}), ...(f.status ? { status: f.status } : {}) }, orderBy: { createdAt: "desc" }, take, include: requestInclude });
  },
  decideRequest(db: Db, id: string, d: { status: SeatRequestStatus; reviewedById: string; decisionNote: string | null; grantedSeats: number | null; ledgerEntryId: string | null }) {
    return db.seatRequest.update({ where: { id }, data: { status: d.status, reviewedById: d.reviewedById, decisionNote: d.decisionNote ?? undefined, grantedSeats: d.grantedSeats ?? undefined, ledgerEntryId: d.ledgerEntryId ?? undefined, reviewedAt: new Date() }, include: requestInclude });
  },
  async requestCounts(db: Db) {
    const rows = await db.seatRequest.groupBy({ by: ["status"], _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<Record<SeatRequestStatus, number>>;
  },

  // ---- purchases
  createPurchase(db: Db, d: { agencyId: string; packageId: string; seatCount: number; amountMinor: number; currency: string; requestedById: string; note: string | null }) {
    return db.seatPurchase.create({ data: { ...d, note: d.note ?? undefined }, include: purchaseInclude });
  },
  findPurchase(db: Db, id: string) {
    return db.seatPurchase.findUnique({ where: { id }, include: purchaseInclude });
  },
  listPurchases(db: Db, f: { agencyId?: string; status?: SeatPurchaseStatus }, take = 100) {
    return db.seatPurchase.findMany({ where: { ...(f.agencyId ? { agencyId: f.agencyId } : {}), ...(f.status ? { status: f.status } : {}) }, orderBy: { createdAt: "desc" }, take, include: purchaseInclude });
  },
  recordPurchase(db: Db, id: string, d: { status: SeatPurchaseStatus; recordedById: string; paymentReference: string | null; note: string | null; ledgerEntryId: string | null; paidAt: Date | null }) {
    return db.seatPurchase.update({ where: { id }, data: { status: d.status, recordedById: d.recordedById, paymentReference: d.paymentReference ?? undefined, note: d.note ?? undefined, ledgerEntryId: d.ledgerEntryId ?? undefined, paidAt: d.paidAt ?? undefined }, include: purchaseInclude });
  },
  async purchaseCounts(db: Db) {
    const rows = await db.seatPurchase.groupBy({ by: ["status"], _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<Record<SeatPurchaseStatus, number>>;
  },

  // ---- agency plan
  setAgencyPlan(db: Db, agencyId: string, planId: string | null) {
    return db.agency.update({ where: { id: agencyId }, data: { planId, planStartedAt: planId ? new Date() : null }, select: { id: true, planId: true } });
  },
};
