import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { matchCandidates } from "@/server/services/match.service";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, EmptyState, Banner } from "@/components/app/ui";
import { MatchList } from "@/components/phase5/MatchList";

export const metadata: Metadata = { title: "Requirement matches" };

export default async function StaffRequirementMatchesPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let data: Awaited<ReturnType<typeof matchCandidates>>;
  try {
    data = await matchCandidates(prisma, actor, id, { includeSoon: true, limit: 30 });
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="No access">{e.message}</Banner>;
    throw e;
  }
  const r = data.requirement;
  return (
    <>
      <Link href="/staff/clients" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Clients</Link>
      <PageHeader eyebrow={r.client.companyName} title={r.title} description={`${r.role} · ${r.agentsRequired} agent(s)${r.schedule ? ` · ${r.schedule}` : ""}${r.timezone ? ` · ${r.timezone}` : ""}${r.budgetMax ? ` · budget up to USD ${(r.budgetMax / 100).toFixed(0)}/month` : ""}`} actions={<StatusBadge status={r.status} />} />
      <p className="mb-5 text-[13px] text-ink-500">{data.consideredCount} approved candidates considered · {data.matches.length} eligible · rule-based with explanations.</p>
      {data.matches.length === 0 ? <Card><EmptyState title="No eligible candidates" /></Card> : <MatchList matches={data.matches} canShortlist={false} profileHref={(cid) => `/staff/talent/${cid}`} />}
    </>
  );
}
