import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listApplications } from "@/server/services/agency-application.service";
import { listAgencies } from "@/server/services/agency.service";
import { getSetting } from "@/server/services/setting.service";
import { can } from "@/server/policies/authorize";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { CreateAgencyDirectForm } from "@/components/agency/ReviewPanel";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Agencies" };

const STATUSES = ["SUBMITTED", "UNDER_REVIEW", "NEEDS_MORE_INFO", "APPROVED", "REJECTED", "WITHDRAWN"] as const;
const LABEL: Record<string, string> = { SUBMITTED: "Submitted", UNDER_REVIEW: "Under review", NEEDS_MORE_INFO: "Needs more info", APPROVED: "Approved", REJECTED: "Rejected", WITHDRAWN: "Withdrawn" };

/** Hirewise Admin → Agencies: the application review queue and the partner agency list. */
export default async function AgenciesPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; country?: string; from?: string; to?: string; q?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const tab = sp.tab === "agencies" ? "agencies" : "applications";
  if (!can(actor, "agency.read") && !can(actor, "agency.review") && !can(actor, "agency.manage")) return <Banner tone="warn" title="No access">Agencies are visible to Hirewise staff with agency permissions.</Banner>;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof STATUSES)[number]) : "";
  const rules = await getSetting(prisma, "agencyApplications");
  let apps: Awaited<ReturnType<typeof listApplications>> | null = null;
  let agencies: Awaited<ReturnType<typeof listAgencies>> = [];
  try {
    if (tab === "applications") apps = await listApplications(prisma, actor, { status, country: sp.country, from: sp.from, to: sp.to, q: sp.q });
    else agencies = await listAgencies(prisma, actor, { q: sp.q });
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="No access">Agencies are visible to Hirewise staff with agency permissions.</Banner>;
    throw e;
  }
  const sel = "h-10 rounded-xl border border-ink-200 bg-white px-3 text-[13.5px] text-ink-800";
  const base = "/staff/agencies";

  return (
    <>
      <PageHeader eyebrow="Hirewise Admin" title="Agencies" description="Partner agencies apply, Hirewise reviews, and only approval creates an agency. Hirewise keeps every client relationship; agencies supply and train talent." />
      <nav className="mb-5 flex flex-wrap gap-2" aria-label="Agencies sections">
        {[["applications", "Applications"], ["agencies", "Agencies"]].map(([k, l]) => <Link key={k} href={`${base}?tab=${k}`} className={cn("rounded-full border px-4 py-1.5 text-[13.5px] font-semibold", tab === k ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50")} aria-current={tab === k ? "page" : undefined}>{l}</Link>)}
        <Link href="/staff/agencies/seats" className="rounded-full border border-ink-200 bg-white px-4 py-1.5 text-[13.5px] font-semibold text-ink-700 hover:bg-ink-50">Seat requests and purchases</Link>
        <Link href="/staff/agencies/plans" className="rounded-full border border-ink-200 bg-white px-4 py-1.5 text-[13.5px] font-semibold text-ink-700 hover:bg-ink-50">Plans and packages</Link>
      </nav>

      {tab === "applications" && apps && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {STATUSES.filter((s) => s !== "WITHDRAWN").map((s) => (
              <Link key={s} href={`${base}?status=${s}`} className={cn("rounded-2xl border bg-white p-3", status === s ? "border-ink-900" : "border-ink-100")}>
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-ink-400">{LABEL[s]}</p>
                <p className="mt-1 font-display text-[1.6rem] font-extrabold leading-none text-ink-900">{apps.counts[s] ?? 0}</p>
              </Link>
            ))}
            <div className="rounded-2xl border border-ink-100 bg-white p-3"><p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-ink-400">Avg review time</p><p className="mt-1 font-display text-[1.6rem] font-extrabold leading-none text-ink-900">{apps.avgReviewHours === null ? "—" : apps.avgReviewHours < 48 ? `${apps.avgReviewHours}h` : `${Math.round(apps.avgReviewHours / 24)}d`}</p></div>
          </div>
          <Card title={`${apps.rows.length} application${apps.rows.length === 1 ? "" : "s"}`} description={`Rejected applicants may re-apply after ${rules.reapplyCooldownDays} days unless the reviewer sets otherwise.`}>
            <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
              <input type="hidden" name="tab" value="applications" />
              <label className="text-[12px] font-semibold text-ink-500">Status<br /><select name="status" defaultValue={status} className={sel}><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}</select></label>
              <label className="text-[12px] font-semibold text-ink-500">Country<br /><input name="country" defaultValue={sp.country ?? ""} className={`${sel} w-[160px]`} /></label>
              <label className="text-[12px] font-semibold text-ink-500">From<br /><input name="from" type="date" defaultValue={sp.from ?? ""} className={sel} /></label>
              <label className="text-[12px] font-semibold text-ink-500">To<br /><input name="to" type="date" defaultValue={sp.to ?? ""} className={sel} /></label>
              <label className="text-[12px] font-semibold text-ink-500">Search<br /><input name="q" defaultValue={sp.q ?? ""} placeholder="Agency, applicant, email" className={`${sel} w-[220px]`} /></label>
              <button type="submit" className="h-10 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white hover:bg-ink-800">Filter</button>
            </form>
            {apps.rows.length === 0 ? <EmptyState title="No applications match" /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-[13.5px]">
                  <thead><tr className="border-b border-ink-100 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-ink-400"><th className="py-2 pr-3">Agency</th><th className="px-2 py-2">Applicant</th><th className="px-2 py-2">Location</th><th className="px-2 py-2">Team</th><th className="px-2 py-2">Submitted</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Reviewer</th></tr></thead>
                  <tbody>
                    {apps.rows.map((a) => (
                      <tr key={a.id} className="border-b border-ink-50">
                        <td className="py-2.5 pr-3"><Link href={`${base}/applications/${a.id}`} className="font-semibold text-ink-900 hover:text-brand-700">{a.proposedAgencyName}</Link></td>
                        <td className="px-2 py-2.5 text-ink-700">{a.applicantFullName}<span className="block text-[11.5px] text-ink-400">{a.applicantEmail}</span></td>
                        <td className="px-2 py-2.5 text-ink-600">{a.city ? `${a.city}, ` : ""}{a.country}</td>
                        <td className="px-2 py-2.5 text-ink-600">{a.teamSize}</td>
                        <td className="px-2 py-2.5 text-ink-600">{fmtDate(a.resubmittedAt ?? a.submittedAt)}</td>
                        <td className="px-2 py-2.5"><StatusBadge status={a.status} /></td>
                        <td className="px-2 py-2.5 text-ink-600">{a.reviewer ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === "agencies" && (
        <div className="space-y-5">
          <Card title={`${agencies.length} partner agenc${agencies.length === 1 ? "y" : "ies"}`}>
            <form method="get" className="mb-4 flex flex-wrap items-end gap-2"><input type="hidden" name="tab" value="agencies" /><label className="text-[12px] font-semibold text-ink-500">Search<br /><input name="q" defaultValue={sp.q ?? ""} className={`${sel} w-[220px]`} /></label><button type="submit" className="h-10 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white hover:bg-ink-800">Filter</button></form>
            {agencies.length === 0 ? <EmptyState title="No agencies yet" description="Agencies appear here once an application is approved." /> : (
              <ul className="divide-y divide-ink-100">
                {agencies.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div><Link href={`${base}/${a.id}`} className="text-[15px] font-semibold text-ink-900 hover:text-brand-700">{a.name}</Link><p className="text-[12.5px] text-ink-400">{a.city ? `${a.city}, ` : ""}{a.country} · owner {a.owner.email} · joined {fmtDate(a.joinedAt)} · {a.agentCount} agent{a.agentCount === 1 ? "" : "s"}</p></div>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {can(actor, "agency.create_direct") && <Card title="Create an agency directly" description="Super Admin only. Bypasses the application; the reason is recorded in the audit log."><CreateAgencyDirectForm /></Card>}
        </div>
      )}
    </>
  );
}
