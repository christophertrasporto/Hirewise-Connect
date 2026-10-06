"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Headphones, Lock, PlayCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { MediaProgressState } from "@/components/academy/use-media-progress";

/** Listened / watched share, the required mark, and the quiz gate. Shared by the audio and video players. */
export function MediaProgressBar({ state, requiredPercent, questionCount, quizHref, verb, error }: { state: MediaProgressState; requiredPercent: number; questionCount: number; quizHref: string | null; verb: "listened" | "watched"; error: string | null }) {
  const pct = Math.min(100, state.percent);
  const done = state.status === "COMPLETED";
  const Icon = verb === "listened" ? Headphones : PlayCircle;
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between text-[13px]">
        <span className="font-semibold text-ink-800">
          {done ? <span className="inline-flex items-center gap-1.5 text-brand-700"><CheckCircle2 className="h-4 w-4" /> Completed</span> : state.mediaCompleted ? <span className="inline-flex items-center gap-1.5 text-brand-700"><CheckCircle2 className="h-4 w-4" /> {verb === "listened" ? "Audio" : "Video"} complete</span> : <span className="inline-flex items-center gap-1.5"><Icon className="h-4 w-4 text-ink-400" /> {pct}% {verb}</span>}
        </span>
        <span className="text-ink-400">{state.mediaCompleted ? "" : `${requiredPercent}% required`}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100">
        <div className={cn("h-full rounded-full transition-all", state.mediaCompleted ? "bg-brand-500" : "bg-gradient-to-r from-brand-400 to-brand-600")} style={{ width: `${pct}%` }} />
        {!state.mediaCompleted && <div className="relative -mt-2 h-2 border-l-2 border-ink-400/50" style={{ marginLeft: `${requiredPercent}%` }} />}
      </div>
      {questionCount > 0 && quizHref ? (
        state.quizUnlocked ? (
          <Link href={quizHref} className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white hover:bg-ink-800">{done ? "Review the quiz" : "Open the quiz"} <ArrowRight className="h-4 w-4" /></Link>
        ) : (
          <p className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-ink-500"><Lock className="h-3.5 w-3.5 text-gold-500" /> The quiz ({questionCount} question{questionCount === 1 ? "" : "s"}) unlocks after you {verb === "listened" ? "listen to" : "watch"} {requiredPercent}%.</p>
        )
      ) : (
        <p className="mt-2 text-[12.5px] text-ink-400">{done ? "Lesson complete." : `Only time you actually ${verb === "listened" ? "listen" : "watch"} counts. Pause any time; we resume where you left off, on any device.`}</p>
      )}
      {error && <p className="mt-2 text-[12.5px] font-medium text-red-600">{error}</p>}
    </div>
  );
}
