import type { CommissionSourceType, CommissionStatus, PayoutMethodKind, PayoutStatus, ReferralFlagKind, AdjustmentKind } from "@prisma/client";
import type { Db } from "@/server/db/types";

/** Referral program queries: codes, clicks, attribution, flags, commissions, adjustments, and payouts. */

const ELIGIBLE_ROLES = ["AGENT", "AGENCY_OWNER"] as const;

export const referralRepository = {
  // ---------------------------------------------------------------- users and codes
  userForCode(db: Db, code: string) {
    return db.user.findUnique({ where: { referralCode: code }, select: { id: true, email: true, status: true, deletedAt: true, role: { select: { key: true } } } });
  },
  userBasics(db: Db, id: string) {
    return db.user.findUnique({ where: { id }, select: { id: true, email: true, referralCode: true, referredByUserId: true, referredAt: true, status: true, deletedAt: true, role: { select: { key: true } } } });
  },
  /** First name for the code prefix and the buyer label: an active talent profile, a client contact, or nothing. */
  async nameFor(db: Db, userId: string): Promise<string | null> {
    const p = await db.agentProfile.findFirst({ where: { userId, archivedAt: null }, select: { displayName: true } });
    if (p?.displayName) return p.displayName;
    const c = await db.clientContact.findFirst({ where: { userId }, select: { name: true } });
    return c?.name ?? null;
  },
  async namesFor(db: Db, userIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!userIds.length) return out;
    const profiles = await db.agentProfile.findMany({ where: { userId: { in: userIds }, archivedAt: null }, select: { userId: true, displayName: true } });
    for (const p of profiles) out.set(p.userId, p.displayName);
    const contacts = await db.clientContact.findMany({ where: { userId: { in: userIds } }, select: { userId: true, name: true } });
    for (const c of contacts) if (c.userId && !out.has(c.userId)) out.set(c.userId, c.name);
    return out;
  },
  setCode(db: Db, userId: string, code: string) {
    return db.user.update({ where: { id: userId }, data: { referralCode: code }, select: { referralCode: true } });
  },
  codeTaken(db: Db, code: string) {
    return db.user.findUnique({ where: { referralCode: code }, select: { id: true } });
  },
  isEligibleRole(role: string) {
    return (ELIGIBLE_ROLES as readonly string[]).includes(role);
  },

  // ---------------------------------------------------------------- clicks and attribution
  createClick(db: Db, d: { referrerId: string; landingUrl: string; ipHash: string | null; userAgent: string | null }) {
    return db.referralClick.create({ data: d, select: { id: true } });
  },
  /** Sets the referrer once. Returns how many rows changed (0 when the user already has one). */
  async attach(db: Db, userId: string, referrerId: string, at: Date) {
    const r = await db.user.updateMany({ where: { id: userId, referredByUserId: null }, data: { referredByUserId: referrerId, referredAt: at } });
    return r.count;
  },
  async recentSessionIps(db: Db, userId: string, since: Date): Promise<string[]> {
    const rows = await db.session.findMany({ where: { userId, createdAt: { gte: since }, ipAddress: { not: null } }, select: { ipAddress: true }, take: 100, orderBy: { createdAt: "desc" } });
    return [...new Set(rows.map((r) => r.ipAddress!).filter(Boolean))];
  },
  async phonesFor(db: Db, userId: string): Promise<string[]> {
    const [profiles, contacts, agencies] = await Promise.all([
      db.agentProfile.findMany({ where: { userId }, select: { privateContact: { select: { phone: true } } } }),
      db.clientContact.findMany({ where: { userId }, select: { phone: true } }),
      db.agency.findMany({ where: { ownerUserId: userId }, select: { contactPhone: true } }),
    ]);
    return [...profiles.map((p) => p.privateContact?.phone), ...contacts.map((c) => c.phone), ...agencies.map((a) => a.contactPhone)].filter((x): x is string => !!x);
  },
  async createFlags(db: Db, rows: Array<{ referrerId: string; referredUserId: string; kind: ReferralFlagKind; detail: string | null }>) {
    if (!rows.length) return 0;
    const r = await db.referralFlag.createMany({ data: rows, skipDuplicates: true });
    return r.count;
  },
  listFlags(db: Db, f: { referrerId?: string; open?: boolean } = {}) {
    return db.referralFlag.findMany({ where: { ...(f.referrerId ? { referrerId: f.referrerId } : {}), ...(f.open ? { reviewedAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, referrerId: true, referredUserId: true, kind: true, detail: true, createdAt: true, reviewedAt: true } });
  },
  findFlag(db: Db, id: string) {
    return db.referralFlag.findUnique({ where: { id }, select: { id: true } });
  },
  reviewFlag(db: Db, id: string, reviewedById: string) {
    return db.referralFlag.update({ where: { id }, data: { reviewedAt: new Date(), reviewedById } });
  },

  // ---------------------------------------------------------------- member totals
  clickCount(db: Db, referrerId: string) {
    return db.referralClick.count({ where: { referrerId } });
  },
  signupCount(db: Db, referrerId: string) {
    return db.user.count({ where: { referredByUserId: referrerId } });
  },
  referredUsers(db: Db, referrerId: string) {
    return db.user.findMany({ where: { referredByUserId: referrerId }, orderBy: { referredAt: "desc" }, take: 200, select: { id: true, referredAt: true } });
  },

  // ---------------------------------------------------------------- commissions
  findBySource(db: Db, sourceType: CommissionSourceType, sourceId: string) {
    return db.commission.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } }, include: { payout: { select: { id: true, status: true } } } });
  },
  findCommission(db: Db, id: string) {
    return db.commission.findUnique({ where: { id }, include: { payout: { select: { id: true, status: true } } } });
  },
  /** ON CONFLICT DO NOTHING: a repeated payment event never creates a second row and never aborts the transaction. */
  async createCommissionOnce(db: Db, d: { referrerId: string; buyerId: string; sourceType: CommissionSourceType; sourceId: string; courseId: string; courseTitle: string; saleAmount: number; rateBps: number; commissionAmount: number; currency: string; status: CommissionStatus; availableAt: Date }) {
    const r = await db.commission.createMany({ data: [d], skipDuplicates: true });
    return r.count === 1;
  },
  async releaseDue(db: Db, now: Date) {
    const r = await db.commission.updateMany({ where: { status: "ON_HOLD", availableAt: { lte: now } }, data: { status: "PAYABLE" } });
    return r.count;
  },
  markReversed(db: Db, id: string, reason: string) {
    return db.commission.update({ where: { id }, data: { status: "REVERSED", reversedAt: new Date(), reversedReason: reason, payoutId: null } });
  },
  listCommissionsFor(db: Db, referrerId: string, take = 200) {
    return db.commission.findMany({ where: { referrerId }, orderBy: { createdAt: "desc" }, take });
  },
  async sumByStatus(db: Db, referrerId: string, currency: string): Promise<Record<CommissionStatus, number>> {
    const rows = await db.commission.groupBy({ by: ["status"], where: { referrerId, currency }, _sum: { commissionAmount: true } });
    const out = { ON_HOLD: 0, PAYABLE: 0, PAID: 0, REVERSED: 0 } as Record<CommissionStatus, number>;
    for (const r of rows) out[r.status] = r._sum.commissionAmount ?? 0;
    return out;
  },
  commissionCount(db: Db, referrerId: string) {
    return db.commission.count({ where: { referrerId, status: { not: "REVERSED" } } });
  },
  payableUnassigned(db: Db, referrerId: string, currency: string) {
    return db.commission.findMany({ where: { referrerId, currency, status: "PAYABLE", payoutId: null }, select: { id: true, commissionAmount: true } });
  },

  // ---------------------------------------------------------------- adjustments
  createAdjustment(db: Db, d: { referrerId: string; commissionId: string | null; kind: AdjustmentKind; amount: number; currency: string; note: string; createdById: string }) {
    return db.commissionAdjustment.create({ data: d });
  },
  unsettledAdjustments(db: Db, referrerId: string, currency: string) {
    return db.commissionAdjustment.findMany({ where: { referrerId, currency, settledPayoutId: null }, select: { id: true, amount: true } });
  },
  listAdjustmentsFor(db: Db, referrerId: string) {
    return db.commissionAdjustment.findMany({ where: { referrerId }, orderBy: { createdAt: "desc" }, take: 100 });
  },

  // ---------------------------------------------------------------- payouts
  findPayoutDetails(db: Db, userId: string) {
    return db.payoutDetails.findUnique({ where: { userId } });
  },
  upsertPayoutDetails(db: Db, userId: string, d: { method: PayoutMethodKind; accountName: string; accountNumberEnc: string; bankName: string | null }) {
    return db.payoutDetails.upsert({ where: { userId }, create: { userId, ...d }, update: d });
  },
  createPayout(db: Db, d: { referrerId: string; amount: number; currency: string; method: PayoutMethodKind; accountLabel: string }) {
    return db.payout.create({ data: d });
  },
  findPayout(db: Db, id: string) {
    return db.payout.findUnique({ where: { id }, include: { commissions: { select: { id: true, commissionAmount: true } } } });
  },
  listPayoutsFor(db: Db, referrerId: string) {
    return db.payout.findMany({ where: { referrerId }, orderBy: { requestedAt: "desc" }, take: 50 });
  },
  listPayouts(db: Db, status?: PayoutStatus) {
    return db.payout.findMany({ where: status ? { status } : {}, orderBy: { requestedAt: "asc" }, take: 200, include: { referrer: { select: { id: true, email: true } } } });
  },
  /** Claims commissions for a payout; returns how many were claimed so the caller can detect a lost race. */
  async claimCommissions(db: Db, ids: string[], payoutId: string) {
    const r = await db.commission.updateMany({ where: { id: { in: ids }, payoutId: null, status: "PAYABLE" }, data: { payoutId } });
    return r.count;
  },
  async claimAdjustments(db: Db, ids: string[], payoutId: string) {
    if (!ids.length) return 0;
    const r = await db.commissionAdjustment.updateMany({ where: { id: { in: ids }, settledPayoutId: null }, data: { settledPayoutId: payoutId } });
    return r.count;
  },
  async releasePayoutClaims(db: Db, payoutId: string) {
    await db.commission.updateMany({ where: { payoutId, status: "PAYABLE" }, data: { payoutId: null } });
    await db.commissionAdjustment.updateMany({ where: { settledPayoutId: payoutId }, data: { settledPayoutId: null } });
  },
  async markPayoutCommissionsPaid(db: Db, payoutId: string, at: Date) {
    await db.commission.updateMany({ where: { payoutId, status: "PAYABLE" }, data: { status: "PAID", paidAt: at } });
  },
  setPayout(db: Db, id: string, d: { status?: PayoutStatus; reference?: string | null; rejectReason?: string | null; decidedById?: string; decidedAt?: Date; paidAt?: Date; amount?: number }) {
    return db.payout.update({ where: { id }, data: d });
  },
  async paidTotal(db: Db, referrerId: string, currency: string) {
    const r = await db.payout.aggregate({ where: { referrerId, currency, status: "PAID" }, _sum: { amount: true } });
    return r._sum.amount ?? 0;
  },

  // ---------------------------------------------------------------- staff lists
  async affiliateRows(db: Db) {
    const [clicks, signups, commissions, flags, payouts] = await Promise.all([
      db.referralClick.groupBy({ by: ["referrerId"], _count: { _all: true } }),
      db.user.groupBy({ by: ["referredByUserId"], where: { referredByUserId: { not: null } }, _count: { _all: true } }),
      db.commission.groupBy({ by: ["referrerId", "status"], _sum: { commissionAmount: true }, _count: { _all: true } }),
      db.referralFlag.groupBy({ by: ["referrerId"], where: { reviewedAt: null }, _count: { _all: true } }),
      db.payout.groupBy({ by: ["referrerId"], where: { status: "PAID" }, _sum: { amount: true } }),
    ]);
    return { clicks, signups, commissions, flags, payouts };
  },
  usersByIds(db: Db, ids: string[]) {
    return db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, referralCode: true, role: { select: { key: true } } } });
  },
};
