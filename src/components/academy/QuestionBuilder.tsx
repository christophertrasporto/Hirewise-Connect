"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, Circle, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteQuestionAction, duplicateQuestionAction, moveQuestionAction, saveQuestionAction } from "@/app/(app)/quiz-actions";
import { saveBankQuestionAction } from "@/app/(app)/bank-actions";
import { idle, type ActionResult } from "@/server/http/action-result";
import { Checkbox, Field, FormAlert, Input, Select, SubmitButton, Textarea, inputBase, inputOk } from "@/components/ui/Form";
import { cn } from "@/lib/cn";

export type QuestionType = "MULTIPLE_CHOICE" | "MULTIPLE_SELECT" | "TRUE_FALSE" | "SHORT_ANSWER";
export type ChoiceValue = { id?: string; text: string; isCorrect: boolean };
export type QuestionValue = { id: string; type: QuestionType; prompt: string; explanation: string | null; points: number; isRequired: boolean; state: "DRAFT" | "PUBLISHED"; keywords: string[]; topic?: string | null; difficulty?: string | null; version: number; choices: ChoiceValue[] };

const TYPE_LABELS: Record<QuestionType, string> = { MULTIPLE_CHOICE: "Multiple choice (one correct)", MULTIPLE_SELECT: "Multiple correct answers", TRUE_FALSE: "True / False", SHORT_ANSWER: "Short answer" };
const iconBtn = "rounded-full p-1.5 text-ink-400 hover:bg-white hover:text-ink-800 disabled:opacity-40";
type SmallAction = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

function IconAction({ action, fields, label, confirm, children, danger }: { action: SmallAction; fields: Record<string, string>; label: string; confirm?: string; children: ReactNode; danger?: boolean }) {
  const [state, act, pending] = useActionState(action, idle);
  return (
    <form action={act} onSubmit={(e) => confirm && !window.confirm(confirm) && e.preventDefault()} className="inline-flex">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" aria-label={label} title={label} disabled={pending} className={cn(iconBtn, danger && "text-red-400 hover:text-red-600")}>{children}</button>
      {state.error && <span className="ml-2 self-center text-[12px] text-red-600">{state.error}</span>}
    </form>
  );
}

const blankChoices = (type: QuestionType): ChoiceValue[] => (type === "TRUE_FALSE" ? [{ text: "True", isCorrect: true }, { text: "False", isCorrect: false }] : type === "SHORT_ANSWER" ? [] : [{ text: "", isCorrect: true }, { text: "", isCorrect: false }, { text: "", isCorrect: false }, { text: "", isCorrect: false }]);

