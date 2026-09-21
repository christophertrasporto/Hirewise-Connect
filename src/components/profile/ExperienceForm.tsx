"use client";

import { useActionState, useEffect, useRef } from "react";
import { addExperienceAction } from "@/app/(app)/actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Select, Textarea, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";
import { INDUSTRIES } from "@/lib/options";

export function ExperienceForm() {
  const [state, action] = useActionState(addExperienceAction, idle);
  const ref = useRef<HTMLFormElement>(null);
  const fe = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Job title" htmlFor="title" error={fe.title}><Input id="title" name="title" required invalid={!!fe.title} /></Field>
        <Field label="Company" htmlFor="company" error={fe.company} hint="Optional. You may leave it blank for confidential campaigns."><Input id="company" name="company" /></Field>
        <Field label="Industry" htmlFor="industry" error={fe.industry}>
          <Select id="industry" name="industry" defaultValue="">
            <option value="">Select…</option>
            {INDUSTRIES.map((i) => <option key={i}>{i}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start" htmlFor="startDate" error={fe.startDate}><Input id="startDate" name="startDate" type="date" required invalid={!!fe.startDate} /></Field>
          <Field label="End" htmlFor="endDate" error={fe.endDate} hint="Blank = present"><Input id="endDate" name="endDate" type="date" /></Field>
        </div>
      </div>
      <Field label="What you did" htmlFor="description" error={fe.description}><Textarea id="description" name="description" rows={4} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Checkbox name="isCampaign" label="This was campaign work (cold calling, appointment setting, support queue)" className="mt-1" />
        <Field label="Campaign type" htmlFor="campaignType" error={fe.campaignType}><Input id="campaignType" name="campaignType" placeholder="e.g. Solar appointment setting" /></Field>
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Added.</FormAlert>}
      <SubmitButton pendingText="Adding…">Add experience</SubmitButton>
    </form>
  );
}
