"use client";

import { useActionState } from "react";
import { updateCourseSettingsAction } from "@/app/(app)/academy-actions";
import { idle } from "@/server/http/action-result";
import { Checkbox, Field, FormAlert, Input, Select, SubmitButton } from "@/components/ui/Form";

export type CourseSettingsValues = {
  courseId: string;
  isRequired: boolean;
  sequentialUnlock: boolean;
  completionRequiresQuizPass: boolean;
  completionRequiresFinalAssessment: boolean;
  displayOrder: number;
  prerequisiteIds: string[];
  minVerificationLevel: string;
};

/** Settings tab: how learners move through and complete the course. Every rule is creator-controlled. */
export function CourseSettingsForm({ values, otherCourses }: { values: CourseSettingsValues; otherCourses: Array<{ id: string; title: string }> }) {
  const [state, action] = useActionState(updateCourseSettingsAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-6" noValidate>
      <input type="hidden" name="courseId" value={values.courseId} />

      <section>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Completion rules</p>
        <p className="mb-3 text-[13.5px] text-ink-500">Every required lesson must always be completed. Add the rules below on top.</p>
        <div className="space-y-3">
          <Checkbox name="completionRequiresQuizPass" defaultChecked={values.completionRequiresQuizPass} label={<span><span className="font-semibold">Pass every required quiz</span> <span className="text-ink-500">(including audiobook quizzes)</span></span>} />
          <Checkbox name="completionRequiresFinalAssessment" defaultChecked={values.completionRequiresFinalAssessment} label={<span><span className="font-semibold">Pass the final assessment</span> <span className="text-ink-500">(the last assessment lesson in the course)</span></span>} />
        </div>
      </section>

      <section>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Order and access</p>
        <div className="space-y-3">
          <Checkbox name="sequentialUnlock" defaultChecked={values.sequentialUnlock} label={<span><span className="font-semibold">Sequential unlock</span> <span className="text-ink-500">Module 1 before Module 2; an audiobook needs its audio and quiz done before the next lesson opens.</span></span>} />
          <Checkbox name="isRequired" defaultChecked={values.isRequired} label={<span><span className="font-semibold">Required course</span> <span className="text-ink-500">Shown first in the catalog and counted in talent onboarding.</span></span>} />
        </div>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Field label="Display order" htmlFor="displayOrder" error={fe.displayOrder} hint="Lower numbers come first in the catalog.">
            <Input id="displayOrder" name="displayOrder" type="number" min={0} defaultValue={values.displayOrder} invalid={!!fe.displayOrder} />
          </Field>
          <Field label="Minimum verification level to enrol" htmlFor="minVerificationLevel" error={fe.minVerificationLevel}>
            <Select id="minVerificationLevel" name="minVerificationLevel" defaultValue={values.minVerificationLevel}>
              <option value="">Any talent</option>
              <option value="BASIC">Basic</option>
              <option value="VERIFIED">Verified</option>
              <option value="CERTIFIED">Certified</option>
              <option value="ELITE">Elite</option>
            </Select>
          </Field>
        </div>
      </section>

      <section>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Prerequisites</p>
        {otherCourses.length === 0 ? <p className="text-[13.5px] text-ink-400">No other courses yet.</p> : (
          <div className="grid gap-2 sm:grid-cols-2">
            {otherCourses.map((c) => <Checkbox key={c.id} name="prerequisiteIds" value={c.id} defaultChecked={values.prerequisiteIds.includes(c.id)} label={c.title} />)}
          </div>
        )}
        <p className="mt-2 text-[12.5px] text-ink-400">Learners must complete the ticked courses before enrolling in this one.</p>
      </section>

      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Settings saved.</FormAlert>}
      <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
    </form>
  );
}
