import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getOpportunityForClient } from "@/server/services/opportunity.service";
import { getOwnClient } from "@/server/services/client.service";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { CandidateCard } from "@/components/marketplace/CandidateCard";
import { RequestInterviewsFromOpportunityForm } from "@/components/opportunities/Forms";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Opportunity" };

export default async function ClientOpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (actor.role !== "CLIENT") redirect("/opportunities");
  const { id } = await params;
  let data: Awaited<ReturnType<typeof getOpportunityForClient>>;
  try {
    data = await getOpportunityForClient(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Marketplace not open yet">{e.message}</Banner>;
    throw e;
  }
  const client = await getOwnClient(prisma, actor);
  const { opportunity: o, candidates } = data;
  const approved = candidates.filter((c) => c.submissionStatus === "APPROVED_FOR_CLIENT");
  return (
    <>
      <Link href="/opportunities" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Opportunities</Link>
      <PageHeader eyebrow="Opportunity" title={o.title} description={`${o.headcount} position(s) · published ${fmtDate(o.publishedAt)} · shared with ${o.visibility}`} actions={<StatusBadge status={o.status} />} />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_0.6fr]">
        <div className="space-y-5">
          <Card title={`Approved candidates (${candidates.length})`} description="Hirewise reviewed every submission. Candidates appear as client-safe profiles; Partner Teams are shown by their Hirewise identity.">
            {candidates.length === 0 ? <EmptyState title="No approved candidates yet" description={`${o.candidatesInReview} submission(s) are with Hirewise.`} /> : (
              <div className="grid gap-4 md:grid-cols-2">{candidates.map((c) => <div key={c.id}><CandidateCard c={c} canShortlist /><p className="mt-1 text-[12px] text-ink-500">Status: {labelFor(c.submissionStatus ?? "")}</p></div>)}</div>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Request interviews" description="Hirewise schedules on a Hirewise-owned link and relays everything."><RequestInterviewsFromOpportunityForm opportunityId={o.id} candidates={approved.map((c) => ({ id: c.id, name: c.name, primaryRole: c.primaryRole }))} defaultTimezone={client.timezone ?? "America/Los_Angeles"} /></Card>
          <Card title="Role"><p className="whitespace-pre-line text-[14px] text-ink-700">{o.roleSummary}</p>{o.skills.length > 0 && <p className="mt-2 text-[12.5px] text-ink-500">Skills: {o.skills.join(", ")}</p>}{o.requirements.length > 0 && <p className="mt-1 text-[12.5px] text-ink-500">Requirements: {o.requirements.map((r) => r.label).join(", ")}</p>}</Card>
        </div>
      </div>
    </>
  );
}
