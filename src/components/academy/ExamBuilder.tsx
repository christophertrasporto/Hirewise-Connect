"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown, CheckCircle2 } from "lucide-react";
import { saveExamAction } from "@/app/(app)/academy-actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Textarea, SubmitButton, FormAlert, inputBase, inputOk } from "@/components/ui/Form";
import { cn } from "@/lib/cn";

export type QuestionDraft = { prompt: string; options: string[]; correctIndex: number; points: number; explanation: string };
type ExamValues = { title: string; instructions: string | null; timeLimitMin: number | null; maxAttempts: number; status: string; questions: QuestionDraft[] };

const blank = (): QuestionDraft => ({ prompt: "", options: ["", "", "", ""], correctIndex: 0, points: 1, explanation: "" });

export function ExamBuilder({ courseId, exam, locked }: { courseId: string; exam: ExamValues | null; locked: boolean }) {
  const [state, action] = useActionState(saveExamAction, idle);
  const [questions, setQuestions] = useState<QuestionDraft[]>(exam?.questions.length ? exam.questions : [blank()]);
  const fe = state.fieldErrors ?? {};

  const update = (i: number, patch: Partial<QuestionDraft>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, dir: -1 | 1) => setQuestions((qs) => {
    const j = i + dir;
    if (j < 0 || j >= qs.length) return qs;
    const copy = [...qs];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });
  const total = questions.reduce((s, q) => s + (Number(q.points) || 0), 0);

  return (
    <form action={action} className="space-y-6" noValidate>
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="questions" value={JSON.stringify(questions.map((q) => ({ ...q, options: q.options.filter((o) => o.trim() !== "") })))} />
      <div className="grid gap-5 md:grid-cols-[1fr_140px_140px]">
        <Field label="Exam title" htmlFor="examTitle" error={fe.title}>
          <Input id="examTitle" name="title" defaultValue={exam?.title ?? ""} placeholder="Final assessment" invalid={!!fe.title} disabled={locked} />
        </Field>
        <Field label="Time limit (min)" htmlFor="timeLimitMin" error={fe.timeLimitMin} hint="Blank = untimed">
          <Input id="timeLimitMin" name="timeLimitMin" type="number" min={5} max={240} defaultValue={exam?.timeLimitMin ?? ""} disabled={locked} />
        </Field>
        <Field label="Max attempts" htmlFor="maxAttempts" error={fe.maxAttempts}>
          <Input id="maxAttempts" name="maxAttempts" type="number" min={1} max={10} defaultValue={exam?.maxAttempts ?? 2} disabled={locked} />
        </Field>
      </div>
      <Field label="Instructions to students (optional)" htmlFor="instructions" error={fe.instructions}>
        <Textarea id="instructions" name="instructions" rows={2} defaultValue={exam?.instructions ?? ""} disabled={locked} />
      </Field>

      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li key={i} className="rounded-2xl border border-ink-100 bg-ink-50/50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Question {i + 1}</p>
              {!locked && (
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => move(i, -1)} aria-label="Move up" className="rounded-full p-1.5 text-ink-400 hover:bg-white hover:text-ink-800"><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" onClick={() => move(i, 1)} aria-label="Move down" className="rounded-full p-1.5 text-ink-400 hover:bg-white hover:text-ink-800"><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))} aria-label="Remove question" className="rounded-full p-1.5 text-red-400 hover:bg-white hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              )}
            </div>
            <textarea value={q.prompt} onChange={(e) => update(i, { prompt: e.target.value })} placeholder="Write the question" rows={2} disabled={locked} className={cn(inputBase, inputOk, "h-auto min-h-[60px] py-2.5 text-[14.5px]")} />
            {fe[`questions.${i}.prompt`] && <p className="mt-1 text-[12.5px] font-medium text-red-600">{fe[`questions.${i}.prompt`]}</p>}
            <div className="mt-3 space-y-2">
              {q.options.map((o, k) => (
                <div key={k} className="flex items-center gap-2">
                  <button type="button" onClick={() => update(i, { correctIndex: k })} disabled={locked} aria-label={`Mark option ${k + 1} correct`} className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[12px] font-bold", q.correctIndex === k ? "border-brand-500 bg-brand-500 text-white" : "border-ink-200 bg-white text-ink-400 hover:border-brand-300")}>
                    {q.correctIndex === k ? <CheckCircle2 className="h-4 w-4" /> : String.fromCharCode(65 + k)}
                  </button>
                  <input value={o} onChange={(e) => update(i, { options: q.options.map((x, m) => (m === k ? e.target.value : x)) })} placeholder={`Option ${String.fromCharCode(65 + k)}`} disabled={locked} className={cn(inputBase, inputOk, "h-10 text-[14px]")} />
                  {!locked && q.options.length > 2 && <button type="button" onClick={() => update(i, { options: q.options.filter((_, m) => m !== k), correctIndex: q.correctIndex >= k && q.correctIndex > 0 ? q.correctIndex - 1 : q.correctIndex })} aria-label="Remove option" className="p-1 text-ink-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>}
                </div>
              ))}
              {!locked && q.options.length < 6 && <button type="button" onClick={() => update(i, { options: [...q.options, ""] })} className="text-[13px] font-semibold text-brand-600 hover:text-brand-700">+ Add option</button>}
              {fe[`questions.${i}.options`] && <p className="text-[12.5px] font-medium text-red-600">{fe[`questions.${i}.options`]}</p>}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[120px_1fr]">
              <label className="text-[13px] font-medium text-ink-600">Points<input type="number" min={1} max={20} value={q.points} onChange={(e) => update(i, { points: Number(e.target.value) || 1 })} disabled={locked} className={cn(inputBase, inputOk, "mt-1 h-9 text-[14px]")} /></label>
              <label className="text-[13px] font-medium text-ink-600">Explanation shown after grading (optional)<input value={q.explanation} onChange={(e) => update(i, { explanation: e.target.value })} disabled={locked} className={cn(inputBase, inputOk, "mt-1 h-9 text-[14px]")} /></label>
            </div>
          </li>
        ))}
      </ol>
      {fe.questions && <FormAlert>{fe.questions}</FormAlert>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink-500">{questions.length} question{questions.length === 1 ? "" : "s"} · {total} point{total === 1 ? "" : "s"} · the green letter marks the correct answer</p>
        {!locked && <button type="button" onClick={() => setQuestions((qs) => [...qs, blank()])} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-ink-200 bg-white px-4 text-[13.5px] font-semibold text-ink-800 hover:bg-ink-50"><Plus className="h-4 w-4" /> Add question</button>}
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Exam saved.</FormAlert>}
      {locked ? <FormAlert tone="info">This exam is published. Ask an admin to archive the course before changing questions so live attempts stay consistent.</FormAlert> : <SubmitButton pendingText="Saving…">Save exam</SubmitButton>}
    </form>
  );
}