export function QuestionForm({ courseId, lessonId, question, onDone, bank = false }: { courseId: string; lessonId: string; question?: QuestionValue; onDone?: () => void; /** Bank-only question (no lesson). */ bank?: boolean }) {
  const [state, action] = useActionState(bank ? saveBankQuestionAction : saveQuestionAction, idle);
  const [type, setType] = useState<QuestionType>(question?.type ?? "MULTIPLE_CHOICE");
  const [choices, setChoices] = useState<ChoiceValue[]>(question?.choices.length ? question.choices : blankChoices(question?.type ?? "MULTIPLE_CHOICE"));
  const fe = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.ok) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);
  const uid = question?.id ?? "new";

  function changeType(t: QuestionType) {
    setType(t);
    if (t === "TRUE_FALSE") setChoices([{ text: "True", isCorrect: true }, { text: "False", isCorrect: false }]);
    else if (t === "SHORT_ANSWER") setChoices([]);
    else if (choices.length < 2 || choices.every((c) => !c.text)) setChoices(blankChoices(t));
    else if (t === "MULTIPLE_CHOICE") setChoices((cs) => { const first = cs.findIndex((c) => c.isCorrect); return cs.map((c, i) => ({ ...c, isCorrect: i === (first < 0 ? 0 : first) })); });
  }
  const setCorrect = (i: number) => setChoices((cs) => cs.map((c, k) => (type === "MULTIPLE_SELECT" ? (k === i ? { ...c, isCorrect: !c.isCorrect } : c) : { ...c, isCorrect: k === i })));

  return (
    <form action={action} className="space-y-4 rounded-2xl border border-brand-100 bg-brand-50/40 p-4" noValidate>
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="lessonId" value={lessonId} />
      {question && <input type="hidden" name="id" value={question.id} />}
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="choices" value={JSON.stringify(choices.filter((c) => c.text.trim() !== "" || type === "TRUE_FALSE"))} />
      <input type="hidden" name="isRequired" value="off" />

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <Field label="Question type" htmlFor={`q-type-${uid}`}>
          <Select id={`q-type-${uid}`} value={type} onChange={(e) => changeType(e.target.value as QuestionType)}>
            {(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </Select>
        </Field>
        <Field label="Question" htmlFor={`q-prompt-${uid}`} error={fe.prompt}>
          <Textarea id={`q-prompt-${uid}`} name="prompt" rows={2} defaultValue={question?.prompt ?? ""} placeholder="Write the question" invalid={!!fe.prompt} />
        </Field>
      </div>

      {type !== "SHORT_ANSWER" && (
        <div>
          <p className="mb-2 text-[13px] font-semibold text-ink-700">Answer choices <span className="font-normal text-ink-400">· {type === "MULTIPLE_SELECT" ? "tick every correct answer" : "the green mark is the correct answer"}</span></p>
          <ul className="space-y-2">
            {choices.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <button type="button" onClick={() => setCorrect(i)} aria-label={`Mark choice ${i + 1} correct`} className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[12px] font-bold", c.isCorrect ? "border-brand-500 bg-brand-500 text-white" : "border-ink-200 bg-white text-ink-400 hover:border-brand-300")}>
                  {c.isCorrect ? <CheckCircle2 className="h-4 w-4" /> : String.fromCharCode(65 + i)}
                </button>
                <input value={c.text} onChange={(e) => setChoices((cs) => cs.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} placeholder={`Choice ${String.fromCharCode(65 + i)}`} readOnly={type === "TRUE_FALSE"} className={cn(inputBase, inputOk, "h-10 text-[14px]")} />
                {type !== "TRUE_FALSE" && choices.length > 2 && <button type="button" onClick={() => setChoices((cs) => cs.filter((_, k) => k !== i))} aria-label="Remove choice" className="p-1 text-ink-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>}
              </li>
            ))}
          </ul>
          {type !== "TRUE_FALSE" && <button type="button" onClick={() => setChoices((cs) => [...cs, { text: "", isCorrect: false }])} className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600 hover:text-brand-700"><Plus className="h-3.5 w-3.5" /> Add choice</button>}
          {fe.choices && <p className="mt-2 text-[12.5px] font-medium text-red-600">{fe.choices}</p>}
        </div>
      )}

      {type === "SHORT_ANSWER" && (
        <Field label="Accepted keywords (comma separated, optional)" htmlFor={`q-kw-${uid}`} error={fe.keywords} hint="If any keyword appears in the answer it is marked correct automatically. Leave empty to review answers yourself.">
          <Input id={`q-kw-${uid}`} name="keywords" defaultValue={question?.keywords.join(", ") ?? ""} placeholder="e.g. permission, earn attention" />
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-[1fr_120px_180px]">
        <Field label="Explanation shown after grading (optional)" htmlFor={`q-expl-${uid}`} error={fe.explanation}>
          <Input id={`q-expl-${uid}`} name="explanation" defaultValue={question?.explanation ?? ""} />
        </Field>
        <Field label="Points" htmlFor={`q-pts-${uid}`} error={fe.points}>
          <Input id={`q-pts-${uid}`} name="points" type="number" min={1} max={100} defaultValue={question?.points ?? 1} />
        </Field>
        <Field label="Visibility" htmlFor={`q-state-${uid}`}>
          <Select id={`q-state-${uid}`} name="state" defaultValue={question?.state ?? "PUBLISHED"}>
            <option value="PUBLISHED">Published</option>
            <option value="DRAFT">Draft (not asked)</option>
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
        <Field label="Topic (optional)" htmlFor={`q-topic-${uid}`} hint="Groups questions in the course question bank, e.g. Openers, Objections.">
          <Input id={`q-topic-${uid}`} name="topic" defaultValue={question?.topic ?? ""} placeholder="e.g. Objections" />
        </Field>
        <Field label="Difficulty (optional)" htmlFor={`q-diff-${uid}`}>
          <Select id={`q-diff-${uid}`} name="difficulty" defaultValue={question?.difficulty ?? ""}>
            <option value="">Not set</option>
            <option value="BEGINNER">Beginner</option>
            <option value="INTERMEDIATE">Intermediate</option>
            <option value="ADVANCED">Advanced</option>
          </Select>
        </Field>
      </div>
      <Checkbox name="isRequired" defaultChecked={question?.isRequired ?? true} label="Required question" />

      {state.error && <FormAlert>{state.error}</FormAlert>}
      <div className="flex items-center gap-3">
        <SubmitButton pendingText="Saving…">{question ? "Save question" : "Add question"}</SubmitButton>
        {onDone && <button type="button" onClick={onDone} className="text-[13.5px] font-semibold text-ink-500 hover:text-ink-800">Cancel</button>}
      </div>
    </form>
  );
}

function QuestionRow({ courseId, lessonId, q, index, count }: { courseId: string; lessonId: string; q: QuestionValue; index: number; count: number }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <li className="py-3"><QuestionForm courseId={courseId} lessonId={lessonId} question={q} onDone={() => setEditing(false)} /></li>;
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-50 text-[12px] font-bold text-ink-500 ring-1 ring-inset ring-ink-100">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-semibold text-ink-900">{q.prompt}</p>
          <p className="text-[12px] text-ink-400">{TYPE_LABELS[q.type]} · {q.points} pt{q.points === 1 ? "" : "s"} · {q.state === "PUBLISHED" ? "published" : "draft"}{q.isRequired ? "" : " · optional"} · v{q.version}</p>
          {q.type === "SHORT_ANSWER" ? (
            <p className="mt-1.5 text-[13px] text-ink-500">{q.keywords.length ? `Auto-marked when the answer contains: ${q.keywords.join(", ")}` : "Reviewed by the coach"}</p>
          ) : (
            <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              {q.choices.map((c, i) => <li key={c.id ?? i} className={cn("inline-flex items-center gap-1", c.isCorrect ? "font-semibold text-brand-700" : "text-ink-500")}>{c.isCorrect ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5 text-ink-300" />} {c.text}</li>)}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <IconAction action={moveQuestionAction} fields={{ courseId, lessonId, questionId: q.id, direction: "up" }} label="Move up"><ArrowUp className={cn("h-4 w-4", index === 0 && "opacity-30")} /></IconAction>
          <IconAction action={moveQuestionAction} fields={{ courseId, lessonId, questionId: q.id, direction: "down" }} label="Move down"><ArrowDown className={cn("h-4 w-4", index === count - 1 && "opacity-30")} /></IconAction>
          <button type="button" onClick={() => setEditing(true)} aria-label="Edit question" title="Edit question" className={iconBtn}><Pencil className="h-4 w-4" /></button>
          <IconAction action={duplicateQuestionAction} fields={{ courseId, lessonId, questionId: q.id }} label="Duplicate question"><Copy className="h-4 w-4" /></IconAction>
          <IconAction action={deleteQuestionAction} fields={{ courseId, lessonId, questionId: q.id }} label="Delete question" confirm="Delete this question? Past attempts keep their own copy of it." danger><Trash2 className="h-4 w-4" /></IconAction>
        </div>
      </div>
    </li>
  );
}

/** Questions for one lesson. No limit: keep clicking "Add question". Edits start a new question version; attempts keep theirs. */
export function QuestionBuilder({ courseId, lessonId, questions }: { courseId: string; lessonId: string; questions: QuestionValue[] }) {
  const [adding, setAdding] = useState(questions.length === 0);
  const published = questions.filter((q) => q.state === "PUBLISHED").length;
  return (
    <div className="space-y-4">
      <p className="text-[13.5px] text-ink-500">{questions.length} question{questions.length === 1 ? "" : "s"} · {published} published · {questions.filter((q) => q.state === "PUBLISHED").reduce((s, q) => s + q.points, 0)} points</p>
      <ol className="divide-y divide-ink-100">{questions.map((q, i) => <QuestionRow key={q.id} courseId={courseId} lessonId={lessonId} q={q} index={i} count={questions.length} />)}</ol>
      {adding ? <QuestionForm courseId={courseId} lessonId={lessonId} onDone={questions.length ? () => setAdding(false) : undefined} /> : <button type="button" onClick={() => setAdding(true)} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white hover:bg-ink-800"><Plus className="h-4 w-4" /> Add question</button>}
    </div>
  );
}
