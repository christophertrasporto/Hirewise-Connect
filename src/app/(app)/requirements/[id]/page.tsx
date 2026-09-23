import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarPlus } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { matchCandidates } from "@/server/services/match.service";
import { NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";
import { MatchList } from "@/components/phase5/MatchList";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Matches" };

export default async function RequirementMatchesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ soon?: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (actor.role !== "CLIENT") redirect(`/staff/requirements/${id}`);
  const sp = await searchParams;
  const includeSoon = sp.soon !== "0";
  let data: Awaited<ReturnType<typeof matchCandidates>>;
  try {
    data = await matchCandidates(prisma, actor, id, { includeSoon });
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const r = data.requirement;
  const top = data.matches.slice(0, 3).map((m) => m.candidate.id);
  return (
    <>
      <Link href="/requirements" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Requirements</Link>
      <PageHeader eyebrow="Requirement to match" title={r.title} description={`${r.role} · ${r.agentsRequired} agent(s)${r.schedule ? ` · ${r.schedule}` : ""}${r.timezone ? ` · ${r.timezone}` : ""}${r.experienceLevel ? ` · ${labelFor(r.experienceLevel)}+` : ""}`} actions={<><StatusBadge status={r.status} />{top.length > 0 && <Link href={`/interviews/new?ids=${top.join(",")}`} className="inline-flex h-10 items-center gap-2 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white hover:bg-ink-800"><CalendarPlus className="h-4 w-4" /> Interview top {top.length}</Link>}</>} />
      <div className="mb-5 flex flex-wrap items-center gap-2 text-[13px] text-ink-500">
        <span>{data.consideredCount} approved candidates considered · {data.matches.length} eligible.</span>
        <Link href={includeSoon ? `/requirements/${id}?soon=0` : `/requirements/${id}`} className="rounded-full border border-ink-200 bg-white px-3 py-1 font-semibold text-ink-700">{includeSoon ? "Hide 'available soon'" : "Include 'available soon'"}</Link>
        {r.skills.length > 0 && <span>Required skills: {r.skills.join(", ")}</span>}
      </div>
      {data.matches.length === 0 ? <Card><EmptyState title="No eligible candidates yet" description="Rules are strict on role and required skills. Widen the skills or ask your account manager." /></Card> : <MatchList matches={data.matches} canShortlist profileHref={(cid) => `/talent/${cid}`} />}
      {data.nearMisses.length > 0 && (
        <Card title="Near misses" description="Right skills, but role or availability does not fit yet." className="mt-5">
          <ul className="divide-y divide-ink-100 text-[13.5px]">
            {data.nearMisses.map((m) => <li key={m.candidate.id} className="flex items-center justify-between py-2"><Link href={`/talent/${m.candidate.id}`} className="font-semibold text-brand-600">{m.candidate.displayName}</Link><span className="text-ink-500">{m.hardFails.join(" · ")}</span></li>)}
          </ul>
        </Card>
      )}
      <p className="mt-6 text-[12px] text-ink-400">Scoring weights: {Object.entries(data.weights).map(([k, v]) => `${k} ${v}`).join(" · ")}. Rule-based, deterministic, no machine learning. Created {fmtDate(new Date())}.</p>
    </>
  );
}
