import Link from "next/link";
import { ArrowRight, Award, CheckCircle2, Lock, BookOpen } from "lucide-react";
import { fmtDate } from "@/components/app/ui";
import { cn } from "@/lib/cn";
import type { CourseCard } from "@/server/services/learner.service";
import { CourseTile, CourseCover, ProgressPill, type TilePill } from "./CourseTile";

const STATUS: Record<CourseCard["status"], { label: string; cls: string }> = {
  IN_PROGRESS: { label: "In progress", cls: "bg-ink-50 text-ink-700 ring-ink-200" },
  NOT_STARTED: { label: "Not started", cls: "bg-white text-ink-500 ring-ink-200" },
  LOCKED: { label: "Payment pending", cls: "bg-gold-50 text-gold-700 ring-gold-200" },
  COMPLETED: { label: "Completed", cls: "bg-brand-50 text-brand-700 ring-brand-200" },
};

const ACTION: Record<CourseCard["status"], string> = { IN_PROGRESS: "Continue", NOT_STARTED: "Start now", LOCKED: "View", COMPLETED: "Review" };

function pillFor(c: CourseCard): TilePill | null {
  if (c.revoked) return { label: "Access ended", tone: "warn", icon: <Lock className="h-3.5 w-3.5" /> };
  if (c.status === "COMPLETED") return { label: "Completed", tone: "good", icon: <CheckCircle2 className="h-3.5 w-3.5" /> };
  if (c.status === "LOCKED") return { label: "Payment pending", tone: "warn", icon: <Lock className="h-3.5 w-3.5" /> };
  return null;
}

/**
 * Learner course cards. Full size is the cover grid (cover, title, description, green progress pill, next lesson and
 * the actions waiting on the learner); compact keeps the small text card used on the dashboard.
 */
export function CourseCards({ cards, compact = false }: { cards: CourseCard[]; compact?: boolean }) {
  if (!compact) {
    return (
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <CourseTile
            key={c.courseId}
            href={`/courses/${c.courseId}`}
            cover={{ title: c.title, category: c.category, difficulty: c.difficulty, coverUrl: c.coverUrl }}
            pill={pillFor(c)}
            action={ACTION[c.status]}
            title={c.title}
            description={c.description}
            dimmed={c.status === "LOCKED"}
            footer={
              <div className="space-y-2.5">
                <ProgressPill percent={c.status === "COMPLETED" ? 100 : c.percent} complete={c.status === "COMPLETED"} />
                {c.nextLesson && <p className="text-[12.5px] text-ink-500">Next: <span className="font-semibold text-ink-800">{c.nextLesson.title}</span> · {c.nextLesson.contentType}, {c.nextLesson.detail.toLowerCase()}</p>}
                {c.completedAt && <p className="text-[12.5px] text-ink-500">Completed {fmtDate(c.completedAt)}</p>}
                {c.certification && c.certification.status === "APPROVED" && <p className="inline-flex items-center gap-1 text-[12.5px] font-medium text-gold-800"><Award className="h-3.5 w-3.5" /> {c.certification.certificateNumber ?? c.certification.name}</p>}
                {c.actions.length > 0 && (
                  <ul className="space-y-1">
                    {c.actions.map((a, i) => <li key={i} className="inline-flex items-start gap-1.5 rounded-xl bg-gold-50 px-3 py-1.5 text-[12.5px] font-medium text-gold-800"><ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {a.label}</li>)}
                  </ul>
                )}
              </div>
            }
          />
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      {cards.map((c) => {
        const st = STATUS[c.status];
        return (
          <Link key={c.courseId} href={`/courses/${c.courseId}`} className="group rounded-3xl border border-ink-100 bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11.5px] font-semibold tracking-[0.12em] text-brand-600 uppercase">{c.category}</p>
                <h3 className="mt-0.5 text-[15px] font-bold text-ink-900 group-hover:text-brand-700">{c.title}</h3>
              </div>
              {c.status === "COMPLETED" ? <CheckCircle2 className="h-6 w-6 shrink-0 text-brand-500" /> : c.status === "LOCKED" ? <Lock className="h-5 w-5 shrink-0 text-gold-500" /> : <BookOpen className="h-5 w-5 shrink-0 text-ink-300" />}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100"><div className={cn("h-full rounded-full", c.status === "COMPLETED" ? "bg-brand-500" : "bg-gradient-to-r from-brand-400 to-brand-600")} style={{ width: `${c.percent}%` }} /></div>
              <span className="text-[13px] font-semibold text-ink-800 tabular-nums">{c.percent}%</span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-500">
              <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.08em] uppercase ring-1 ring-inset", st.cls)}>{st.label}</span>
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

/** The "Continue learning" hero: the most recent in-progress course with its next lesson and one clear action. */
export function ContinueLearning({ card }: { card: CourseCard }) {
  return (
    <Link href={`/courses/${card.courseId}`} className="group grid overflow-hidden rounded-card border border-ink-100 bg-surface-raised shadow-card transition duration-200 hover:shadow-card-hover md:grid-cols-[minmax(0,18rem)_1fr]">
      <CourseCover title={card.title} category={card.category} difficulty={card.difficulty} coverUrl={card.coverUrl} eager />
      <div className="flex flex-col justify-center gap-3 p-5 sm:p-6">
        <p className="text-[11.5px] font-semibold tracking-[0.14em] text-brand-600 uppercase">Continue learning</p>
        <h3 className="text-[20px] leading-snug font-bold text-ink-900 group-hover:text-brand-700">{card.title}</h3>
        {card.nextLesson && <p className="text-[13.5px] text-ink-600">Next up: <span className="font-semibold text-ink-900">{card.nextLesson.title}</span> · {card.nextLesson.contentType}, {card.nextLesson.detail.toLowerCase()}</p>}
        <div className="max-w-md"><ProgressPill percent={card.percent} /></div>
        <span className="inline-flex h-10 w-fit items-center gap-1.5 rounded-full bg-ink-900 px-5 text-[13.5px] font-semibold text-white transition group-hover:bg-brand-600">Continue <ArrowRight className="h-4 w-4" /></span>
      </div>
    </Link>
  );
}
