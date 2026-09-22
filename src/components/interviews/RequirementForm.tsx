"use client";

import { useActionState } from "react";
import { createRequirementAction } from "@/app/(app)/actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Select, Textarea, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";
import { AGENT_ROLES, EXPERIENCE_LEVELS, INDUSTRIES, TIMEZONES } from "@/lib/options";

type Tax = { id: string; name: string };

export function RequirementForm({ skills, software, defaultTimezone }: { skills: Tax[]; software: Tax[]; defaultTimezone: string }) {
  const [state, action] = useActionState(createRequirementAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" htmlFor="title" error={fe.title} className="sm:col-span-2"><Input id="title" name="title" placeholder="e.g. Two solar appointment setters, US Pacific" required invalid={!!fe.title} /></Field>
        <Field label="Role" htmlFor="role" error={fe.role}>
          <Select id="role" name="role" defaultValue="" required invalid={!!fe.role}><option value="" disabled>Select…</option>{AGENT_ROLES.map((r) => <option key={r}>{r}</option>)}</Select>
        </Field>
        <Field label="Agents required" htmlFor="agentsRequired" error={fe.agentsRequired}><Input id="agentsRequired" name="agentsRequired" type="number" min={1} defaultValue={1} /></Field>
        <Field label="Industry" htmlFor="industry" error={fe.industry}><Select id="industry" name="industry" defaultValue=""><option value="">Any</option>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</Select></Field>
        <Field label="Experience level" htmlFor="experienceLevel" error={fe.experienceLevel}><Select id="experienceLevel" name="experienceLevel" defaultValue=""><option value="">Any</option>{EXPERIENCE_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</Select></Field>
        <Field label="Schedule" htmlFor="schedule" error={fe.schedule}><Input id="schedule" name="schedule" placeholder="Mon–Fri 9–5" /></Field>
        <Field label="Timezone" htmlFor="timezone" error={fe.timezone}><Select id="timezone" name="timezone" defaultValue={defaultTimezone}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <Field label="Start date" htmlFor="startDate" error={fe.startDate}><Input id="startDate" name="startDate" type="date" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Budget min (USD/hr)" htmlFor="budgetMin" error={fe.budgetMin} hint="Optional"><Input id="budgetMin" name="budgetMin" type="number" step="0.5" min={0} /></Field>
          <Field label="Budget max (USD/hr)" htmlFor="budgetMax" error={fe.budgetMax} hint="Optional"><Input id="budgetMax" name="budgetMax" type="number" step="0.5" min={0} /></Field>
        </div>
      </div>
      <Field label="Job description" htmlFor="jobDescription" error={fe.jobDescription}><Textarea id="jobDescription" name="jobDescription" rows={5} /></Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-[13.5px] font-semibold text-ink-800">Skills</p>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-ink-100 p-3">{skills.map((s) => <Checkbox key={s.id} name="skills" value={s.name} label={s.name} />)}</div>
        </div>
        <div>
          <p className="mb-2 text-[13.5px] font-semibold text-ink-800">Software</p>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-ink-100 p-3">{software.map((s) => <Checkbox key={s.id} name="software" value={s.name} label={s.name} />)}</div>
        </div>
      </div>
      <Field label="Other requirements" htmlFor="otherRequirements" error={fe.otherRequirements}><Textarea id="otherRequirements" name="otherRequirements" rows={3} /></Field>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton pendingText="Saving…">Save requirement</SubmitButton>
    </form>
  );
}
