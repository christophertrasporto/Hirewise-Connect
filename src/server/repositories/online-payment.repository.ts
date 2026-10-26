import type { OnlinePaymentStatus, Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";

const include = { enrollment: { select: { id: true, courseId: true, agentProfileId: true, priceCents: true, currency: true, paymentStatus: true, course: { select: { id: true, title: true } }, agentProfile: { select: { userId: true, user: { select: { email: true } } } } } } } satisfies Prisma.OnlinePaymentInclude;
export type OnlinePaymentRecord = Prisma.OnlinePaymentGetPayload<{ include: typeof include }>;

export const onlinePaymentRepository = {
  create(db: Db, d: { provider: string; enrollmentId: string; amountMinor: number; currency: string }) {
    return db.onlinePayment.create({ data: d, include });
  },
  findById(db: Db, id: string) {
    return db.onlinePayment.findUnique({ where: { id }, include });
  },
  findByProviderId(db: Db, provider: string, id: string) {
    return db.onlinePayment.findFirst({ where: { provider, OR: [{ checkoutId: id }, { providerPaymentId: id }] }, include });
  },
  /** A checkout started recently and not finished: reused so a double click does not create two. */
  findOpen(db: Db, enrollmentId: string, since: Date) {
    return db.onlinePayment.findFirst({ where: { enrollmentId, status: "PENDING", redirectUrl: { not: null }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, include });
  },
  latestOpenForEnrollment(db: Db, enrollmentId: string) {
    return db.onlinePayment.findFirst({ where: { enrollmentId, status: { in: ["CREATED", "PENDING"] } }, orderBy: { createdAt: "desc" }, include });
  },
  update(db: Db, id: string, data: Prisma.OnlinePaymentUncheckedUpdateInput) {
    return db.onlinePayment.update({ where: { id }, data });
  },
  /** Moves a payment to a new status only from the given statuses. Returns how many rows changed. */
  async transition(db: Db, id: string, from: OnlinePaymentStatus[], data: Prisma.OnlinePaymentUncheckedUpdateManyInput) {
    const r = await db.onlinePayment.updateMany({ where: { id, status: { in: from } }, data });
    return r.count;
  },
  listToReconcile(db: Db, olderThan: Date, newerThan: Date, take = 25) {
    return db.onlinePayment.findMany({ where: { status: { in: ["CREATED", "PENDING"] }, createdAt: { lte: olderThan, gte: newerThan } }, orderBy: { createdAt: "asc" }, take, select: { id: true } });
  },
  listForEnrollment(db: Db, enrollmentId: string) {
    return db.onlinePayment.findMany({ where: { enrollmentId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, status: true, amountMinor: true, currency: true, createdAt: true, paidAt: true } });
  },
};
