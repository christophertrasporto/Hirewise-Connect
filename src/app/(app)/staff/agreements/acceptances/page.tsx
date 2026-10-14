import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { acceptanceReport } from "@/server/services/terms.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, Banner, EmptyState, StatTile, StatusBadge, fmtDate } from "@/components/app/ui";

export const metadata: Metadata = { title: "Terms acceptance" };

/** Identity phase 1: acceptance status of the unified terms per user, role, and agency, with CSV export. */
export default async function TermsAcceptancesPage({ searchParams }: { searchParams: Promise<{ role?: string; status?: string; q?: string; agencyId?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const status = sp.status === "CURRENT" || sp.status === "OUTDATED" || sp.status === "NONE" ? sp.status : null;
  let r: Awaited<ReturnType<typeof acceptanceReport>>;
  try {
    r = await acceptanceReport(prisma, actor, { role: sp.role || null, status, q: sp.q || null, agencyId: sp.agencyId || null });
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Requires terms.report">The acceptance report is for Admins.</Banner>;
    throw e;
  }
  const qs = new URLSearchParams(Object.entries({ role: sp.role, status: sp.status, q: sp.q, agencyId: sp.agencyId }).filter((e): e is [string, string] => !!e[1])).toString();
  return (
    <>
      <PageHeader eyebrow="Agreements" title="Terms acceptance" description={`Who has accepted the current Terms & Platform Agreement${r.currentTermsVersion ? ` (v${r.currentTermsVersion})` : ""}. Outdated means an older version was accepted and a material update is pending; none means no acceptance at all.`} actions={<a href={`/api/reports/terms-acceptances${qs ? `?${qs}` : ""}`} className="rounded-full bg-ink-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-ink-800">Export CSV</a>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Current" value={r.summary.CURRENT} href="/staff/agreements/acceptances?status=CURRENT" />
        <StatTile label="Outdated" value={r.summary.OUTDATED} href="/staff/agreements/acceptances?status=OUTDATED" />
        <StatTile label="None" value={r.summary.NONE} href="/staff/agreements/acceptances?status=NONE" />
      </div>
      <Card>
        <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px_180px_auto]" action="/staff/agreements/acceptances">
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search email" className="h-10 rounded-xl border border-ink-200 px-3 text-[14px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
          <select name="role" defaultValue={sp.role ?? ""} className="h-10 rounded-xl border border-ink-200 px-3 text-[14px]"><option value="">All roles</option>{["AGENT", "CLIENT", "APPLICANT", "AGENCY_OWNER", "AGENCY_MANAGER"].map((k) => <option key={k} value={k}>{k.toLowerCase().replace(/_/g, " ")}</option>)}</select>
          <select name="status" defaultValue={sp.status ?? ""} className="h-10 rounded-xl border border-ink-200 px-3 text-[14px]"><option value="">Any status</option><option value="CURRENT">Current</option><option value="OUTDATED">Outdated</option><option value="NONE">None</option></select>
          <button type="submit" className="rounded-xl bg-ink-900 px-4 text-[13.5px] font-semibold text-white">Filter</button>
        </form>
        {r.rows.length === 0 ? <EmptyState title="No users match" /> : (
          <table className="w-full text-left text-[13.5px]">
            <thead className="text-[12px] uppercase tracking-[0.12em] text-ink-400"><tr><th className="pb-3 font-semibold">User</th><th className="pb-3 font-semibold">Role</th><th className="pb-3 font-semibold">Agency</th><th className="pb-3 font-semibold">Terms</th><th className="pb-3 font-semibold">Privacy</th><th className="pb-3 font-semibold">Status</th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {r.rows.map((row) => (
                <tr key={row.userId}>
                  <td className="py-2.5 font-medium text-ink-900">{row.email}<span className="block text-[12px] font-normal text-ink-400">account {row.userStatus.toLowerCase()}</span></td>
                  <td className="py-2.5 text-ink-600">{row.role.toLowerCase().replace(/_/g, " ")}</td>
                  <td className="py-2.5 text-ink-600">{row.agencyName ?? "—"}</td>
                  <td className="py-2.5 text-ink-600">{row.termsVersion ? `v${row.termsVersion} · ${fmtDate(row.termsAcceptedAt)} · ${(row.termsContext ?? "").toLowerCase().replace(/_/g, " ")}` : "—"}</td>
                  <td className="py-2.5 text-ink-600">{row.privacyVersion ? `v${row.privacyVersion} · ${fmtDate(row.privacyAcceptedAt)}` : "—"}</td>
                  <td className="py-2.5"><StatusBadge status={row.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
