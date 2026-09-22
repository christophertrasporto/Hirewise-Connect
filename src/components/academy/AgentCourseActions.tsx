"use client";

import { useActionState, useEffect, useState } from "react";
import { enrolAction, startExamAction, submitExamAction } from "@/app/(app)/academy-actions";
import { idle } from "@/server/http/action-result";
import { SubmitButton, FormAlert } from "@/components/ui/Form";
import { cn } from "@/lib/cn";

export function EnrolButton({ courseId, priceLabel }: { courseId: string; priceLabel: string }) {
  const [state, action] = useActionState(enrolAction, idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="courseId" value={courseId} />
      <SubmitButton variant="primary" pendingText="Enrolling…">{priceLabel === "Free" ? "Enrol for free" : `Enrol · ${priceLabel}`}</SubmitButton>
      {state.error && <FormAlert>{state.error}</FormAlert>}
    </form>
  );
}

export function StartExamButton({ courseId, label }: { courseId: string; label: string }) {
  const [state, action] = useActionState(startExamAction, idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="courseId" value={courseId} />
      <SubmitButton pendingText="Opening…">{label}</SubmitButton>
      {state.error && <FormAlert>{state.error}</FormAlert>}
    </form>
  );
}

type Q = { id: string; order: number; prompt: string; options: string[]; points: number };

export function ExamRunner({ attemptId, questions, expiresAt, courseId, passingScore }: { attemptId: string; questions: Q[]; expiresAt: string | null; courseId: string; passingScore: number }) {
  const [state, action] = useActionState(submitExamAction, idle);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [left, setLeft] = useState<number | null>(expiresAt ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)) : null);

  useEffect(() => {
    if (left === null) return;
    const t = setInterval(() => setLeft((s) => (s === null ? null : Math.max(0, s - 1))), 1000);
    return () => clearInterval(t);
  }, [left === null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.ok && state.data) {
    const r = state.data;
    return (
      <div className="rounded-3xl border border-ink-100 bg-white p-8 text-center shadow-soft">
        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-400">Your result</p>
        <p className={cn("mt-2 font-display text-[4rem] font-extrabold leading-none", r.passed ? "text-brand-600" : "text-ink-900")}>{r.scorePercent}%</p>
        <p className="mt-3 text-[16px] font-semibold text-ink-800">{r.expired ? "Time ran out before you submitted." : r.passed ? "You passed. Well done." : `Not yet. You need ${passingScore}% to pass.`}</p>
        <p className="mt-1 text-[13.5px] text-ink-500">{r.passed ? "Your completion is recorded. Any certification linked to this course is being processed and will appear on your profile." : "Review the syllabus and try again if you have attempts left."}</p>
        <a href={`/courses/${courseId}`} className="mt-6 inline-flex h-11 items-center rounded-full bg-ink-900 px-6 text-[14.5px] font-semibold text-white hover:bg-ink-800">Back to course</a>
      </div>
    );
  }

  const answered = Object.keys(answers).length;
  const mm = left !== null ? Math.floor(left / 60) : 0;
  const ss = left !== null ? left % 60 : 0;

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="attemptId" value={attemptId} />
      <div className="sticky top-[64px] z-20 flex items-center justify-between rounded-2xl border border-ink-100 bg-white/90 px-4 py-3 text-[13.5px] backdrop-blur">
        <span className="font-semibold text-ink-800">{answered} / {questions.length} answered</span>
        {left !== null && <span className={cn("font-mono font-semibold", left < 120 ? "text-red-600" : "text-ink-600")}>{String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")} left</span>}
      </div>
      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li key={q.id} className="rounded-3xl border border-ink-100 bg-white p-5 shadow-soft">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Question {i + 1} · {q.points} pt{q.points === 1 ? "" : "s"}</p>
            <p className="mt-1.5 text-[16px] font-semibold leading-relaxed text-ink-900">{q.prompt}</p>
            <div className="mt-3 space-y-2">
              {q.options.map((o, k) => (
                <label key={k} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-[14.5px] transition", answers[q.id] === k ? "border-brand-500 bg-brand-50 text-ink-900" : "border-ink-200 bg-white text-ink-700 hover:border-ink-300")}>
                  <input type="radio" name={`q:${q.id}`} value={k} checked={answers[q.id] === k} onChange={() => setAnswers((a) => ({ ...a, [q.id]: k }))} className="accent-brand-600" />
                  <span className="font-semibold text-ink-400">{String.fromCharCode(65 + k)}</span> {o}
                </label>
              ))}
            </div>
          </li>
        ))}
      </ol>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-ink-500">Unanswered questions score zero. You cannot change answers after submitting.</p>
        <SubmitButton variant="primary" pendingText="Grading…" onClick={(e) => { if (answered < questions.length && !window.confirm(`You have ${questions.length - answered} unanswered question(s). Submit anyway?`)) e.preventDefault(); }}>Submit exam</SubmitButton>
      </div>
    </form>
  );
}
