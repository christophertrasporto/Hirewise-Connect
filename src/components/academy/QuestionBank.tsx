"use client";

import { useActionState, useState, type ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, Copy, Pencil, Plus, Trash2, FolderInput, BookmarkPlus } from "lucide-react";
import { copyToBankAction, copyToLessonAction, deleteBankQuestionAction } from "@/app/(app)/bank-actions";
import { idle, type ActionResult } from "@/server/http/action-result";
import { QuestionForm, type QuestionValue } from "@/components/academy/QuestionBuilder";
import { cn } from "@/lib/cn";

export type BankItem = QuestionValue & { topic: string | null; difficulty: string | null; updatedAt: Date | string; lesson: { id: string; title: string; module: string } | null };
type LessonOption = { id: string; title: string; module: string };

const TYPE_SHORT: Record<string, string> = { MULTIPLE_CHOICE: "Multiple choice", MULTIPLE_SELECT: "Multiple select", TRUE_FALSE: "True / False", SHORT_ANSWER: "Short answer" };
const DIFF: Record<string, string> = { BEGINNER: "Beginner", INTERMEDIATE: "Intermediate", ADVANCED: "Advanced" };
type SmallAction = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

function Act({ action, fields, label, confirm, children, className }: { action: SmallAction; fields: Record<string, string>; label: string; confirm?: string; children: ReactNode; className?: string }) {
  const [state, act, pending] = useActionState(action, idle);
  return (
    <form action={act} onSubmit={(e) => confirm && !window.confirm(confirm) && e.preventDefault()} className="inline-flex items-center">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" aria-label={label} title={label} disabled={pending} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-50 disabled:opacity-40", className)}>{children}</button>
      {state.ok && <span className="ml-2 text-[12px] font-semibold text-brand-700">Done</span>}
      {state.error && <span className="ml-2 text-[12px] text-red-600">{state.error}</span>}
    </form>
  );
}

/** "Add to lesson…" with a lesson picker. */
function AddToLesson({ courseId, questionId, lessons, exclude }: { courseId: string; questionId: string; lessons: LessonOption[]; exclude: string | null }) {
  const [state, act, pending] = useActionState(copyToLessonAction, idle);
  const options = lessons.filter((l) => l.id !== exclude);
  if (options.length === 0) return null;
  return (
    <form action={act} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="questionId" value={questionId} />
      <select name="lessonId" defaultValue="" className="h-8 rounded-full border border-ink-200 bg-white px-2.5 text-[12px] text-ink-700" aria-label="Lesson to add this question to">
        <option value="">Add to lesson…</option>
        {options.map((l) => <option key={l.id} value={l.id}>{l.module} · {l.title}</option>)}
      </select>
      <button type="submit" disabled={pending} className="inline-flex items-center gap-1 rounded-full bg-ink-900 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-ink-800 disabled:opacity-40"><FolderInput className="h-3.5 w-3.5" /> Add</button>
      {state.ok && <span className="text-[12px] font-semibold text-brand-700">Added</span>}
      {state.error && <span className="text-[12px] text-red-600">{state.error}</span>}
    </form>
  );
}

