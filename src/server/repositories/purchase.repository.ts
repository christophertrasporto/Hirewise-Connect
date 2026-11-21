import type { Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";
import { PURCHASE_STATUSES, purchaseDateRange, type PurchaseQuery } from "@/lib/purchases";

/** Free enrolments (NOT_REQUIRED) are not purchases and never appear. */
function purchaseWhere(q: PurchaseQuery): Prisma.CourseEnrollmentWhereInput {
  const and: Prisma.CourseEnrollmentWhereInput[] = [{ paymentStatus: q.status ?? { in: [...PURCHASE_STATUSES] } }];
  if (q.courseId) and.push({ courseId: q.courseId });
  const range = purchaseDateRange(q);
  if (range.gte || range.lt) and.push({ enrolledAt: range });
  if (q.search) {
    and.push({ OR: [{ agentProfile: { displayName: { contains: q.search, mode: "insensitive" } } }, { course: { title: { contains: q.search, mode: "insensitive" } } }, { paymentReference: { contains: q.search, mode: "insensitive" } }] });
  }
  switch (q.method) {
    case "PAYPAL":
    case "MAYA":
      and.push({ onlinePayments: { some: { provider: q.method, status: "PAID" } } });
      break;
    case "ACCESS_CODE":
      and.push({ accessCode: { isNot: null } });
      break;
    case "COURSE_SEAT":
      and.push({ courseSeatAssignmentId: { not: null } });
      break;
    case "WAIVED":
      and.push({ paymentStatus: "WAIVED" });
      break;
    case "MANUAL":
      and.push({ paymentStatus: { in: ["PAID", "REFUNDED"] }, accessCode: { is: null }, courseSeatAssignmentId: null, onlinePayments: { none: { status: "PAID" } } });
      break;
  }
  return { AND: and };
}

const purchaseInclude = {
  course: { select: { id: true, title: true } },
  agentProfile: { select: { id: true, displayName: true } },
  accessCode: { select: { id: true } },
  onlinePayments: { where: { status: "PAID" as const }, select: { provider: true }, take: 1 },
} satisfies Prisma.CourseEnrollmentInclude;

export const purchaseRepository = {
  list(db: Db, q: PurchaseQuery, take: number, skip = 0) {
    return db.courseEnrollment.findMany({ where: purchaseWhere(q), include: purchaseInclude, orderBy: [{ enrolledAt: "desc" }, { id: "desc" }], take, skip });
  },
  count(db: Db, q: PurchaseQuery) {
    return db.courseEnrollment.count({ where: purchaseWhere(q) });
  },
  async totalsRows(db: Db, q: PurchaseQuery) {
    const rows = await db.courseEnrollment.groupBy({ by: ["currency", "paymentStatus"], where: purchaseWhere(q), _count: { _all: true }, _sum: { priceCents: true, paidCents: true, refundedCents: true } });
    return rows.map((r) => ({ currency: r.currency, paymentStatus: r.paymentStatus as string, count: r._count._all, priceCents: r._sum.priceCents ?? 0, paidCents: r._sum.paidCents ?? 0, refundedCents: r._sum.refundedCents ?? 0 }));
  },
  courseChoices(db: Db) {
    return db.academyCourse.findMany({ where: { status: { not: "DRAFT" } }, select: { id: true, title: true }, orderBy: { title: "asc" }, take: 500 });
  },
  failedOnlinePayments(db: Db, take = 50) {
    return db.onlinePayment.findMany({
      where: { status: { in: ["FAILED", "EXPIRED", "CANCELLED", "MISMATCH"] } },
      orderBy: { createdAt: "desc" },
      take,
      include: { enrollment: { select: { course: { select: { id: true, title: true } }, agentProfile: { select: { id: true, displayName: true } } } } },
    });
  },
};
