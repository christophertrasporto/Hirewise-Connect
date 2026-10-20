import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listBypassReports } from "@/server/services/bypass.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, EmptyState, Banner, fmtDate } from "@/components/app/ui";

export const metadata: Metadata = { title: "Bypass reports" };

const FILTERS = ["OPEN", "REPORTED", "UNDER_REVIEW", "WARNING_ISSUED", "RESTRICTED", "SUSPENDED", "CLOSED"] as const;

export default async function BypassReportsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireActor();
  const status = ((await searchParams).status ?? "OPEN") as (typeof FILTERS)[number];
  let rows: Awaited<ReturnType<typeof listBypassReports>>;
  try {
    rows = await listBypassReports(prisma, actor, status);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Not available">{e.message}</Banner>;
    throw e;
  }
  return (
    <>
      <PageHeader eyebrow="Compliance" title="Bypass reports" description="Direct-contact and bypass attempts reported by clients, talent, agencies, and staff. Reported → Under review → Warning issued / Restricted / Suspended → Closed. Nothing happens automatically." actions={<Link href="/staff/compliance" className="rounded-full border border-ink-200 bg-white px-4 py-1.5 text-[13.5px] font-semibold text-ink-700">Held and masked messages</Link>} />
      <div className="mb-4 flex flex-wrap gap-1.5">{FILTERS.map((f) => <Link key={f} href={`/staff/compliance/bypass?status=${f}`} className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ring-1 ring-inset ${f === status ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-ink-700 ring-ink-200"}`}>{f === "OPEN" ? "All open" : f.toLowerCase().replace(/_/g, " ")}</Link>)}</div>
      {rows.length === 0 ? <EmptyState title="No cases" /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.id} title={<span className="flex items-center gap-2"><Link href={`/staff/compliance/bypass/${r.id}`} className="hover:text-brand-700">{"reported" in r && r.reported.label ? r.reported.label : "Unspecified party"}</Link> <StatusBadge status={r.status} /></span>} description={`Reported ${fmtDate(r.createdAt)} by a ${("reporter" in r ? r.reporter.role : "").toLowerCase().replace(/_/g, " ")}${"assignedTo" in r && r.assignedTo ? ` · ${r.assignedTo}` : ""}`}>
              <p className="text-[13.5px] text-ink-700">{r.description}</p>
              <p className="mt-2 text-[12.5px] text-ink-400">{r.evidenceCount} attachment(s){r.relatedType ? ` · ${r.relatedType} ${r.relatedId}` : ""}</p>
              <Link href={`/staff/compliance/bypass/${r.id}`} className="mt-3 inline-flex h-9 items-center rounded-full border border-ink-200 bg-white px-3.5 text-[13px] font-semibold text-ink-800 hover:bg-ink-50">Open case</Link>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
