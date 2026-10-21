import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listOpportunitiesForStaff } from "@/server/services/opportunity.service";
import { listRequirementsForStaff } from "@/server/services/requirement.service";
import { listAgencies } from "@/server/services/agency.service";
import { ForbiddenError, can } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { PublishOpportunityForm } from "@/components/opportunities/Forms";

export const metadata: Metadata = { title: "Opportunities" };

const FILTERS = ["OPEN", "INTERVIEWING", "FILLED", "CLOSED"] as const;

export default async function StaffOpportunitiesPage({ searchParams }: { searchParams: Promise<{ status?: string; requirement?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const status = (FILTERS as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof FILTERS)[number]) : undefined;
  let rows: Awaited<ReturnType<typeof listOpportunitiesForStaff>>;
  try {
    rows = await listOpportunitiesForStaff(prisma, actor, status);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Not available">{e.message}</Banner>;
    throw e;
  }
  const canManage = can(actor, "opportunity.manage");
  const [requirements, agencies] = canManage ? await Promise.all([listRequirementsForStaff(prisma, actor), listAgencies(prisma, actor, { status: "ACTIVE" })]) : [[], []];
  const published = new Set(rows.map((o) => o.requirementId));
  const publishable = requirements.filter((r) => r.status !== "CLOSED" && r.status !== "FILLED" && !published.has(r.id));
  return (
    <>
      <PageHeader eyebrow="Opportunities" title="Client opportunities and submissions" description="Publish a client requirement to Partner Teams and direct talent with the client masked, review submissions, and watch candidates move to interviews and placements." />
      {canManage && (
        <Card title="Publish a requirement" description="The client stays masked (industry and country) until Hirewise schedules an interview or grants disclosure." className="mb-6">
          {publishable.length === 0 ? <EmptyState title="Every open requirement is already published" /> : <PublishOpportunityForm requirements={publishable.map((r) => ({ id: r.id, title: r.title, role: r.role, companyName: r.client.companyName }))} agencies={agencies.map((a) => ({ id: a.id, name: a.name }))} defaultRequirementId={sp.requirement} />}
        </Card>
      )}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link href="/staff/opportunities" className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ring-1 ring-inset ${!status ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-ink-700 ring-ink-200"}`}>All</Link>
        {FILTERS.map((f) => <Link key={f} href={`/staff/opportunities?status=${f}`} className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ring-1 ring-inset ${f === status ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-ink-700 ring-ink-200"}`}>{f.toLowerCase()}</Link>)}
      </div>
      {rows.length === 0 ? <EmptyState title="No opportunities" /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((o) => (
            <Card key={o.id} title={<span className="flex items-center gap-2"><Link href={`/staff/opportunities/${o.id}`} className="hover:text-brand-700">{o.title}</Link> <StatusBadge status={o.status} /></span>} description={`${o.client.companyName} (shown as “${o.maskedClientLabel}”) · ${o.headcount} position(s) · ${o.visibility.toLowerCase().replace(/_/g, " ")} · published ${fmtDate(o.publishedAt)} by ${o.publishedBy}`}>
              <p className="text-[13px] text-ink-600">{o.submissions.length} submission(s) · {o.pendingReview} pending review · {o.submissions.filter((s) => s.status === "SELECTED").length} selected</p>
              <Link href={`/staff/opportunities/${o.id}`} className="mt-3 inline-flex h-9 items-center rounded-full border border-ink-200 bg-white px-3.5 text-[13px] font-semibold text-ink-800 hover:bg-ink-50">Open</Link>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
