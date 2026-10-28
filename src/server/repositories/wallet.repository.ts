import type { CoachEarningStatus, CoachWithdrawalStatus, EarningFeeSource, PayoutMethodKind, Prisma, WalletEntryType } from "@prisma/client";
import type { Db } from "@/server/db/types";

const earningInclude = { coach: { select: { id: true, email: true } } } satisfies Prisma.CoachEarningInclude;
export type CoachEarningRecord = Prisma.CoachEarningGetPayload<{ include: typeof earningInclude }>;
export type WithdrawalRecord = Prisma.CoachWithdrawalGetPayload<{ include: { coach: { select: { id: true; email: true } } } }>;

export const walletRepository = {
  /** Serialises everything that changes one coach's money inside a transaction. */
  async lockCoach(db: Db, coachUserId: string) {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"wallet:" + coachUserId}))`;
  },

  // Who may earn, and what the buyer is called
  coachBasics(db: Db, userId: string) {
    return db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, deletedAt: true, role: { select: { key: true } } } });
  },
  buyerBasics(db: Db, userId: string) {
    return db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, agentProfiles: { select: { displayName: true }, orderBy: { createdAt: "desc" }, take: 1 } } });
  },
  coachUsers(db: Db) {
    return db.user.findMany({ where: { role: { key: "COACH" }, deletedAt: null }, select: { id: true, email: true }, orderBy: { email: "asc" } });
  },

  // Earnings
  findByEnrollment(db: Db, enrollmentId: string) {
    return db.coachEarning.findUnique({ where: { enrollmentId }, include: earningInclude });
  },
  findEarning(db: Db, id: string) {
    return db.coachEarning.findUnique({ where: { id }, include: earningInclude });
  },
  createEarning(db: Db, d: Prisma.CoachEarningUncheckedCreateInput) {
    return db.coachEarning.create({ data: d, include: earningInclude });
  },
  updateEarning(db: Db, id: string, d: Prisma.CoachEarningUncheckedUpdateInput) {
    return db.coachEarning.update({ where: { id }, data: d, include: earningInclude });
  },
  listEarningsFor(db: Db, coachUserId: string, f: { courseId?: string; from?: Date; to?: Date } = {}, take = 500) {
    return db.coachEarning.findMany({
      where: { coachUserId, ...(f.courseId ? { courseId: f.courseId } : {}), ...(f.from || f.to ? { paidAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}) },
      orderBy: { paidAt: "desc" },
      take,
      include: { ...earningInclude },
    });
  },
  listPendingFee(db: Db, take = 500) {
    return db.coachEarning.findMany({ where: { status: "PENDING_FEE" }, orderBy: { paidAt: "asc" }, take, include: earningInclude });
  },
  /** On-hold earnings whose hold has ended. Returns how many moved. Idempotent. */
  async releaseDue(db: Db, now: Date) {
    const r = await db.coachEarning.updateMany({ where: { status: "ON_HOLD", availableAt: { lte: now } }, data: { status: "AVAILABLE" } });
    return r.count;
  },
  /** Oldest available earnings first, marked withdrawn while the paid amount still covers each one whole. */
  async markWithdrawnUpTo(db: Db, coachUserId: string, amount: number) {
    const rows = await db.coachEarning.findMany({ where: { coachUserId, status: "AVAILABLE" }, orderBy: { paidAt: "asc" }, select: { id: true, coachAmount: true, coachReversedMinor: true } });
    let left = amount;
    for (const r of rows) {
      const worth = (r.coachAmount ?? 0) - r.coachReversedMinor;
      if (worth <= 0 || worth > left) continue;
      await db.coachEarning.update({ where: { id: r.id }, data: { status: "WITHDRAWN" } });
      left -= worth;
    }
  },
  /** Credited but not yet withdrawable: on-hold earnings, net of any part already refunded. */
  async onHoldTotal(db: Db, coachUserId: string, currency: string) {
    const rows = await db.coachEarning.findMany({ where: { coachUserId, status: "ON_HOLD", currency }, select: { coachAmount: true, coachReversedMinor: true } });
    return rows.reduce((n, r) => n + (r.coachAmount ?? 0) - r.coachReversedMinor, 0);
  },
  async pendingFeeSummary(db: Db, coachUserId: string, currency: string) {
    const a = await db.coachEarning.aggregate({ where: { coachUserId, status: "PENDING_FEE", currency }, _count: { _all: true }, _sum: { saleAmount: true } });
    return { count: a._count._all, saleMinor: a._sum.saleAmount ?? 0 };
  },
  async nextAvailableAt(db: Db, coachUserId: string) {
    const r = await db.coachEarning.findFirst({ where: { coachUserId, status: "ON_HOLD" }, orderBy: { availableAt: "asc" }, select: { availableAt: true } });
    return r?.availableAt ?? null;
  },
  earningsInRange(db: Db, f: { from?: Date; to?: Date; coachUserId?: string }) {
    return db.coachEarning.findMany({
      where: { ...(f.coachUserId ? { coachUserId: f.coachUserId } : {}), ...(f.from || f.to ? { paidAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}) },
      include: earningInclude,
      orderBy: { paidAt: "asc" },
    });
  },

  // Ledger (append-only)
  addEntry(db: Db, d: { coachUserId: string; type: WalletEntryType; amount: number; currency: string; earningId?: string | null; withdrawalId?: string | null; note?: string | null; createdById?: string | null }) {
    return db.walletLedgerEntry.create({ data: { coachUserId: d.coachUserId, type: d.type, amount: d.amount, currency: d.currency, earningId: d.earningId ?? null, withdrawalId: d.withdrawalId ?? null, note: d.note ?? null, createdById: d.createdById ?? null } });
  },
  async ledgerTotal(db: Db, coachUserId: string, currency: string) {
    const a = await db.walletLedgerEntry.aggregate({ where: { coachUserId, currency }, _sum: { amount: true } });
    return a._sum.amount ?? 0;
  },
  listLedger(db: Db, coachUserId: string, take = 300) {
    return db.walletLedgerEntry.findMany({ where: { coachUserId }, orderBy: { createdAt: "desc" }, take });
  },

  // Withdrawals
  createWithdrawal(db: Db, d: { coachUserId: string; amount: number; currency: string; method: PayoutMethodKind; accountName: string; accountNumberEnc: string; bankName: string | null; accountLabel: string }) {
    return db.coachWithdrawal.create({ data: d, include: { coach: { select: { id: true, email: true } } } });
  },
  findWithdrawal(db: Db, id: string) {
    return db.coachWithdrawal.findUnique({ where: { id }, include: { coach: { select: { id: true, email: true } } } });
  },
  openWithdrawalFor(db: Db, coachUserId: string) {
    return db.coachWithdrawal.findFirst({ where: { coachUserId, status: { in: ["REQUESTED", "APPROVED"] } } });
  },
  listWithdrawalsFor(db: Db, coachUserId: string, take = 100) {
    return db.coachWithdrawal.findMany({ where: { coachUserId }, orderBy: { requestedAt: "desc" }, take, include: { coach: { select: { id: true, email: true } } } });
  },
  listWithdrawals(db: Db, statuses: CoachWithdrawalStatus[], take = 200) {
    return db.coachWithdrawal.findMany({ where: { status: { in: statuses } }, orderBy: { requestedAt: "asc" }, take, include: { coach: { select: { id: true, email: true } } } });
  },
  updateWithdrawal(db: Db, id: string, d: Prisma.CoachWithdrawalUncheckedUpdateInput) {
    return db.coachWithdrawal.update({ where: { id }, data: d, include: { coach: { select: { id: true, email: true } } } });
  },
  async paidTotal(db: Db, coachUserId: string, currency: string) {
    const a = await db.coachWithdrawal.aggregate({ where: { coachUserId, currency, status: "PAID" }, _sum: { amount: true } });
    return a._sum.amount ?? 0;
  },

  // Special rates
  findOverride(db: Db, coachUserId: string) {
    return db.coachShareOverride.findUnique({ where: { coachUserId } });
  },
  listOverrides(db: Db) {
    return db.coachShareOverride.findMany({ include: { coach: { select: { id: true, email: true } } }, orderBy: { updatedAt: "desc" } });
  },
  upsertOverride(db: Db, coachUserId: string, d: { shareBps: number; note: string; createdById: string }) {
    return db.coachShareOverride.upsert({ where: { coachUserId }, create: { coachUserId, ...d }, update: d });
  },
  deleteOverride(db: Db, coachUserId: string) {
    return db.coachShareOverride.deleteMany({ where: { coachUserId } });
  },

  // Payout account (shared with the referral program: one account per member)
  findPayoutDetails(db: Db, userId: string) {
    return db.payoutDetails.findUnique({ where: { userId } });
  },
  upsertPayoutDetails(db: Db, userId: string, d: { method: PayoutMethodKind; accountName: string; accountNumberEnc: string; bankName: string | null }) {
    return db.payoutDetails.upsert({ where: { userId }, create: { userId, ...d }, update: d });
  },

  // Fee lookups: a settlement report names a Maya payment id, our request reference number, or the enrolment id
  findOnlinePaymentByReference(db: Db, ref: string) {
    return db.onlinePayment.findFirst({ where: { OR: [{ id: ref }, { providerPaymentId: ref }, { checkoutId: ref }] }, select: { enrollmentId: true } });
  },

  // Coach-facing facts about an enrolment
  enrollmentForEarning(db: Db, id: string) {
    return db.courseEnrollment.findUnique({
      where: { id },
      select: { id: true, courseId: true, paidCents: true, priceCents: true, currency: true, paymentStatus: true, refundedCents: true, paidAt: true, agentProfile: { select: { userId: true, displayName: true } }, course: { select: { title: true, ownerCoachUserId: true } } },
    });
  },
};

export type { CoachEarningStatus, EarningFeeSource };
