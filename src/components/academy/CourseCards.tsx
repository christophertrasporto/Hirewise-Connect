import Link from "next/link";
import { ArrowRight, Award, CheckCircle2, Lock, BookOpen } from "lucide-react";
import { fmtDate } from "@/components/app/ui";
import { cn } from "@/lib/cn";
import type { CourseCard } from "@/server/services/learner.service";

const STATUS: Record<CourseCard["status"], { label: string; cls: string }> = {
  IN_PROGRESS: { label: "In progress", cls: "bg-ink-50 text-ink-700 ring-ink-200" },
  NOT_STARTED: { label: "Not started", cls: "bg-white text-ink-500 ring-ink-200" },
  LOCKED: { label: "Payment pending", cls: "bg-gold-50 text-gold-700 ring-gold-200" },
  COMPLETED: { label: "Completed", cls: "bg-brand-50 text-brand-700 ring-brand-200" },
};

/** Learner course cards: "Course · 65% · Next: Gatekeeper Audiobook · Listening, 45%" plus the actions waiting on them. */
export function CourseCards({ cards, compact = false }: { cards: CourseCard[]; compact?: boolean }) {
  return (
    <div className={cn("grid gap-4", compact ? "" : "md:grid-cols-2")}>
      {cards.map((c) => {
        const st = STATUS[c.status];
        return (
          <Link key={c.courseId} href={`/courses/${c.courseId}`} className={cn("group rounded-3xl border border-ink-100 bg-white shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift", compact ? "p-4" : "p-5")}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-brand-600">{c.category}</p>
                <h3 className={cn("mt-0.5 font-bold text-ink-900 group-hover:text-brand-700", compact ? "text-[15px]" : "text-[17px]")}>{c.title}</h3>
              </div>
              {c.status === "COMPLETED" ? <CheckCircle2 className="h-6 w-6 shrink-0 text-brand-500" /> : c.status === "LOCKED" ? <Lock className="h-5 w-5 shrink-0 text-gold-500" /> : <BookOpen className="h-5 w-5 shrink-0 text-ink-300" />}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100"><div className={cn("h-full rounded-full", c.status === "COMPLETED" ? "bg-brand-500" : "bg-gradient-to-r from-brand-400 to-brand-600")} style={{ width: `${c.percent}%` }} /></div>
              <span className="text-[13px] font-semibold tabular-nums text-ink-800">{c.percent}%</span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-500">
              <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] ring-1 ring-inset", st.cls)}>{st.label}</span>
              {c.nextLesson && <span>Next: <span className="font-semibold text-ink-800">{c.nextLesson.title}</span> · {c.nextLesson.contentType}, {c.nextLesson.detail.toLowerCase()}</span>}
              {c.completedAt && <span>Completed {fmtDate(c.completedAt)}</span>}
              {c.certification && c.certification.status === "APPROVED" && <span className="inline-flex items-center gap-1 text-gold-800"><Award className="h-3.5 w-3.5" /> {c.certification.certificateNumber ?? c.certification.name}</span>}
            </div>
            {c.actions.length > 0 && (
              <ul className="mt-3 space-y-1">
                {c.actions.map((a, i) => <li key={i} className="inline-flex items-center gap-1.5 rounded-xl bg-gold-50 px-3 py-1.5 text-[12.5px] font-medium text-gold-800"><ArrowRight className="h-3.5 w-3.5" /> {a.label}</li>)}
              </ul>
            )}
          </Link>
        );
      })}
    </div>
  );
}