function BankRow({ courseId, q, lessons }: { courseId: string; q: BankItem; lessons: LessonOption[] }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <li className="py-3"><QuestionForm courseId={courseId} lessonId="" bank question={q} onDone={() => setEditing(false)} /></li>;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-semibold text-ink-900">{q.prompt}</p>
          <p className="text-[12px] text-ink-400">
            {TYPE_SHORT[q.type]} · {q.points} pt{q.points === 1 ? "" : "s"} · {q.state === "PUBLISHED" ? "published" : "draft"}
            {q.topic ? <> · <span className="rounded-full bg-ink-50 px-2 py-0.5 text-ink-600 ring-1 ring-inset ring-ink-100">{q.topic}</span></> : null}
            {q.difficulty ? ` · ${DIFF[q.difficulty] ?? q.difficulty}` : ""}
            {" · "}
            {q.lesson ? <Link href={`/courses/manage/${courseId}/lessons/${q.lesson.id}?tab=questions`} className="font-semibold text-brand-600 hover:text-brand-700">{q.lesson.module} · {q.lesson.title}</Link> : <span className="font-semibold text-gold-700">Bank only</span>}
          </p>
          {q.type === "SHORT_ANSWER" ? (
            <p className="mt-1 text-[13px] text-ink-500">{q.keywords.length ? `Keywords: ${q.keywords.join(", ")}` : "Reviewed by the coach"}</p>
          ) : (
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              {q.choices.map((c, i) => <li key={c.id ?? i} className={cn("inline-flex items-center gap-1", c.isCorrect ? "font-semibold text-brand-700" : "text-ink-500")}>{c.isCorrect ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />} {c.text}</li>)}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddToLesson courseId={courseId} questionId={q.id} lessons={lessons} exclude={q.lesson?.id ?? null} />
          {q.lesson ? (
            <Act action={copyToBankAction} fields={{ courseId, questionId: q.id, lessonId: q.lesson.id }} label="Keep a copy in the bank"><BookmarkPlus className="h-3.5 w-3.5" /> To bank</Act>
          ) : (
            <>
              <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-50"><Pencil className="h-3.5 w-3.5" /> Edit</button>
              <Act action={deleteBankQuestionAction} fields={{ courseId, questionId: q.id }} label="Delete from the bank" confirm="Delete this bank question? Copies already added to lessons are not affected." className="text-red-500 hover:text-red-700"><Trash2 className="h-3.5 w-3.5" /> Delete</Act>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/** The course's question bank: filters, every question with where it lives, reuse actions, and a form for bank-only questions. */
export function QuestionBank({ courseId, items, topics, lessons, filters, total, bankOnly }: { courseId: string; items: BankItem[]; topics: string[]; lessons: LessonOption[]; filters: { q?: string; topic?: string; difficulty?: string; type?: string; location?: string }; total: number; bankOnly: number }) {
  const [adding, setAdding] = useState(false);
  const sel = "h-10 rounded-xl border border-ink-200 bg-white px-3 text-[13.5px] text-ink-800";
  return (
    <div className="space-y-5">
      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="text-[12px] font-semibold text-ink-500">Search<br /><input name="q" defaultValue={filters.q ?? ""} placeholder="Prompt, choice, or topic" className={`${sel} w-[220px]`} /></label>
        <label className="text-[12px] font-semibold text-ink-500">Where<br /><select name="location" defaultValue={filters.location ?? "ALL"} className={sel}><option value="ALL">Everywhere</option><option value="BANK">Bank only</option><option value="LESSONS">In lessons</option>{lessons.map((l) => <option key={l.id} value={l.id}>{l.module} · {l.title}</option>)}</select></label>
        <label className="text-[12px] font-semibold text-ink-500">Topic<br /><select name="topic" defaultValue={filters.topic ?? ""} className={sel}><option value="">Any</option>{topics.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label className="text-[12px] font-semibold text-ink-500">Difficulty<br /><select name="difficulty" defaultValue={filters.difficulty ?? ""} className={sel}><option value="">Any</option><option value="BEGINNER">Beginner</option><option value="INTERMEDIATE">Intermediate</option><option value="ADVANCED">Advanced</option></select></label>
        <label className="text-[12px] font-semibold text-ink-500">Type<br /><select name="type" defaultValue={filters.type ?? ""} className={sel}><option value="">Any</option>{Object.entries(TYPE_SHORT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <button type="submit" className="h-10 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white hover:bg-ink-800">Filter</button>
      </form>
      <p className="text-[13px] text-ink-500">{items.length} of {total} question{total === 1 ? "" : "s"} · {bankOnly} bank-only · {topics.length} topic{topics.length === 1 ? "" : "s"}</p>
      {items.length === 0 ? <p className="rounded-2xl bg-ink-50 px-4 py-6 text-center text-[13.5px] text-ink-500">No questions match. Add one below or build questions on a lesson page.</p> : <ol className="divide-y divide-ink-100">{items.map((q) => <BankRow key={q.id} courseId={courseId} q={q} lessons={lessons} />)}</ol>}
      {adding ? <QuestionForm courseId={courseId} lessonId="" bank onDone={() => setAdding(false)} /> : <button type="button" onClick={() => setAdding(true)} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white hover:bg-ink-800"><Plus className="h-4 w-4" /> New bank question</button>}
      <p className="text-[12.5px] text-ink-400"><Copy className="mr-1 inline h-3.5 w-3.5" />Adding a question to a lesson makes a copy with new ids, so edits in one place never change another lesson&apos;s quiz or any past attempt. Random draws (&quot;ask N of these&quot;) are set per lesson on its Settings tab.</p>
    </div>
  );
}
