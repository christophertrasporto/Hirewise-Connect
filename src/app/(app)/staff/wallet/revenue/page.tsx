import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { authorize } from "@/server/policies/authorize";
import { listCoachWallets, platformRevenueReport, WALLET_CURRENCY } from "@/server/services/wallet.service";
import { formatMoney } from "@/server/views/seat.views";
import { Banner, Card, EmptyState, StatTile } from "@/components/app/ui";

export const metadata: Metadata = { title: "Revenue report" };
const money = (n: number) => formatMoney(n, WALLET_CURRENCY);

export default async function StaffRevenuePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; coach?: string }> }) {
  const actor = await requireActor();
  authorize(actor, "wallet.manage");
  const sp = await searchParams;
  let report: Awaited<ReturnType<typeof platformRevenueReport>> | null = null;
  let bad = false;
  try {
    report = await platformRevenueReport(prisma, actor, { from: sp.from || undefined, to: sp.to || undefined, coachUserId: sp.coach || undefined });
  } catch {
    bad = true;
    report = await platformRevenueReport(prisma, actor);
  }
  const coaches = await listCoachWallets(prisma, actor);
  const t = report.total;
  return (
    <div className="space-y-5">
      <Card title="Platform revenue" description="Per sale, the platform's net is its share of the net minus the referral commission, with refunded parts removed in proportion, minus any gateway fee it absorbed on a refund. Sales still waiting for their fee are counted in the totals of sales and amount only.">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-[12.5px] font-semibold text-ink-600">From<input type="date" name="from" defaultValue={sp.from ?? ""} className="mt-1 block h-10 rounded-xl border border-ink-200 bg-white px-3 text-[13.5px] text-ink-800" /></label>
          <label className="text-[12.5px] font-semibold text-ink-600">To<input type="date" name="to" defaultValue={sp.to ?? ""} className="mt-1 block h-10 rounded-xl border border-ink-200 bg-white px-3 text-[13.5px] text-ink-800" /></label>
          <label className="text-[12.5px] font-semibold text-ink-600">Coach
            <select name="coach" defaultValue={sp.coach ?? ""} className="mt-1 block h-10 rounded-xl border border-ink-200 bg-white px-3 text-[13.5px] text-ink-800">
              <option value="">All coaches</option>
              {coaches.map((c) => <option key={c.id} value={c.id}>{c.email}</option>)}
            </select>
          </label>
          <button type="submit" className="h-10 rounded-full border border-ink-200 bg-white px-4 text-[13.5px] font-semibold text-ink-800 hover:bg-ink-50">Apply</button>
          <Link href="/staff/wallet/revenue" className="h-10 self-center text-[13.5px] font-semibold text-ink-500 hover:text-ink-900">Clear</Link>
        </form>
        {bad && <div className="mt-3"><Banner tone="warn" title="That filter was not understood">Showing everything instead.</Banner></div>}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total sales" value={money(t.saleMinor)} hint={`${t.sales} sale${t.sales === 1 ? "" : "s"}${t.refundedMinor ? `, ${money(t.refundedMinor)} refunded` : ""}`} />
        <StatTile label="Gateway fees" value={money(t.feeMinor)} hint={t.feeAbsorbedMinor ? `${money(t.feeAbsorbedMinor)} absorbed on refunds` : undefined} />
        <StatTile label="Coach payouts" value={money(t.coachMinor)} />
        <StatTile label="Affiliate payouts" value={money(t.affiliateMinor)} />
      </div>
      <StatTile label="Platform net" value={money(t.platformNetMinor)} hint="Its share, minus affiliate commissions, minus fees absorbed on refunds" />

      <Card title="By coach">
        {report.perCoach.length === 0 ? <EmptyState title="No sales in this range" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[13.5px]">
              <thead className="text-[11.5px] uppercase tracking-[0.1em] text-ink-400"><tr><th className="py-2 pr-3 font-semibold">Coach</th><th className="py-2 pr-3 text-right font-semibold">Sales</th><th className="py-2 pr-3 text-right font-semibold">Amount</th><th className="py-2 pr-3 text-right font-semibold">Fees</th><th className="py-2 pr-3 text-right font-semibold">Coach</th><th className="py-2 pr-3 text-right font-semibold">Affiliate</th><th className="py-2 text-right font-semibold">Platform net</th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {report.perCoach.map((r) => (
                  <tr key={r.coachUserId}>
                    <td className="py-2.5 pr-3"><Link href={`/staff/wallet/coaches/${r.coachUserId}`} className="font-semibold text-ink-900 hover:text-brand-700">{r.coachEmail}</Link></td>
                    <td className="py-2.5 pr-3 text-right">{r.sales}</td>
                    <td className="py-2.5 pr-3 text-right">{money(r.saleMinor)}</td>
                    <td className="py-2.5 pr-3 text-right">{money(r.feeMinor)}</td>
                    <td className="py-2.5 pr-3 text-right">{money(r.coachMinor)}</td>
                    <td className="py-2.5 pr-3 text-right">{money(r.affiliateMinor)}</td>
                    <td className="py-2.5 text-right font-semibold text-ink-900">{money(r.platformNetMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
