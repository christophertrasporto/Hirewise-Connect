import type { Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";

const codeInclude = { courses: { select: { courseId: true, course: { select: { id: true, title: true } } } } } satisfies Prisma.PromoCodeInclude;
export type PromoCodeRecord = Prisma.PromoCodeGetPayload<{ include: typeof codeInclude }>;

const redemptionInclude = {
  promoCode: { select: { id: true, code: true, label: true } },
  enrollment: { select: { id: true, courseId: true, course: { select: { title: true } }, agentProfile: { select: { displayName: true, user: { select: { email: true } } } } } },
} satisfies Prisma.PromoRedemptionInclude;
export type PromoRedemptionRecord = Prisma.PromoRedemptionGetPayload<{ include: typeof redemptionInclude }>;

const LIVE = ["RESERVED", "CONSUMED"] as const;

export const promoRepository = {
  findByCode(db: Db, code: string) {
    return db.promoCode.findUnique({ where: { code }, include: codeInclude });
  },
  findById(db: Db, id: string) {
    return db.promoCode.findUnique({ where: { id }, include: codeInclude });
  },
  list(db: Db) {
    return db.promoCode.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], include: codeInclude });
  },
  create(db: Db, d: Omit<Prisma.PromoCodeUncheckedCreateInput, "courses"> & { courseIds: string[] }) {
    const { courseIds, ...rest } = d;
    return db.promoCode.create({ data: { ...rest, courses: { create: courseIds.map((courseId) => ({ courseId })) } }, include: codeInclude });
  },
  async update(db: Db, id: string, d: Prisma.PromoCodeUncheckedUpdateInput, courseIds?: string[]) {
    if (courseIds) {
      await db.promoCodeCourse.deleteMany({ where: { promoCodeId: id } });
      if (courseIds.length) await db.promoCodeCourse.createMany({ data: courseIds.map((courseId) => ({ promoCodeId: id, courseId })) });
    }
    return db.promoCode.update({ where: { id }, data: d, include: codeInclude });
  },

  /** Serialises uses of one code inside a transaction, so two learners cannot both take the last use. */
  async lockCode(db: Db, id: string) {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"promo:" + id}))`;
  },
  countLive(db: Db, promoCodeId: string, exceptEnrollmentId?: string) {
    return db.promoRedemption.count({ where: { promoCodeId, status: { in: [...LIVE] }, ...(exceptEnrollmentId ? { enrollmentId: { not: exceptEnrollmentId } } : {}) } });
  },
  countLiveForUser(db: Db, promoCodeId: string, userId: string, exceptEnrollmentId?: string) {
    return db.promoRedemption.count({ where: { promoCodeId, userId, status: { in: [...LIVE] }, ...(exceptEnrollmentId ? { enrollmentId: { not: exceptEnrollmentId } } : {}) } });
  },
  liveForEnrollment(db: Db, enrollmentId: string) {
    return db.promoRedemption.findFirst({ where: { enrollmentId, status: { in: [...LIVE] } }, include: redemptionInclude });
  },
  createRedemption(db: Db, d: { promoCodeId: string; enrollmentId: string; userId: string; listPriceMinor: number; discountMinor: number; finalMinor: number; currency: string; consumed: boolean }) {
    const { consumed, ...rest } = d;
    return db.promoRedemption.create({ data: { ...rest, status: consumed ? "CONSUMED" : "RESERVED", consumedAt: consumed ? new Date() : null } });
  },
  /** Reserved to consumed, once. Returns how many rows changed. */
  async consumeForEnrollment(db: Db, enrollmentId: string) {
    const r = await db.promoRedemption.updateMany({ where: { enrollmentId, status: "RESERVED" }, data: { status: "CONSUMED", consumedAt: new Date() } });
    return r.count;
  },
  /** Reserved to released, only while still reserved (a consumed use is never given back). */
  async releaseReserved(db: Db, id: string, reason: string) {
    const r = await db.promoRedemption.updateMany({ where: { id, status: "RESERVED" }, data: { status: "RELEASED", releasedAt: new Date(), releaseReason: reason } });
    return r.count;
  },
  /** Reservations on enrolments that are still unpaid after the cut-off. */
  listStaleReservations(db: Db, before: Date, take = 100) {
    return db.promoRedemption.findMany({ where: { status: "RESERVED", createdAt: { lte: before }, enrollment: { paymentStatus: "PENDING" } }, orderBy: { createdAt: "asc" }, take, include: redemptionInclude });
  },
  listRedemptions(db: Db, promoCodeId: string, take = 200) {
    return db.promoRedemption.findMany({ where: { promoCodeId }, orderBy: { createdAt: "desc" }, take, include: redemptionInclude });
  },
  /** Live uses and the discount given, per code, for the staff list. Always computed, never stored. */
  usageByCode(db: Db) {
    return db.promoRedemption.groupBy({ by: ["promoCodeId", "status", "currency"], _count: { _all: true }, _sum: { discountMinor: true } });
  },
};
