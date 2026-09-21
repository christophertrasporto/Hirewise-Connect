import Link from "next/link";
import { BadgeCheck, Clock3, Film, Mic2, PhoneCall } from "lucide-react";
import { StatusBadge } from "@/components/app/ui";
import { ShortlistButton } from "./ShortlistButton";
import type { CandidateCardView } from "@/server/views/agent.views";
import { labelFor } from "@/lib/options";
import { cn } from "@/lib/cn";

export function CandidateCard({ c, canShortlist = true }: { c: CandidateCardView & { note?: string | null }; canShortlist?: boolean }) {
  const initials = c.displayName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <article className="flex h-full flex-col rounded-3xl border border-ink-100 bg-white p-5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift">
      <div className="flex items-start gap-3.5">
        <Link href={`/talent/${c.id}`} className="relative shrink-0">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-ink-700 to-ink-900 font-display text-lg font-bold text-white">{initials}</span>
          <span className={cn("absolute -right-1 -bottom-1 h-3.5 w-3.5 rounded-full ring-2 ring-white", c.availabilityStatus === "AVAILABLE" ? "bg-brand-500" : c.availabilityStatus === "AVAILABLE_SOON" ? "bg-gold-500" : "bg-ink-300")} title={labelFor(c.availabilityStatus)} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/talent/${c.id}`} className="block truncate text-[16px] font-bold text-ink-900 hover:text-brand-700">{c.displayName}</Link>
          <p className="text-[13px] text-ink-500">{c.primaryRole ?? "Talent"}{c.yearsExperience ? ` · ${c.yearsExperience} yrs` : ""}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200"><BadgeCheck className="h-3 w-3" /> {labelFor(c.verificationLevel)}</span>
            <StatusBadge status={c.availabilityStatus} />
          </div>
        </div>
      </div>
      {c.headline && <p className="mt-3 line-clamp-2 text-[13.5px] leading-relaxed text-ink-600">{c.headline}</p>}
      <div className="mt-3 flex flex-wrap gap-1">
        {c.skills.slice(0, 5).map((s) => <span key={s.name} className="rounded-full bg-ink-100 px-2 py-0.5 text-[11.5px] font-medium text-ink-700">{s.name}</span>)}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-500">
        {c.hasVideo && <span className="inline-flex items-center gap-1"><Film className="h-3.5 w-3.5" /> Video</span>}
        {c.approvedRecordings > 0 && <span className="inline-flex items-center gap-1"><Mic2 className="h-3.5 w-3.5" /> {c.approvedRecordings} sample{c.approvedRecordings > 1 ? "s" : ""}</span>}
        {c.campaignExperience && <span className="inline-flex items-center gap-1"><PhoneCall className="h-3.5 w-3.5" /> Campaign exp.</span>}
        {c.tzDiffHours !== null && c.tzDiffHours !== undefined && <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {c.tzDiffHours}h from you</span>}
      </div>
      {c.note && <p className="mt-3 rounded-xl bg-gold-50 px-3 py-2 text-[12.5px] text-gold-700"><span className="font-semibold">Your note:</span> {c.note}</p>}
      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">Client rate</p>
          <p className="text-[12.5px] font-semibold text-ink-700">Set by Hirewise</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/talent/${c.id}`} className="inline-flex h-9 items-center rounded-full border border-ink-200 bg-white px-3.5 text-[13px] font-semibold text-ink-800 hover:bg-ink-50">View</Link>
          {canShortlist && <ShortlistButton agentProfileId={c.id} shortlisted={!!c.shortlisted} compact />}
        </div>
      </div>
    </article>
  );
}
