import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, CalendarPlus, Clock3, Globe2, Languages, Laptop } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getCandidateForClient } from "@/server/services/search.service";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { Card, StatusBadge, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { ShortlistButton } from "@/components/marketplace/ShortlistButton";
import { MediaPlayer } from "@/components/profile/MediaPlayer";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Candidate" };

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let data: Awaited<ReturnType<typeof getCandidateForClient>>;
  try {
    data = await getCandidateForClient(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Marketplace not open yet">{e.message}</Banner>;
    throw e;
  }
  const c = data.candidate;
  const initials = c.displayName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <>
      <Link href="/talent" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Back to search</Link>
      <div className="mb-8 flex flex-col gap-5 rounded-3xl border border-ink-100 bg-white p-6 shadow-soft md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br from-ink-700 to-ink-900 font-display text-2xl font-bold text-white">{initials}</span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[1.75rem] font-bold leading-tight">{c.displayName}</h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11.5px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200"><BadgeCheck className="h-3.5 w-3.5" /> {labelFor(c.verificationLevel)}</span>
              <StatusBadge status={c.availabilityStatus} />
            </div>
            <p className="mt-1 text-[15px] text-ink-600">{c.headline ?? c.primaryRole}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-500">
              <span className="inline-flex items-center gap-1"><Globe2 className="h-3.5 w-3.5" /> {c.locationCountry ?? "—"} · {c.timezone ?? "—"}</span>
              <span className="inline-flex items-center gap-1"><Languages className="h-3.5 w-3.5" /> {c.languages.join(", ") || "—"}</span>
              <span className="inline-flex items-center gap-1"><Laptop className="h-3.5 w-3.5" /> {c.workSetup ? labelFor(c.workSetup) : "—"}{c.preferredShift ? ` · ${c.preferredShift}` : ""}</span>
              <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {c.yearsExperience ?? 0} yrs · {c.experienceLevel ? labelFor(c.experienceLevel) : "—"}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 md:items-end">
          <div className="text-right">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">Client rate</p>
            <p className="text-[14px] font-semibold text-ink-800">Set by Hirewise</p>
          </div>
          {actor.role === "CLIENT" && (
            <div className="flex gap-2">
              <ShortlistButton agentProfileId={c.id} shortlisted={data.shortlisted} />
              <button type="button" disabled title="Interview requests arrive in Phase 2" className="inline-flex h-11 items-center gap-2 rounded-full border border-ink-200 bg-white px-5 text-[14.5px] font-semibold text-ink-400"><CalendarPlus className="h-4 w-4" /> Request interview</button>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-5">
          <Card title="Summary"><p className="text-[15px] leading-relaxed whitespace-pre-line text-ink-700">{c.summary ?? "—"}</p></Card>
          <Card title="Skills, software, industries">
            <div className="flex flex-wrap gap-1.5">{c.skills.map((s) => <span key={s.name} className="rounded-full bg-ink-100 px-2.5 py-1 text-[12.5px] font-medium text-ink-700">{s.name} · {labelFor(s.level)}{s.yearsUsed ? ` · ${s.yearsUsed}y` : ""}{s.verified ? " ✓" : ""}</span>)}</div>
            <div className="mt-3 flex flex-wrap gap-1.5">{c.software.map((s) => <span key={s.name} className="rounded-full bg-brand-50 px-2.5 py-1 text-[12.5px] font-medium text-brand-700">{s.name} · {labelFor(s.level)}</span>)}</div>
            {c.industries.length > 0 && <p className="mt-3 text-[13.5px] text-ink-500">Industries: {c.industries.map((i) => `${i.industry} (${i.years}y)`).join(", ")}</p>}
          </Card>
          <Card title="Experience">
            {c.experiences.length === 0 ? <EmptyState title="No experience listed" /> : (
              <ul className="divide-y divide-ink-100">
                {c.experiences.map((e, i) => (
                  <li key={i} className="py-3">
                    <p className="text-[15px] font-semibold text-ink-900">{e.title}</p>
                    <p className="text-[12.5px] text-ink-400">{fmtDate(e.startDate)} – {e.endDate ? fmtDate(e.endDate) : "Present"}{e.industry ? ` · ${e.industry}` : ""}{e.isCampaign ? ` · Campaign${e.campaignType ? `: ${e.campaignType}` : ""}` : ""}</p>
                    {e.description && <p className="mt-1 text-[13.5px] leading-relaxed text-ink-600">{e.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Video introduction">
            {c.videos.length === 0 ? <EmptyState title="No approved video yet" /> : c.videos.map((v) => <MediaPlayer key={v.id} type="VIDEO" id={v.id} />)}
          </Card>
          <Card title="Voice samples">
            {c.recordings.length === 0 ? <EmptyState title="No approved samples yet" /> : c.recordings.map((r) => (
              <div key={r.id} className="mb-3">
                <p className="text-[13.5px] font-semibold text-ink-800">{r.title} <span className="font-normal text-ink-400">· {labelFor(r.kind).toLowerCase()}</span></p>
                <MediaPlayer type="RECORDING" id={r.id} />
              </div>
            ))}
          </Card>
          <Card title="Certifications and assessments" description="From the Hirewise VA Academy (Phase 3).">
            <EmptyState title="Coming with the Academy integration" />
          </Card>
        </div>
      </div>
    </>
  );
}
