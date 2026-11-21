import { z } from "zod";

/**
 * Staff view of every course purchase: how one is classified, how the filters are read from the address, how totals are
 * kept per currency, and the CSV. Pure functions only; the data comes from `purchase.service.ts`.
 */

export const PURCHASE_STATUSES = ["PAID", "PENDING", "REFUNDED", "WAIVED"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const PURCHASE_METHODS = ["PAYPAL", "MAYA", "MANUAL", "ACCESS_CODE", "COURSE_SEAT", "WAIVED"] as const;
export type PurchaseMethod = (typeof PURCHASE_METHODS)[number];

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = { PAID: "Paid", PENDING: "Pending", REFUNDED: "Refunded", WAIVED: "Waived" };
export const PURCHASE_METHOD_LABEL: Record<PurchaseMethod, string> = {
  PAYPAL: "PayPal",
  MAYA: "Maya",
  MANUAL: "Bank / GCash (recorded by staff)",
  ACCESS_CODE: "Access code",
  COURSE_SEAT: "Agency course seat",
  WAIVED: "Waived by staff",
};

export const PURCHASES_PAGE_SIZE = 50;
export const PURCHASES_CSV_LIMIT = 5000;

type MethodFacts = { paymentStatus: string; hasPaidOnlinePayment: string | null; hasAccessCode: boolean; hasCourseSeat: boolean };

/** How a purchase was paid. The first rule that fits wins: a confirmed online payment, an access code, an agency seat, a waiver, else staff recorded it. */
export function purchaseMethod(f: MethodFacts): PurchaseMethod {
  if (f.hasPaidOnlinePayment === "PAYPAL") return "PAYPAL";
  if (f.hasPaidOnlinePayment === "MAYA") return "MAYA";
  if (f.hasAccessCode) return "ACCESS_CODE";
  if (f.hasCourseSeat) return "COURSE_SEAT";
  if (f.paymentStatus === "WAIVED") return "WAIVED";
  return "MANUAL";
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-30.");

export const purchaseQuerySchema = z.object({
  status: z.enum(PURCHASE_STATUSES).optional(),
  method: z.enum(PURCHASE_METHODS).optional(),
  courseId: z.string().trim().min(1).max(40).optional(),
  from: day.optional(),
  to: day.optional(),
  search: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type PurchaseQuery = z.output<typeof purchaseQuerySchema>;

/** Reads the filters from the page address. Blank values mean "no filter"; anything else that is not understood is an error. */
export function parsePurchaseQuery(sp: Record<string, string | string[] | undefined>): { ok: true; query: PurchaseQuery } | { ok: false; query: PurchaseQuery } {
  const one = (k: string) => {
    const v = Array.isArray(sp[k]) ? sp[k]![0] : sp[k];
    return typeof v === "string" && v.trim() !== "" ? v : undefined;
  };
  const parsed = purchaseQuerySchema.safeParse({ status: one("status"), method: one("method"), courseId: one("course"), from: one("from"), to: one("to"), search: one("q"), page: one("page") });
  if (parsed.success && !(parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to)) return { ok: true, query: parsed.data };
  return { ok: false, query: purchaseQuerySchema.parse({}) };
}

/** The same filters as address parameters, for the page links and the CSV link. */
export function purchaseQueryString(q: Partial<PurchaseQuery>, over: Partial<PurchaseQuery> = {}): string {
  const m = { ...q, ...over };
  const p = new URLSearchParams();
  if (m.status) p.set("status", m.status);
  if (m.method) p.set("method", m.method);
  if (m.courseId) p.set("course", m.courseId);
  if (m.from) p.set("from", m.from);
  if (m.to) p.set("to", m.to);
  if (m.search) p.set("q", m.search);
  if (m.page && m.page > 1) p.set("page", String(m.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The start of the first day and the start of the day after the last one, so a "to" date includes that whole day (UTC). */
export function purchaseDateRange(q: Pick<PurchaseQuery, "from" | "to">): { gte?: Date; lt?: Date } {
  const out: { gte?: Date; lt?: Date } = {};
  if (q.from) out.gte = new Date(`${q.from}T00:00:00.000Z`);
  if (q.to) out.lt = new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + 24 * 3_600_000);
  return out;
}

export type TotalsRow = { currency: string; paymentStatus: string; count: number; priceCents: number; paidCents: number; refundedCents: number };
export type CurrencyTotals = { currency: string; purchases: number; collectedCents: number; refundedCents: number; netCents: number; pendingCents: number; pendingCount: number };

/** Totals per currency. A PHP amount is never added to a USD one. Collected counts paid and refunded sales; net takes the refunds off. */
export function purchaseTotals(rows: TotalsRow[]): CurrencyTotals[] {
  const by = new Map<string, CurrencyTotals>();
  for (const r of rows) {
    const t = by.get(r.currency) ?? { currency: r.currency, purchases: 0, collectedCents: 0, refundedCents: 0, netCents: 0, pendingCents: 0, pendingCount: 0 };
    t.purchases += r.count;
    if (r.paymentStatus === "PAID" || r.paymentStatus === "REFUNDED") {
      t.collectedCents += r.paidCents;
      t.refundedCents += r.refundedCents;
    }
    if (r.paymentStatus === "PENDING") {
      t.pendingCents += r.priceCents;
      t.pendingCount += r.count;
    }
    t.netCents = t.collectedCents - t.refundedCents;
    by.set(r.currency, t);
  }
  return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** A cell that is safe to open in a spreadsheet: quoted when needed, and a leading = + - @ is defused so it cannot run as a formula. */
export function csvCell(value: string | number | null | undefined): string {
  let v = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export type PurchaseCsvRow = { purchasedAt: Date; paidAt: Date | null; buyer: string; course: string; currency: string; amountCents: number; listPriceCents: number | null; paidCents: number | null; refundedCents: number; status: PurchaseStatus; method: PurchaseMethod; reference: string | null };

const dec = (cents: number) => (cents / 100).toFixed(2);

export function purchasesCsv(rows: PurchaseCsvRow[]): string {
  const head = ["Purchased", "Paid", "Buyer", "Course", "Currency", "Amount due", "List price", "Amount paid", "Refunded", "Status", "Method", "Reference"];
  const lines = rows.map((r) =>
    [
      r.purchasedAt.toISOString().slice(0, 10),
      r.paidAt ? r.paidAt.toISOString().slice(0, 10) : "",
      r.buyer,
      r.course,
      r.currency,
      dec(r.amountCents),
      r.listPriceCents == null ? "" : dec(r.listPriceCents),
      r.paidCents == null ? "" : dec(r.paidCents),
      r.refundedCents ? dec(r.refundedCents) : "",
      PURCHASE_STATUS_LABEL[r.status],
      PURCHASE_METHOD_LABEL[r.method],
      r.reference ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n") + "\n";
}
