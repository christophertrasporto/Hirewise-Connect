import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize } from "@/server/policies/authorize";
import { purchaseRepository } from "@/server/repositories/purchase.repository";
import { toPurchaseView, toFailedAttemptView } from "@/server/views/purchase.views";
import { PURCHASES_CSV_LIMIT, PURCHASES_PAGE_SIZE, purchaseQuerySchema, purchaseTotals, purchasesCsv, type PurchaseQuery } from "@/lib/purchases";

/**
 * Staff report of every course purchase (paid, pending, refunded, waived), with totals kept per currency, the online
 * attempts that failed, and a CSV. Read-only; everything here needs the same permission as recording a course payment.
 */

const PERMISSION = "course.payment.record" as const;

export async function listPurchases(db: PrismaClient, actor: Actor, raw: unknown = {}) {
  authorize(actor, PERMISSION);
  const q: PurchaseQuery = purchaseQuerySchema.parse(raw);
  const [rows, total, totalsRows, courses] = await Promise.all([
    purchaseRepository.list(db, q, PURCHASES_PAGE_SIZE, (q.page - 1) * PURCHASES_PAGE_SIZE),
    purchaseRepository.count(db, q),
    purchaseRepository.totalsRows(db, q),
    purchaseRepository.courseChoices(db),
  ]);
  return { query: q, purchases: rows.map(toPurchaseView), total, pageSize: PURCHASES_PAGE_SIZE, pages: Math.max(1, Math.ceil(total / PURCHASES_PAGE_SIZE)), totals: purchaseTotals(totalsRows), courses };
}

export async function listFailedOnlinePayments(db: PrismaClient, actor: Actor) {
  authorize(actor, PERMISSION);
  return (await purchaseRepository.failedOnlinePayments(db)).map(toFailedAttemptView);
}

/** The filtered purchases as a CSV (the same filters as the page, without paging, up to a fixed limit). */
export async function purchasesCsvReport(db: PrismaClient, actor: Actor, raw: unknown = {}): Promise<string> {
  authorize(actor, PERMISSION);
  const q: PurchaseQuery = purchaseQuerySchema.parse(raw);
  const rows = (await purchaseRepository.list(db, q, PURCHASES_CSV_LIMIT)).map(toPurchaseView);
  return purchasesCsv(rows.map((r) => ({ purchasedAt: r.purchasedAt, paidAt: r.paidAt, buyer: r.buyerName, course: r.courseTitle, currency: r.currency, amountCents: r.amountCents, listPriceCents: r.listPriceCents, paidCents: r.paidCents, refundedCents: r.refundedCents, status: r.status, method: r.method, reference: r.reference })));
}
