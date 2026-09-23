import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { analyticsDashboard, type Bar } from "@/server/services/analytics.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, StatTile, EmptyState, Banner } from "@/components/app/ui";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Analytics" };

function Bars({ data }: { data: Bar[] }) {
  if (data.length === 0) return <EmptyState title="No data" />;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-2">
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[140px_1fr_40px] items-center gap-3 text-[13px]">
          <span className="truncate text-ink-600" title={d.label}>{labelFor(d.label)}</span>
          <span className="h-3 overflow-hidden rounded-full bg-ink-100"><span className="block h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600" style={{ width: `${(d.value / max) * 100}%` }} /></span>
          <span className="text-right font-semibold tabular-nums text-ink-800">{d.value}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const days = [30, 90, 365].includes(Number(sp.days)) ? Number(sp.days) : 90;
  let a: Awaited<ReturnType<typeof analyticsDashboard>>;
  try {
    a = await analyticsDashboard(prisma, actor, days);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="No analytics for your role">Reports follow Section 11.</Banner>;
    throw e;
  }
  return (
    <>
      <PageHeader eyebrow="Analytics" title="Operations analytics" description="Counts and conversion over the selected window. Revenue and margin live under Reports." actions={<div className="flex gap-1.5">{[30, 90, 365].map((d) => <Link key={d} href={`/staff/analytics?days=${d}`} className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${days === d ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-600"}`}>{d}d</Link>)}<Link href="/staff/reports" className="rounded-full border border-ink-200 bg-white px-3 py-1 text-[12.5px] font-semibold text-ink-700">Reports</Link></div>} />
      {a.funnel && (
        <section className="mb-6">
          <div className="mb-3 grid gap-3 sm:grid-cols-3"><StatTile label="Active placements" value={a.funnel.activeNow} /><StatTile label="Avg days to placement" value={a.funnel.avgDaysToPlacement ?? "—"} hint="Selection to activation" /><StatTile label="Activated in window" value={a.funnel.steps[5].value} /></div>
          <Card title="Hiring funnel" description={`Last ${days} days`}><Bars data={a.funnel.steps} /></Card>
        </section>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {a.talent && (
          <Card title="Talent pipeline" description={`${a.talent.registrations} registrations, ${a.talent.approved} approvals in ${days} days · approval rate ${a.talent.approvalRate}% · median ${a.talent.medianDaysToApproval ?? "—"} days to approval`}><Bars data={a.talent.byStatus} /></Card>
        )}
        {a.clients && (
          <Card title="Clients" description={`${a.clients.registrations} registrations in ${days} days`}><div className="grid gap-4 sm:grid-cols-2"><div><p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">By source</p><Bars data={a.clients.bySource} /></div><div><p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">By status</p><Bars data={a.clients.byStatus} /></div></div></Card>
        )}
        {a.available && (
          <Card title={`Available talent (${a.available.total})`} description="Approved and available or available soon." className="lg:col-span-2">
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              <div><p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">By role</p><Bars data={a.available.byRole} /></div>
              <div><p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">By skill</p><Bars data={a.available.bySkill} /></div>
              <div><p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">By certification</p><Bars data={a.available.byCertification} /></div>
              <div><p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">By industry</p><Bars data={a.available.byIndustry} /></div>
              <div><p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">By timezone</p><Bars data={a.available.byTimezone} /></div>
            </div>
          </Card>
        )}
        {a.academy && (
          <Card title="Certification completion by course" description={actor.role === "COACH" ? "Your courses." : "All courses."}>
            {a.academy.length === 0 ? <EmptyState title="No courses" /> : <table className="w-full text-left text-[13.5px]"><thead className="text-[12px] uppercase tracking-[0.12em] text-ink-400"><tr><th className="pb-2 font-semibold">Course</th><th className="pb-2 font-semibold">Coach</th><th className="pb-2 font-semibold">Enrolled</th><th className="pb-2 font-semibold">Completed</th><th className="pb-2 font-semibold">Avg score</th></tr></thead><tbody className="divide-y divide-ink-100">{a.academy.map((c) => <tr key={c.title}><td className="py-2 text-ink-800">{c.title}</td><td className="py-2 text-ink-500">{c.coach}</td><td className="py-2">{c.enrolled}</td><td className="py-2">{c.completed}</td><td className="py-2">{c.avgScore ?? "—"}</td></tr>)}</tbody></table>}
          </Card>
        )}
        {a.compliance && (
          <Card title="Compliance">
            <div className="grid gap-3 sm:grid-cols-3"><StatTile label="Open flags" value={a.compliance.openFlags} href="/staff/compliance" /><StatTile label="Open incidents" value={a.compliance.openIncidents} href="/staff/compliance/incidents" /><StatTile label="Held messages" value={a.compliance.heldMessages} href="/staff/compliance" /></div>
          </Card>
        )}
      </div>
    </>
  );
}
