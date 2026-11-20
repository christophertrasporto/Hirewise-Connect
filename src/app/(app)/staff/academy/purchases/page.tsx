import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listFailedOnlinePayments, listPurchases } from "@/server/services/purchase-report.service";
import { formatMoney } from "@/server/views/seat.views";
import { Banner, Card, EmptyState, StatTile, fmtDate } from "@/components/app/ui";
import { PURCHASE_METHODS, PURCHASE_METHOD_LABEL, PURCHASE_STATUSES, PURCHASE_STATUS_LABEL, parsePurchaseQuery, purchaseQueryString, type PurchaseStatus } from "@/lib/purchases";

export const metadata: Metadata = { title: "Academy · All purchases" };

const field = "mt-1 block h-10 rounded-xl border border-ink-200 bg-white px-3 text-[13.5px] text-ink-800";
const STATUS_TONE: Record<PurchaseStatus, string> = { PAID: "bg-brand-50 text-brand-700", PENDING: "bg-amber-50 text-amber-800", REFUNDED: "bg-red-50 text-red-700", WAIVED: "bg-ink-100 text-ink-700" };

export default async function StaffAcademyPurchasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor();
  const parsed = parsePurchaseQuery(await searchParams);
  const [report, failed] = await Promise.all([listPurchases(prisma, actor, parsed.query), listFailedOnlinePayments(prisma, actor)]);
  const q = report.query;
  const csvHref = `/api/academy/purchases/export${purchaseQueryString({ ...q, page: 1 })}`;
  return (
    <div className="space-y-5">
      <Card title="All purchases" description="Every paid course in one list: how it was paid, the amount, and whether it has been refunded. Free enrolments are not listed. Amounts are kept per currency and never added across currencies.">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-[12.5px] font-semibold text-ink-600">Search
            <input type="search" name="q" defaultValue={q.search ?? ""} placeholder="Buyer, course, or reference" className={`${field} w-56`} />
          </label>
          <label className="text-[12.5px] font-semibold text-ink-600">Status
            <select name="status" defaultValue={q.status ?? ""} className={field}>
              <option value="">All</option>
              {PURCHASE_STATUSES.map((s) => <option key={s} value={s}>{PURCHASE_STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="text-[12.5px] font-semibold text-ink-600">Paid with
            <select name="method" defaultValue={q.method ?? ""} className={field}>
              <option value="">Any method</option>
              {PURCHASE_METHODS.map((m) => <option key={m} value={m}>{PURCHASE_METHOD_LABEL[m]}</option>)}
            </select>
          </label>
          <label className="text-[12.5px] font-semibold text-ink-600">Course
            <select name="course" defaultValue={q.courseId ?? ""} className={`${field} max-w-[14rem]`}>
              <option value="">All courses</option>
              {report.courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
          <label className="text-[12.5px] font-semibold text-ink-600">From<input type="date" name="from" defaultValue={q.from ?? ""} className={field} /></label>
          <label className="text-[12.5px] font-semibold text-ink-600">To<input type="date" name="to" defaultValue={q.to ?? ""} className={field} /></label>
          <button type="submit" className="h-10 rounded-full border border-ink-200 bg-white px-4 text-[13.5px] font-semibold text-ink-800 hover:bg-ink-50">Apply</button>
          <Link href="/staff/academy/purchases" className="h-10 self-center text-[13.5px] font-semibold text-ink-500 hover:text-ink-900">Clear</Link>
        </form>
        {!parsed.ok && <div className="mt-3"><Banner tone="warn" title="That filter was not understood">Showing everything instead.</Banner></div>}
      </Card>

      {report.totals.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {report.totals.map((t) => (
            <StatTile key={t.currency} label={`Collected · ${t.currency}`} value={formatMoney(t.netCents, t.currency)} hint={`${t.purchases} purchase${t.purchases === 1 ? "" : "s"}${t.refundedCents ? `, ${formatMoney(t.refundedCents, t.currency)} refunded` : ""}${t.pendingCount ? `, ${formatMoney(t.pendingCents, t.currency)} pending` : ""}`} />
          ))}
        </div>
      )}

      <Card title={`${report.total} purchase${report.total === 1 ? "" : "s"}`} actions={report.total > 0 ? <a href={csvHref} className="text-[13.5px] font-semibold text-brand-700 hover:text-brand-900">Download CSV</a> : undefined}>
        {report.purchases.length === 0 ? <EmptyState title="No purchases match" description="Try clearing a filter." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-[13.5px]">
              <thead className="text-[11.5px] uppercase tracking-[0.1em] text-ink-400"><tr><th className="py-2 pr-3 font-semibold">Date</th><th className="py-2 pr-3 font-semibold">Buyer</th><th className="py-2 pr-3 font-semibold">Course</th><th className="py-2 pr-3 text-right font-semibold">Amount</th><th className="py-2 pr-3 font-semibold">Status</th><th className="py-2 pr-3 font-semibold">Paid with</th><th className="py-2 font-semibold">Reference</th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {report.purchases.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-ink-600">{fmtDate(p.paidAt ?? p.purchasedAt)}</td>
                    <td className="py-2.5 pr-3"><Link href={`/staff/talent/${p.buyerProfileId}`} className="font-semibold text-ink-900 hover:text-brand-700">{p.buyerName}</Link></td>
                    <td className="py-2.5 pr-3 text-ink-700">{p.courseTitle}</td>
                    <td className="py-2.5 pr-3 text-right whitespace-nowrap">
                      <span className="font-semibold text-ink-900">{formatMoney(p.paidCents ?? p.amountCents, p.currency)}</span>
                      {p.listPriceCents != null && p.listPriceCents > p.amountCents && <span className="block text-[11.5px] text-ink-400">list {formatMoney(p.listPriceCents, p.currency)}, promo applied</span>}
                      {p.refundedCents > 0 && <span className="block text-[11.5px] text-red-600">{formatMoney(p.refundedCents, p.currency)} refunded</span>}
                    </td>
                    <td className="py-2.5 pr-3"><span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${STATUS_TONE[p.status]}`}>{PURCHASE_STATUS_LABEL[p.status]}</span></td>
                    <td className="py-2.5 pr-3 text-ink-700">{PURCHASE_METHOD_LABEL[p.method]}</td>
                    <td className="py-2.5 text-ink-500">{p.reference ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {report.pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-[13.5px]">
            {q.page > 1 ? <Link href={`/staff/academy/purchases${purchaseQueryString(q, { page: q.page - 1 })}`} className="font-semibold text-brand-700">← Newer</Link> : <span />}
            <span className="text-ink-500">Page {q.page} of {report.pages}</span>
            {q.page < report.pages ? <Link href={`/staff/academy/purchases${purchaseQueryString(q, { page: q.page + 1 })}`} className="font-semibold text-brand-700">Older →</Link> : <span />}
          </div>
        )}
      </Card>

      <Card title="Online payments that did not go through" description="The latest 50 PayPal or Maya attempts that failed, expired, were cancelled, or did not match the course price. The reason is the payment provider's own message.">
        {failed.length === 0 ? <EmptyState title="No failed attempts" /> : (
          <ul className="divide-y divide-ink-100">
            {failed.map((f) => (
              <li key={f.id} className="py-3">
                <p className="text-[14px] font-semibold text-ink-900"><Link href={`/staff/talent/${f.buyerProfileId}`} className="hover:text-brand-700">{f.buyerName}</Link> <span className="font-normal text-ink-500">· {f.courseTitle}</span></p>
                <p className="text-[12.5px] text-ink-400">{f.provider === "PAYPAL" ? "PayPal" : f.provider === "MAYA" ? "Maya" : f.provider} · {formatMoney(f.amountMinor, f.currency)} · {f.status.toLowerCase()} · {fmtDate(f.at)}</p>
                {f.reason && <p className="mt-0.5 text-[12.5px] text-ink-600">{f.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
