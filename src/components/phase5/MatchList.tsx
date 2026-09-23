import Link from "next/link";
import { BadgeCheck, Check, X } from "lucide-react";
import { StatusBadge } from "@/components/app/ui";
import { ShortlistButton } from "@/components/marketplace/ShortlistButton";
import type { MatchResult } from "@/server/services/match.service";
import { labelFor } from "@/lib/options";
import { cn } from "@/lib/cn";

/** Match results with their explanations (Section 10: every result explains itself). */
export function MatchList({ matches, canShortlist, profileHref }: { matches: MatchResult[]; canShortlist: boolean; profileHref: (id: string) => string }) {
  return (
    <ol className="space-y-4">
      {matches.map((m, i) => (
        <li key={m.candidate.id} className="rounded-3xl border border-ink-100 bg-white p-5 shadow-soft">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-ink-900 font-display text-[18px] font-bold text-white">{m.percent}%</span>
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">#{i + 1} · score {m.score}/{m.maxScore}</p>
                <Link href={profileHref(m.candidate.id)} className="text-[17px] font-bold text-ink-900 hover:text-brand-700">{m.candidate.displayName}</Link>
                <p className="text-[13px] text-ink-500">{m.candidate.primaryRole ?? "Talent"}{m.candidate.yearsExperience ? ` · ${m.candidate.yearsExperience} yrs` : ""}{m.candidate.experienceLevel ? ` · ${labelFor(m.candidate.experienceLevel)}` : ""}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200"><BadgeCheck className="h-3 w-3" /> {labelFor(m.candidate.verificationLevel)}</span>
                  <StatusBadge status={m.candidate.availabilityStatus} />
                  {m.candidate.clientRate && <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-700">{m.candidate.clientRate.label}</span>}
                </div>
              </div>
            </div>
            {canShortlist && <ShortlistButton agentProfileId={m.candidate.id} shortlisted={m.candidate.shortlisted} compact />}
          </div>
          <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
            {m.reasons.map((r) => (
              <li key={r.rule} className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-[13px]", r.matched ? "bg-brand-50/70 text-ink-800" : "bg-ink-50 text-ink-500")}>
                {r.matched ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" /> : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-300" />}
                <span>{r.text}{r.max > 0 && <span className="ml-1 text-[11.5px] text-ink-400">({r.points}/{r.max})</span>}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
