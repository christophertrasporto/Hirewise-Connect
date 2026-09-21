import { BadgeCheck, Play, Mic, Star, Clock3, ShieldCheck, Bookmark, CalendarPlus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

const scores = [
  { label: "Communication", value: 92 },
  { label: "Roleplay", value: 88 },
  { label: "Exam", value: 95 },
];

const waveHeights = [30, 55, 80, 45, 95, 60, 35, 70, 50, 85, 40, 65, 90, 45, 30, 75, 55, 40, 85, 60, 35, 50];

export function ProfileCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative w-full max-w-[420px] rounded-3xl border border-ink-100 bg-white p-5 shadow-lift sm:p-6",
        className,
      )}
      aria-label="Example verified talent profile"
    >
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-ink-700 via-ink-800 to-ink-900 font-display text-xl font-bold text-white ring-4 ring-brand-50">
            MS
          </div>
          <span className="absolute -right-1.5 -bottom-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 ring-[3px] ring-white">
            <BadgeCheck className="h-3.5 w-3.5 text-white" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[17px] font-bold">Maria S.</h3>
            <span className="inline-flex h-2 w-2 rounded-full bg-brand-500 ring-4 ring-brand-100" title="Available" />
          </div>
          <p className="mt-0.5 text-[13.5px] leading-snug text-ink-500">
            Cold Calling & Appointment Setting Specialist · 4 yrs
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Badge tone="brand">
              <ShieldCheck className="h-3 w-3" /> Deployment Ready
            </Badge>
            <Badge tone="gold">
              <Star className="h-3 w-3" /> Hirewise Certified
            </Badge>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-ink-50 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Video intro</p>
          <div className="mt-2 flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-900 text-white">
              <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
            </span>
            <div>
              <p className="text-[13px] font-semibold text-ink-800">1:42</p>
              <p className="text-[11.5px] text-ink-400">Approved</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl bg-ink-50 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Cold call sample</p>
          <div className="mt-2 flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white">
              <Mic className="h-4 w-4" />
            </span>
            <div className="flex h-7 flex-1 items-end gap-[3px]" aria-hidden="true">
              {waveHeights.map((h, i) => (
                <span
                  key={i}
                  className="w-[3px] flex-1 origin-bottom rounded-full bg-brand-400/80 animate-wave"
                  style={{ height: `${h}%`, animationDelay: `${(i % 7) * 90}ms` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-ink-100 p-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Coach assessment</p>
          <Badge tone="outline" className="text-[10.5px]">
            Advanced
          </Badge>
        </div>
        <ul className="mt-3 space-y-2.5">
          {scores.map((s) => (
            <li key={s.label} className="grid grid-cols-[110px_1fr_36px] items-center gap-3 text-[12.5px]">
              <span className="text-ink-600">{s.label}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600"
                  style={{ width: `${s.value}%` }}
                />
              </span>
              <span className="text-right font-semibold tabular-nums text-ink-800">{s.value}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {["Cold Calling", "Appointment Setting", "HubSpot", "Real Estate", "Neutral accent"].map((t) => (
          <span key={t} className="rounded-full bg-ink-100 px-2.5 py-1 text-[11.5px] font-medium text-ink-700">
            {t}
          </span>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-ink-100 pt-4">
        <div className="flex items-center gap-2 text-[12.5px] text-ink-500">
          <Clock3 className="h-4 w-4 text-ink-400" />
          Available now · US Pacific overlap
        </div>
        <div className="text-right">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">Client rate</p>
          <p className="text-[12.5px] font-semibold text-ink-800">Set by Hirewise</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-ink-200 bg-white text-[13px] font-semibold text-ink-800 transition hover:bg-ink-50"
        >
          <Bookmark className="h-4 w-4" /> Shortlist
        </button>
        <button
          type="button"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-ink-900 text-[13px] font-semibold text-white transition hover:bg-ink-800"
        >
          <CalendarPlus className="h-4 w-4" /> Request interview
        </button>
      </div>
    </div>
  );
}
