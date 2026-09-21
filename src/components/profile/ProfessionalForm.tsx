"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { saveProfessionalAction } from "@/app/(app)/actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Select, Textarea, SubmitButton, FormAlert } from "@/components/ui/Form";
import { Card } from "@/components/app/ui";
import { AGENT_ROLES, EXPERIENCE_LEVELS, INDUSTRIES } from "@/lib/options";

type Initial = { headline: string; primaryRole: string; summary: string; yearsExperience: number; experienceLevel: string; industries: Array<{ industry: string; years: number }> };

export function ProfessionalForm({ initial }: { initial: Initial }) {
  const [state, action] = useActionState(saveProfessionalAction, idle);
  const [industries, setIndustries] = useState(initial.industries.length ? initial.industries : [{ industry: "", years: 0 }]);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <Card title="Headline and summary">
        <div className="grid gap-4">
          <Field label="Headline" htmlFor="headline" error={fe.headline} hint="e.g. “Cold calling and appointment setting specialist, 4 years in US real estate”"><Input id="headline" name="headline" defaultValue={initial.headline} maxLength={120} required invalid={!!fe.headline} /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Primary role" htmlFor="primaryRole" error={fe.primaryRole}>
              <Select id="primaryRole" name="primaryRole" defaultValue={initial.primaryRole}>{AGENT_ROLES.map((r) => <option key={r}>{r}</option>)}</Select>
            </Field>
            <Field label="Years of experience" htmlFor="yearsExperience" error={fe.yearsExperience}><Input id="yearsExperience" name="yearsExperience" type="number" min={0} max={50} defaultValue={initial.yearsExperience} /></Field>
            <Field label="Level" htmlFor="experienceLevel" error={fe.experienceLevel}>
              <Select id="experienceLevel" name="experienceLevel" defaultValue={initial.experienceLevel}>{EXPERIENCE_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</Select>
            </Field>
          </div>
          <Field label="Professional summary" htmlFor="summary" error={fe.summary} hint="At least 80 characters. Campaigns you have run, tools you use, results you are proud of."><Textarea id="summary" name="summary" defaultValue={initial.summary} rows={6} required invalid={!!fe.summary} /></Field>
        </div>
      </Card>

      <Card title="Industry experience" description="Industries you have worked in and for how long.">
        <div className="space-y-3">
          {industries.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_40px] items-end gap-3">
              <Field label={i === 0 ? "Industry" : ""} htmlFor={`industry-${i}`}>
                <Select id={`industry-${i}`} name="industry" value={row.industry} onChange={(e) => setIndustries((r) => r.map((x, j) => (j === i ? { ...x, industry: e.target.value } : x)))}>
                  <option value="">Select…</option>
                  {INDUSTRIES.map((ind) => <option key={ind}>{ind}</option>)}
                </Select>
              </Field>
              <Field label={i === 0 ? "Years" : ""} htmlFor={`years-${i}`}>
                <Input id={`years-${i}`} name="industryYears" type="number" min={0} max={50} value={row.years} onChange={(e) => setIndustries((r) => r.map((x, j) => (j === i ? { ...x, years: Number(e.target.value) } : x)))} />
              </Field>
              <button type="button" aria-label="Remove industry" onClick={() => setIndustries((r) => r.filter((_, j) => j !== i))} className="mb-0.5 inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-red-600">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setIndustries((r) => [...r, { industry: "", years: 0 }])} className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-brand-600 hover:text-brand-700">
            <Plus className="h-4 w-4" /> Add industry
          </button>
        </div>
      </Card>

      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Saved.</FormAlert>}
      <SubmitButton pendingText="Saving…">Save professional information</SubmitButton>
    </form>
  );
}
