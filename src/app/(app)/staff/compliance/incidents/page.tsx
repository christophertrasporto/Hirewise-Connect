import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listIncidents } from "@/server/services/incident.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { IncidentForm } from "@/components/phase5/IncidentForms";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Incidents" };

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const status = ["OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED"].includes(sp.status ?? "") ? (sp.status as "OPEN") : undefined;
  let rows: Awaited<ReturnType<typeof listIncidents>>;
  try {
    rows = await listIncidents(prisma, actor, status);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="No access">{e.message}</Banner>;
    throw e;
  }
  return (
    <>
      <PageHeader eyebrow="Compliance" title="Incidents" description="Section 8.8: create incidents from flags or held messages, attach evidence, suspend with a reason, and keep a history per user. Sales sees only incidents they reported." actions={<Link href="/staff/compliance" className="rounded-full border border-ink-200 bg-white px-4 py-1.5 text-[13.5px] font-semibold text-ink-700">Held messages & flags</Link>} />
      <div className="mb-5 flex flex-wrap gap-1.5">{[["", "All"], ["OPEN", "Open"], ["UNDER_REVIEW", "Under review"], ["RESOLVED", "Resolved"], ["DISMISSED", "Dismissed"]].map(([v, l]) => <Link key={v} href={v ? `/staff/compliance/incidents?status=${v}` : "/staff/compliance/incidents"} className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${(sp.status ?? "") === v ? "bg-ink-900 text-white" : "bg-white text-ink-600 ring-1 ring-inset ring-ink-200"}`}>{l}</Link>)}</div>
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          {rows.length === 0 ? <EmptyState title="No incidents" /> : (
            <ul className="divide-y divide-ink-100">
              {rows.map((i) => (
                <li key={i.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <Link href={`/staff/compliance/incidents/${i.id}`} className="text-[15px] font-semibold text-ink-900 hover:text-brand-700">{labelFor(i.type)} · {i.subject.label}</Link>
                      <p className="text-[12.5px] text-ink-400">{i.severity.toLowerCase()} · reported by {i.reportedBy} · {fmtDate(i.createdAt)}{i.evidenceCount ? ` · ${i.evidenceCount} evidence file(s)` : ""}</p>
                    </div>
                    <StatusBadge status={i.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="New incident" description="Facts observed on the platform only. Nothing external is inspected."><IncidentForm compact /></Card>
      </div>
    </>
  );
}
