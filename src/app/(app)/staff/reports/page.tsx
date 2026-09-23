import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { pipelineReport, revenueReport, marginReport, parseRange } from "@/server/services/report.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, StatTile, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { money } from "@/server/views/commercial.views";
import { Input } from "@/components/ui/Form";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const range = parseRange(sp.from, sp.to);
  const can = (k: Parameters<typeof actor.permissions.has>[0]) => actor.permissions.has(k);
  const [pipeline, revenue, margin] = await Promise.all([
    can("report.pipeline") ? pipelineReport(prisma, actor, range) : null,
    can("report.revenue") && can("billing_rate.read") ? revenueReport(prisma, actor, range) : null,
    can("report.revenue") ? marginReport(prisma, actor).catch((e) => (e instanceof ForbiddenError ? "forbidden" : Promise.reject(e))) : null,
  ]);
  if (!pipeline && !revenue) return <Banner tone="warn" title="No reports for your role">Reports follow Section 11 of the spec.</Banner>;
  const qs = `from=${range.from.toISOString().slice(0, 10)}&to=${range.to.toISOString().slice(0, 10)}`;

  return (
    <>
      <PageHeader eyebrow="Reports" title="Pipeline, revenue, and margin" description="Date range applies to selections, settled deposits, and collected payments. Run-rate figures reflect current active placements." actions={
        <form method="get" className="flex items-end gap-2">
          <label className="text-[12px] font-semibold text-ink-500">From<Input name="from" type="date" defaultValue={range.from.toISOString().slice(0, 10)} className="mt-1 h-9 text-[13px]" /></label>
          <label className="text-[12px] font-semibold text-ink-500">To<Input name="to" type="date" defaultValue={range.to.toISOString().slice(0, 10)} className="mt-1 h-9 text-[13px]" /></label>
          <button type="submit" className="h-9 rounded-full bg-ink-900 px-4 text-[13px] font-semibold text-white">Apply</button>
        </form>
      } />

      {pipeline && (
        <section className="mb-6">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-400">Pipeline</h2><Link href={`/api/reports/pipeline?${qs}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600"><Download className="h-3.5 w-3.5" /> CSV</Link></div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Interview requests" value={pipeline.interviewRequests} hint="All time" />
            <StatTile label="Selections" value={pipeline.selectionsInRange} hint="In range" />
            <StatTile label="Deposits settled" value={pipeline.depositsSettledInRange} hint={`${pipeline.conversion.selectionToDeposit}% of selections`} />
            <StatTile label="Awaiting agreement" value={pipeline.awaitingAgreement} />
            <StatTile label="Awaiting deposit" value={pipeline.awaitingDeposit} />
            <StatTile label="Active" value={pipeline.active} hint={`${pipeline.completed} completed · ${pipeline.cancelled} cancelled`} />
          </div>
        </section>
      )}

      {revenue && (
        <Card title="Revenue (billing side)" description={`Monthly run-rate from published rate snapshots on active and paused placements; hourly rates × ${revenue.hoursPerMonth} h.`} actions={<Link href={`/api/reports/revenue?${qs}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600"><Download className="h-3.5 w-3.5" /> CSV</Link>} className="mb-5">
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatTile label="Monthly run-rate" value={money(revenue.monthlyRunRate, "USD")} />
            <StatTile label="Collected in range" value={money(revenue.collectedInRange, "USD")} hint={`${revenue.paymentsInRange.length} payment(s)`} />
            <StatTile label="Billable placements" value={revenue.placements.length} />
          </div>
          {revenue.placements.length === 0 ? <EmptyState title="No active placements with a rate snapshot" /> : (
            <table className="w-full text-left text-[14px]">
              <thead className="text-[12px] uppercase tracking-[0.12em] text-ink-400"><tr><th className="pb-2 font-semibold">Client</th><th className="pb-2 font-semibold">Talent</th><th className="pb-2 font-semibold">Rate</th><th className="pb-2 font-semibold">Monthly</th><th className="pb-2 font-semibold">Since</th></tr></thead>
              <tbody className="divide-y divide-ink-100">{revenue.placements.map((r) => <tr key={r.placementId}><td className="py-2 text-ink-800">{r.client}</td><td className="py-2"><Link href={`/staff/placements/${r.placementId}`} className="font-semibold text-brand-600">{r.agent}</Link> <span className="text-ink-400">· {r.position}</span></td><td className="py-2 text-ink-700">{r.rateLabel}</td><td className="py-2 font-semibold text-ink-900">{r.monthlyBillingLabel}</td><td className="py-2 text-ink-500">{fmtDate(r.activatedAt)}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
      )}

      {margin === "forbidden" && <Banner tone="info" title="Margin report hidden">Margin joins client billing rates with agent compensation, so it requires compensation.read (Super Admin, or an Admin override).</Banner>}
      {margin && margin !== "forbidden" && (
        <Card title="Margin (confidential)" description="Client billing minus agent compensation per active placement. Visible only with compensation.read and billing_rate.read." actions={<Link href={`/api/reports/margin`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600"><Download className="h-3.5 w-3.5" /> CSV</Link>}>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatTile label="Monthly billing" value={money(margin.totals.billing, "USD")} />
            <StatTile label="Monthly compensation" value={money(margin.totals.compensation, "USD")} />
            <StatTile label="Monthly margin" value={money(margin.totals.margin, "USD")} hint={margin.totals.billing ? `${Math.round((margin.totals.margin / margin.totals.billing) * 100)}%` : undefined} />
          </div>
          {margin.rows.length === 0 ? <EmptyState title="No active placements" /> : (
            <table className="w-full text-left text-[14px]">
              <thead className="text-[12px] uppercase tracking-[0.12em] text-ink-400"><tr><th className="pb-2 font-semibold">Client</th><th className="pb-2 font-semibold">Talent</th><th className="pb-2 font-semibold">Billing</th><th className="pb-2 font-semibold">Compensation</th><th className="pb-2 font-semibold">Margin</th></tr></thead>
              <tbody className="divide-y divide-ink-100">{margin.rows.map((r) => <tr key={r.placementId}><td className="py-2 text-ink-800">{r.client}</td><td className="py-2 text-ink-800">{r.agent}</td><td className="py-2">{money(r.monthlyBilling, r.currency)}</td><td className="py-2">{r.monthlyCompensation === null ? "—" : money(r.monthlyCompensation, r.compensationCurrency ?? r.currency)}</td><td className="py-2 font-semibold text-ink-900">{r.margin === null ? "—" : `${money(r.margin, r.currency)} (${r.marginPct}%)`}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
      )}
    </>
  );
}
