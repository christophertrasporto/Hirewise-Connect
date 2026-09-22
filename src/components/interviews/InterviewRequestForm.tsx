"use client";

import { useActionState } from "react";
import { CalendarPlus } from "lucide-react";
import { createInterviewRequestAction } from "@/app/(app)/actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Select, Textarea, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";
import { AGENT_ROLES, TIMEZONES } from "@/lib/options";

type Candidate = { id: string; displayName: string; primaryRole: string | null };
type Requirement = { id: string; title: string; role: string };

export function InterviewRequestForm({ candidates, preselected, requirements, defaultTimezone }: { candidates: Candidate[]; preselected: string[]; requirements: Requirement[]; defaultTimezone: string }) {
  const [state, action] = useActionState(createInterviewRequestAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-6" noValidate>
      <div className="rounded-3xl border border-ink-100 bg-white p-6 shadow-soft">
        <h2 className="text-[16px] font-bold text-ink-900">Candidates from your shortlist</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {candidates.map((c) => <Checkbox key={c.id} name="candidateIds" value={c.id} defaultChecked={preselected.includes(c.id)} label={<span><span className="font-semibold">{c.displayName}</span> <span className="text-ink-400">· {c.primaryRole ?? "Talent"}</span></span>} />)}
        </div>
        {fe.candidateIds && <p className="mt-2 text-[12.5px] font-medium text-red-600">{fe.candidateIds}</p>}
      </div>

      <div className="rounded-3xl border border-ink-100 bg-white p-6 shadow-soft">
        <h2 className="text-[16px] font-bold text-ink-900">Job requirement</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Role" htmlFor="role" error={fe.role}>
            <Select id="role" name="role" defaultValue={requirements[0]?.role ?? ""} required invalid={!!fe.role}>
              <option value="" disabled>Select…</option>
              {AGENT_ROLES.map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Link to a saved requirement" htmlFor="requirementId" hint="Optional">
            <Select id="requirementId" name="requirementId" defaultValue="">
              <option value="">None</option>
              {requirements.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </Select>
          </Field>
          <Field label="Schedule" htmlFor="schedule" error={fe.schedule}><Input id="schedule" name="schedule" placeholder="e.g. Mon–Fri 9–5 PST" /></Field>
          <Field label="Target start date" htmlFor="targetStartDate" error={fe.targetStartDate}><Input id="targetStartDate" name="targetStartDate" type="date" /></Field>
        </div>
      </div>

      <div className="rounded-3xl border border-ink-100 bg-white p-6 shadow-soft">
        <h2 className="text-[16px] font-bold text-ink-900">Preferred interview time</h2>
        <p className="mt-1 text-[13.5px] text-ink-500">Your Hirewise account manager confirms with you and the candidates, then schedules.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Preferred date" htmlFor="preferredDate" error={fe.preferredDate}><Input id="preferredDate" name="preferredDate" type="date" /></Field>
          <Field label="Preferred time" htmlFor="preferredTime" error={fe.preferredTime}><Input id="preferredTime" name="preferredTime" placeholder="e.g. 9:00–11:00 AM" /></Field>
          <Field label="Timezone" htmlFor="timezone" error={fe.timezone}>
            <Select id="timezone" name="timezone" defaultValue={defaultTimezone}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select>
          </Field>
        </div>
        <Field label="Interview notes" htmlFor="notes" error={fe.notes} hint="What you want to cover. Shared with Hirewise, not directly with candidates." className="mt-4"><Textarea id="notes" name="notes" rows={3} /></Field>
      </div>

      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant="primary" size-="lg" pendingText="Sending request…"><CalendarPlus className="h-4 w-4" /> Request interviews</SubmitButton>
    </form>
  );
}
