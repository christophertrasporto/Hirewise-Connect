import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { partnerTeamForClient } from "@/server/services/partner.service";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, Banner, StatTile, fmtDate } from "@/components/app/ui";
import { CandidateCard } from "@/components/marketplace/CandidateCard";

export const metadata: Metadata = { title: "Partner Team" };

export default async function PartnerTeamPage({ params }: { params: Promise<{ code: string }> }) {
  const actor = await requireActor();
  const { code } = await params;
  let data: Awaited<ReturnType<typeof partnerTeamForClient>>;
  try {
    data = await partnerTeamForClient(prisma, actor, decodeURIComponent(code));
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Marketplace not open yet">{e.message}</Banner>;
    throw e;
  }
  const { team, members } = data;
  return (
    <>
      <Link href="/partners" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> All Partner Teams</Link>
      <PageHeader eyebrow={`Partner Team ${team.code}`} title={team.name} description={`Partner since ${fmtDate(team.memberSince)}${team.disclosed ? ` · operated by ${team.disclosed.agencyName}` : ""}. Engagements, interviews, and contracts run through Hirewise.`} actions={<span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11.5px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200"><ShieldCheck className="h-3.5 w-3.5" /> Hirewise Certified</span>} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Professionals" value={team.teamSize} hint={`${team.qualifiedProfessionals} skills-assessed or above`} />
        <StatTile label="Available now" value={team.availableNow} hint={`${team.inTraining} in training`} />
        <StatTile label="Certified professionals" value={team.certifiedMembers} hint={team.certifications.slice(0, 2).map((c) => c.name).join(", ") || "No certifications yet"} />
        <StatTile label="Training completion" value={team.trainingCompletionPct === null ? "—" : `${team.trainingCompletionPct}%`} hint={team.avgYearsExperience !== null ? `${team.avgYearsExperience} yrs average experience` : "Experience on request"} />
      </div>
      {team.specializations.length > 0 && <Card title="Specializations" className="mb-6"><div className="flex flex-wrap gap-1.5">{team.specializations.map((s) => <span key={s} className="rounded-full bg-ink-100 px-2.5 py-1 text-[12.5px] font-medium text-ink-700">{s}</span>)}</div></Card>}
      <h2 className="mb-3 text-[15px] font-bold text-ink-900">Professionals on this team</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {members.map((m) => <CandidateCard key={m.id} c={m} canShortlist={actor.role === "CLIENT"} />)}
      </div>
    </>
  );
}
