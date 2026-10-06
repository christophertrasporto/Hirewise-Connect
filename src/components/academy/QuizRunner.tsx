"use client";

import { useActionState, useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { reviewAttemptAction, startAttemptAction, submitAttemptAction, type SubmitResult } from "@/app/(app)/quiz-actions";
import { idle, type ActionResult } from "@/server/http/action-result";
import { Field, FormAlert, Input, SubmitButton, Textarea } from "@/components/ui/Form";
import { cn } from "@/lib/cn";

export function StartQuizButton({ lessonId, label }: { lessonId: string; label: string }) {
  const [state, action] = useActionState(startAttemptAction, idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="lessonId" value={lessonId} />
      <SubmitButton pendingText="Opening…">{label}</SubmitButton>
      {state.error && <FormAlert>{state.error}</FormAlert>}
    </form>
  );
}

export type RunnerQuestion = { questionId: string; type: "MULTIPLE_CHOICE" | "MULTIPLE_SELECT" | "TRUE_FALSE" | "SHORT_ANSWER"; prompt: string; points: number; choices: Array<{ id: string; text: string }> };

/** Takes one attempt. Answers are posted by choice id, so shuffled choices score correctly. */
export function QuizRunner({ attemptId, questions, expiresAt, courseId, lessonId, passingScore }: { attemptId: string; questions: RunnerQuestion[]; expiresAt: string | null; courseId: string; lessonId: string; passingScore: number }) {
  const [state, action] = useActionState(submitAttemptAction, idle as ActionResult<SubmitResult>);
  const [answered, setAnswered] = useState<Record<string, boolean>>({});
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
        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-400">{r.pendingReview ? "Submitted for review" : "Your result"}</p>
        <p className={cn("mt-2 font-display text-[4rem] font-extrabold leading-none", r.passed ? "text-brand-600" : "text-ink-900")}>{r.scorePercent}%</p>
        <p className="mt-3 text-[16px] font-semibold text-ink-800">
          {r.expired ? "Time ran out before you submitted." : r.pendingReview ? "Your coach will review the written answers and confirm your score." : r.passed ? "You passed. Well done." : `Not yet. You need ${passingScore}% to pass.`}
        </p>
        <p className="mt-1 text-[13.5px] text-ink-500">
          {r.courseCompleted ? "That completes the course. Any certification linked to it is being processed." : r.passed ? `Course progress: ${r.coursePercent}%.` : r.attemptsLeft === null ? "You can retake this quiz." : r.attemptsLeft > 0 ? `${r.attemptsLeft} attempt${r.attemptsLeft === 1 ? "" : "s"} left.` : "No attempts left. Ask your coach about a retake."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a href={`/courses/attempt/${attemptId}`} className="inline-flex h-11 items-center rounded-full border border-ink-200 bg-white px-5 text-[14.5px] font-semibold text-ink-700 hover:bg-ink-50">Review answers</a>
          <a href={`/courses/${courseId}/quiz/${lessonId}`} className="inline-flex h-11 items-center rounded-full bg-ink-900 px-6 text-[14.5px] font-semibold text-white hover:bg-ink-800">Back to the lesson</a>
        </div>
      </div>
    );
  }

  const done = Object.values(answered).filter(Boolean).length;
  const mm = left !== null ? Math.floor(left / 60) : 0;
  const ss = left !== null ? left % 60 : 0;
  const mark = (id: string, v: boolean) => setAnswered((a) => ({ ...a, [id]: v }));

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="attemptId" value={attemptId} />
      <div className="sticky top-[64px] z-20 flex items-center justify-between rounded-2xl border border-ink-100 bg-white/90 px-4 py-3 text-[13.5px] backdrop-blur">
        <span className="font-semibold text-ink-800">{done} / {questions.length} answered</span>
        {left !== null && <span className={cn("font-mono font-semibold", left < 120 ? "text-red-600" : "text-ink-600")}>{String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")} left</span>}
      </div>
      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li key={q.questionId} className="rounded-3xl border border-ink-100 bg-white p-5 shadow-soft">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Question {i + 1} · {q.points} pt{q.points === 1 ? "" : "s"}{q.type === "MULTIPLE_SELECT" ? " · choose all that apply" : ""}</p>
            <p className="mt-1.5 text-[16px] font-semibold leading-relaxed text-ink-900">{q.prompt}</p>
            {q.type === "SHORT_ANSWER" ? (
              <textarea name={`q:${q.questionId}:text`} rows={3} onChange={(e) => mark(q.questionId, e.target.value.trim() !== "")} placeholder="Type your answer" className="mt-3 w-full rounded-xl border border-ink-200 px-3.5 py-2.5 text-[14.5px] focus:border-brand-500 focus:outline-none" />
            ) : (
              <div className="mt-3 space-y-2">
                {q.choices.map((c, k) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-ink-200 px-3.5 py-2.5 text-[14.5px] transition has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                    <input type={q.type === "MULTIPLE_SELECT" ? "checkbox" : "radio"} name={`q:${q.questionId}`} value={c.id} onChange={(e) => mark(q.questionId, q.type === "MULTIPLE_SELECT" ? !!e.currentTarget.form?.querySelector(`input[name="q:${q.questionId}"]:checked`) : true)} className="accent-brand-600" />
                    <span className="font-semibold text-ink-400">{String.fromCharCode(65 + k)}</span> {c.text}
                  </label>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-ink-500">Unanswered questions score zero. You cannot change answers after submitting.</p>
        <SubmitButton variant="primary" pendingText="Grading…" onClick={(e) => { if (done < questions.length && !window.confirm(`You have ${questions.length - done} unanswered question(s). Submit anyway?`)) e.preventDefault(); }}>Submit answers</SubmitButton>
      </div>
    </form>
  );
}

export type ReviewQuestion = { questionId: string; prompt: string; points: number; choices: Array<{ id: string; text: string }>; type: RunnerQuestion["type"]; answer: string[] | string | null; correctChoiceIds?: string[]; explanation?: string | null; correct: boolean | null | undefined };

/** Read-only review of a submitted attempt, honouring the lesson's show-answers and show-explanations settings. */
export function AttemptReview({ questions }: { questions: ReviewQuestion[] }) {
  return (
    <ol className="space-y-4">
      {questions.map((q, i) => {
        const chosen = new Set(Array.isArray(q.answer) ? q.answer : typeof q.answer === "string" ? [q.answer] : []);
        return (
          <li key={q.questionId} className="rounded-3xl border border-ink-100 bg-white p-5 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Question {i + 1} · {q.points} pt{q.points === 1 ? "" : "s"}</p>
                <p className="mt-1.5 text-[16px] font-semibold leading-relaxed text-ink-900">{q.prompt}</p>
              </div>
              {q.correct === true && <CheckCircle2 className="h-6 w-6 shrink-0 text-brand-500" />}
              {q.correct === false && <XCircle className="h-6 w-6 shrink-0 text-red-500" />}
            </div>
            {q.type === "SHORT_ANSWER" ? (
              <p className="mt-3 rounded-xl bg-ink-50 px-3.5 py-2.5 text-[14px] text-ink-700">{typeof q.answer === "string" && q.answer ? q.answer : <span className="text-ink-400">No answer</span>}{q.correct === null && <span className="ml-2 text-[12px] font-semibold text-gold-700">awaiting coach review</span>}</p>
            ) : (
              <div className="mt-3 space-y-2">
                {q.choices.map((c, k) => {
                  const isChosen = chosen.has(c.id);
                  const isCorrect = q.correctChoiceIds?.includes(c.id);
                  return (
                    <div key={c.id} className={cn("flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-[14.5px]", isCorrect ? "border-brand-500 bg-brand-50" : isChosen ? "border-red-300 bg-red-50" : "border-ink-100")}>
                      <span className="font-semibold text-ink-400">{String.fromCharCode(65 + k)}</span>
                      <span className="flex-1">{c.text}</span>
                      {isChosen && <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">your answer</span>}
                      {isCorrect && <CheckCircle2 className="h-4 w-4 text-brand-600" />}
                    </div>
                  );
                })}
              </div>
            )}
            {q.explanation && <p className="mt-3 rounded-xl bg-gold-50 px-3.5 py-2.5 text-[13.5px] text-gold-800">{q.explanation}</p>}
          </li>
        );
      })}
    </ol>
  );
}

export function ReviewAttemptForm({ courseId, attemptId, autoScore, passingScore }: { courseId: string; attemptId: string; autoScore: number | null; passingScore: number }) {
  const [state, action] = useActionState(reviewAttemptAction, idle);
  if (state.ok) return <FormAlert tone="success">Score recorded.</FormAlert>;
  return (
    <form action={action} className="flex flex-wrap items-end gap-3" noValidate>
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="attemptId" value={attemptId} />
      <Field label={`Final score (%) · pass at ${passingScore}`} htmlFor={`rv-score-${attemptId}`} className="w-[180px]">
        <Input id={`rv-score-${attemptId}`} name="scorePercent" type="number" min={0} max={100} defaultValue={autoScore ?? ""} />
      </Field>
      <Field label="Feedback (optional)" htmlFor={`rv-fb-${attemptId}`} className="min-w-[240px] flex-1">
        <Textarea id={`rv-fb-${attemptId}`} name="feedback" rows={1} />
      </Field>
      <SubmitButton pendingText="Saving…" className="h-10 text-[13.5px]">Record score</SubmitButton>
      {state.error && <p className="w-full text-[12.5px] text-red-600">{state.error}</p>}
    </form>
  );
}
