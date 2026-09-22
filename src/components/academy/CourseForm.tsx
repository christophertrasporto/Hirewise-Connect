"use client";

import { useActionState } from "react";
import { createCourseAction, updateCourseAction } from "@/app/(app)/academy-actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Textarea, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";

export type CourseFormValues = { id?: string; title: string; category: string; description: string; syllabus: string | null; contentUrl: string | null; priceCents: number; passingScore: number; requiresCoachReview: boolean };

const CATEGORIES = ["Sales and Appointment Setting", "Customer Service", "Executive Assistance", "Marketing", "Operations", "Communication", "Tools and Software", "Compliance"];

export function CourseForm({ course }: { course?: CourseFormValues }) {
  const [state, action] = useActionState(course ? updateCourseAction : createCourseAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      {course && <input type="hidden" name="courseId" value={course.id} />}
      <div className="grid gap-5 md:grid-cols-[1fr_240px]">
        <Field label="Course title" htmlFor="title" error={fe.title}>
          <Input id="title" name="title" defaultValue={course?.title ?? ""} placeholder="e.g. Appointment Setting Fundamentals" invalid={!!fe.title} required />
        </Field>
        <Field label="Category" htmlFor="category" error={fe.category}>
          <Input id="category" name="category" list="course-categories" defaultValue={course?.category ?? ""} placeholder="Choose or type" invalid={!!fe.category} required />
          <datalist id="course-categories">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
      </div>
      <Field label="Short description" htmlFor="description" error={fe.description} hint="Shown in the Academy catalog to talent.">
        <Textarea id="description" name="description" rows={3} defaultValue={course?.description ?? ""} invalid={!!fe.description} required />
      </Field>
      <Field label="Syllabus and lesson content" htmlFor="syllabus" error={fe.syllabus} hint="Markdown-style text. Only enrolled (and, for paid courses, paid) talent can read it.">
        <Textarea id="syllabus" name="syllabus" rows={10} defaultValue={course?.syllabus ?? ""} placeholder={"Module 1: ...\nModule 2: ..."} />
      </Field>
      <Field label="External lesson link (optional)" htmlFor="contentUrl" error={fe.contentUrl} hint="A video playlist, LMS page, or shared folder.">
        <Input id="contentUrl" name="contentUrl" type="url" defaultValue={course?.contentUrl ?? ""} placeholder="https://" invalid={!!fe.contentUrl} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Price (USD)" htmlFor="priceUsd" error={fe.priceUsd} hint="Leave 0 for a free course.">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[14px] font-semibold text-ink-400">$</span>
            <Input id="priceUsd" name="priceUsd" inputMode="decimal" defaultValue={course ? (course.priceCents / 100).toFixed(2) : "0.00"} className="pl-8" invalid={!!fe.priceUsd} />
          </div>
        </Field>
        <Field label="Passing score (%)" htmlFor="passingScore" error={fe.passingScore}>
          <Input id="passingScore" name="passingScore" type="number" min={1} max={100} defaultValue={course?.passingScore ?? 70} invalid={!!fe.passingScore} />
        </Field>
        <div className="pt-7">
          <Checkbox name="requiresCoachReview" defaultChecked={course?.requiresCoachReview ?? false} label={<span>Coach review required before certification<span className="block text-[12px] text-ink-400">You assess each student after they pass the exam.</span></span>} />
        </div>
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Course saved.</FormAlert>}
      <SubmitButton pendingText="Saving…">{course ? "Save changes" : "Create course"}</SubmitButton>
    </form>
  );
}
