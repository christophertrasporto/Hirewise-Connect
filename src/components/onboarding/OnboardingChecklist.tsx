import Link from "next/link";
import { ArrowRight, Check, Circle, Lock } from "lucide-react";
import { Card } from "@/components/app/ui";
import type { OnboardingView } from "@/server/services/onboarding.service";

/** Talent dashboard checklist: verify email → complete profile → watch the welcome video → courses. */
export function OnboardingChecklist({ onboarding }: { onboarding: OnboardingView }) {
  if (!onboarding.applies) return null;
  const next = onboarding.steps.find((s) => s.required && !s.done);
  return (
    <Card title="New user onboarding" description={onboarding.done ? "All steps completed. Welcome aboard." : `Onboarding progress: ${onboarding.completed} of ${onboarding.total} completed`} className="border-brand-100 bg-gradient-to-br from-white to-brand-50/40">
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-ink-100">
        <div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all" style={{ width: `${onboarding.total ? Math.round((onboarding.completed / onboarding.total) * 100) : 100}%` }} />
      </div>
      <ol className="divide-y divide-ink-100">
        {onboarding.steps.map((s, i) => {
          const blocked = s.key === "courses" && onboarding.coursesLocked;
          return (
            <li key={s.key} className="flex items-center justify-between gap-4 py-2.5">
              <span className="flex items-center gap-3 text-[14.5px]">
                {s.done ? <Check className="h-4 w-4 text-brand-600" /> : blocked ? <Lock className="h-4 w-4 text-gold-500" /> : <Circle className="h-4 w-4 text-ink-300" />}
                <span>
                  <span className={s.done ? "text-ink-500 line-through decoration-ink-300" : "font-medium text-ink-800"}>Step {i + 1}: {s.label}</span>
                  <span className="block text-[12px] text-ink-400">{s.detail}{!s.required && !s.done ? "" : ""}{s.required && !s.done ? " · Required" : ""}</span>
                </span>
              </span>
              {!s.done && !blocked && <Link href={s.href} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600 hover:text-brand-700">{s.key === "video" ? "Watch" : s.key === "courses" ? "Open" : "Go"} <ArrowRight className="h-3.5 w-3.5" /></Link>}
              {blocked && <span className="rounded-full bg-gold-50 px-2.5 py-1 text-[11.5px] font-semibold text-gold-700 ring-1 ring-inset ring-gold-200">Locked</span>}
            </li>
          );
        })}
      </ol>
      {next && (
        <Link href={next.href} className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white hover:bg-ink-800">
          Next: {next.label} <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </Card>
  );
}
