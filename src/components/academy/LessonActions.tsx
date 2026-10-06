"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { markLessonCompleteAction, reviewSubmissionAction, startLessonAction } from "@/app/(app)/lesson-actions";
import { idle, type ActionResult } from "@/server/http/action-result";
import { Field, FormAlert, Input, SubmitButton, Textarea } from "@/components/ui/Form";

/** "Mark as done" for text, document, link, and non-measurable video lessons. */
export function MarkCompleteButton({ lessonId, courseId, label = "Mark as done" }: { lessonId: string; courseId: string; label?: string }) {
  const router = useRouter();
  const [state, action] = useActionState(markLessonCompleteAction, idle as ActionResult<{ coursePercent: number | null; courseCompleted: boolean }>);
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);
  if (state.ok) return <p className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-brand-700"><CheckCircle2 className="h-4 w-4" /> Done{state.data?.courseCompleted ? " · that completes the course" : state.data?.coursePercent !== null && state.data?.coursePercent !== undefined ? ` · course ${state.data.coursePercent}%` : ""}</p>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="lessonId" value={lessonId} />
      <input type="hidden" name="courseId" value={courseId} />
      <SubmitButton pendingText="Saving…" variant="outline" className="h-10 text-[13.5px]">{label}</SubmitButton>
      {state.error && <span className="text-[12.5px] text-red-600">{state.error}</span>}
    </form>
  );
}

/** Wraps an outbound link or document so opening it records "In progress". */
export function TrackedLink({ lessonId, href, className, children, download }: { lessonId: string; href: string; className?: string; children: React.ReactNode; download?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} onClick={() => void startLessonAction(lessonId)} download={download ? "" : undefined}>
      {children}
    </a>
  );
}

/** Coach grades a submission (optional points), writes feedback, and completes or returns it. */
export function ReviewSubmissionForm({ courseId, submissionId, maxPoints }: { courseId: string; submissionId: string; maxPoints: number | null }) {
  const [state, action] = useActionState(reviewSubmissionAction, idle);
  const fe = state.fieldErrors ?? {};
  if (state.ok) return <FormAlert tone="success">Review recorded.</FormAlert>;
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="submissionId" value={submissionId} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label={maxPoints ? `Grade (out of ${maxPoints})` : "Grade (optional)"} htmlFor={`sub-grade-${submissionId}`} error={fe.grade} className="w-[160px]">
          <Input id={`sub-grade-${submissionId}`} name="grade" type="number" min={0} max={maxPoints ?? 100} invalid={!!fe.grade} />
        </Field>
        <Field label="Feedback" htmlFor={`sub-fb-${submissionId}`} error={fe.feedback} hint="Required when returning for changes." className="min-w-[240px] flex-1">
          <Textarea id={`sub-fb-${submissionId}`} name="feedback" rows={2} invalid={!!fe.feedback} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="GRADED" pendingText="Saving…" className="h-10 text-[13.5px]">Mark complete</SubmitButton>
        <SubmitButton name="decision" value="RETURNED" variant="outline" pendingText="Saving…" className="h-10 text-[13.5px]">Return for changes</SubmitButton>
      </div>
      {state.error && !state.fieldErrors && <p className="text-[12.5px] text-red-600">{state.error}</p>}
    </form>
  );
}
