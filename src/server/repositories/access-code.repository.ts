import type { Db } from "@/server/db/types";

const staffInclude = { course: { select: { id: true, title: true, currency: true, priceCents: true } } } as const;

export const accessCodeRepository = {
  create(db: Db, d: { code: string; courseId: string; buyerEmail: string | null; paymentReference: string; note: string | null; expiresAt: Date; createdById: string }) {
    return db.accessCode.create({ data: d, include: staffInclude });
  },
  findByCode(db: Db, code: string) {
    return db.accessCode.findUnique({ where: { code }, include: staffInclude });
  },
  findById(db: Db, id: string) {
    return db.accessCode.findUnique({ where: { id }, include: staffInclude });
  },
  list(db: Db, take = 300) {
    return db.accessCode.findMany({ orderBy: { createdAt: "desc" }, take, include: staffInclude });
  },
  /**
   * Unused to redeemed, once. The WHERE clause is the single-use guarantee: two buyers racing for the same code cannot both
   * change a row, so only one gets a count of 1.
   */
  async claim(db: Db, id: string, d: { redeemedById: string; enrollmentId: string; now: Date }) {
    const r = await db.accessCode.updateMany({
      where: { id, status: "UNUSED", expiresAt: { gt: d.now } },
      data: { status: "REDEEMED", redeemedById: d.redeemedById, redeemedAt: d.now, enrollmentId: d.enrollmentId },
    });
    return r.count;
  },
  async void(db: Db, id: string, d: { voidedById: string; reason: string; now: Date }) {
    const r = await db.accessCode.updateMany({ where: { id, status: "UNUSED" }, data: { status: "VOIDED", voidedById: d.voidedById, voidedAt: d.now, voidReason: d.reason } });
    return r.count;
  },
  userBasics(db: Db, ids: string[]) {
    return db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
  },
  buyerEmail(db: Db, userId: string) {
    return db.user.findUnique({ where: { id: userId }, select: { email: true } });
  },
};
