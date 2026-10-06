"use client";

import { useActionState } from "react";
import { createCourseAction, updateCourseAction } from "@/app/(app)/academy-actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Textarea, Checkbox, Select, SubmitButton, FormAlert } from "@/components/ui/Form";

export type CourseFormValues = {
  id?: string;
  title: string;
  categoryId: string | null;
  description: string;
  difficulty: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  estimatedMinutes: number | null;
  introVideoUrl: string | null;
  welcomeMessage: string | null;
  syllabus: string | null;
  contentUrl: string | null;
  priceCents: number;
  passingScore: number;
  requiresCoachReview: boolean;
};
export type CategoryOption = { id: string; name: string };

const DIFFICULTY_LABELS = { BEGINNER: "Beginner", INTERMEDIATE: "Intermediate", ADVANCED: "Advanced" } as const;

/** Course overview form. Categories come from the admin-managed table; nothing here is hardcoded. */
export function CourseForm({ course, categories }: { course?: CourseFormValues; categories: CategoryOption[] }) {
  const [state, action] = useActionState(course ? updateCourseAction : createCourseAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      {course && <input type="hidden" name="courseId" value={course.id} />}
      <div className="grid gap-5 md:grid-cols-[1fr_240px]">
        <Field label="Course title" htmlFor="title" error={fe.title}>
          <Input id="title" name="title" defaultValue={course?.title ?? ""} placeholder="e.g. Cold Calling Mastery" invalid={!!fe.title} required />
        </Field>
        <Field label="Category" htmlFor="categoryId" error={fe.categoryId}>
          <Select id="categoryId" name="categoryId" defaultValue={course?.categoryId ?? ""} invalid={!!fe.categoryId} required>
            <option value="">Choose a category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Short description" htmlFor="description" error={fe.description} hint="Shown on the course card and page.">
        <Textarea id="description" name="description" rows={3} defaultValue={course?.description ?? ""} invalid={!!fe.description} required />
      </Field>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Difficulty" htmlFor="difficulty" error={fe.difficulty}>
          <Select id="difficulty" name="difficulty" defaultValue={course?.difficulty ?? "BEGINNER"}>
            {(Object.keys(DIFFICULTY_LABELS) as Array<keyof typeof DIFFICULTY_LABELS>).map((k) => <option key={k} value={k}>{DIFFICULTY_LABELS[k]}</option>)}
          </Select>
        </Field>
        <Field label="Estimated duration (minutes)" htmlFor="estimatedMinutes" error={fe.estimatedMinutes}>
          <Input id="estimatedMinutes" name="estimatedMinutes" type="number" min={1} defaultValue={course?.estimatedMinutes ?? ""} placeholder="e.g. 240" invalid={!!fe.estimatedMinutes} />
        </Field>
        <Field label="Price (USD)" htmlFor="priceUsd" error={fe.priceUsd} hint="Leave 0 for a free course.">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[14px] font-semibold text-ink-400">$</span>
            <Input id="priceUsd" name="priceUsd" inputMode="decimal" defaultValue={course ? (course.priceCents / 100).toFixed(2) : "0.00"} className="pl-8" invalid={!!fe.priceUsd} />
          </div>
        </Field>
      </div>
      <Field label="Intro video URL (optional)" htmlFor="introVideoUrl" error={fe.introVideoUrl} hint="YouTube, Vimeo, or Loom link shown on the course page before enrolling.">
        <Input id="introVideoUrl" name="introVideoUrl" type="url" defaultValue={course?.introVideoUrl ?? ""} placeholder="https://" invalid={!!fe.introVideoUrl} />
      </Field>
      <Field label="Welcome message (optional)" htmlFor="welcomeMessage" error={fe.welcomeMessage} hint="Shown to learners when they open the course.">
        <Textarea id="welcomeMessage" name="welcomeMessage" rows={3} defaultValue={course?.welcomeMessage ?? ""} />
      </Field>
      <details className="rounded-2xl border border-ink-100 bg-ink-50/50 p-4">
        <summary className="cursor-pointer text-[13.5px] font-semibold text-ink-700">Overview text and external link (optional)</summary>
        <div className="mt-4 space-y-4">
          <Field label="Overview" htmlFor="syllabus" error={fe.syllabus} hint="Markdown shown under the lessons. Lessons themselves live in Modules & Lessons.">
            <Textarea id="syllabus" name="syllabus" rows={6} defaultValue={course?.syllabus ?? ""} />
          </Field>
          <Field label="External materials link" htmlFor="contentUrl" error={fe.contentUrl}>
            <Input id="contentUrl" name="contentUrl" type="url" defaultValue={course?.contentUrl ?? ""} placeholder="https://" invalid={!!fe.contentUrl} />
          </Field>
        </div>
      </details>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Default passing score (%)" htmlFor="passingScore" error={fe.passingScore} hint="Used by quizzes that do not set their own.">
          <Input id="passingScore" name="passingScore" type="number" min={1} max={100} defaultValue={course?.passingScore ?? 70} invalid={!!fe.passingScore} />
        </Field>
        <div className="pt-7">
          <Checkbox name="requiresCoachReview" defaultChecked={course?.requiresCoachReview ?? false} label={<span>Coach review required before certification<span className="block text-[12px] text-ink-400">You assess each learner after they complete the course.</span></span>} />
        </div>
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Course saved.</FormAlert>}
      <SubmitButton pendingText="Saving…">{course ? "Save changes" : "Create course"}</SubmitButton>
    </form>
  );
}
