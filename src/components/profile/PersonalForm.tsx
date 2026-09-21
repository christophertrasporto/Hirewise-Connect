"use client";

import { useActionState } from "react";
import { savePersonalAction } from "@/app/(app)/actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Select, Textarea, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";
import { Card } from "@/components/app/ui";
import { COUNTRIES, LANGUAGES, SHIFTS, TIMEZONES } from "@/lib/options";

type Initial = { displayName: string; fullLegalName: string; phone: string; addressLine: string; locationCity: string; locationCountry: string; timezone: string; languages: string[]; workSetup: string; preferredShift: string; equipmentSummary: string; internetSummary: string };

export function PersonalForm({ initial }: { initial: Initial }) {
  const [state, action] = useActionState(savePersonalAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <Card title="Identity">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Professional name (shown to clients)" htmlFor="displayName" error={fe.displayName}><Input id="displayName" name="displayName" defaultValue={initial.displayName} required invalid={!!fe.displayName} /></Field>
          <Field label="Full legal name (private)" htmlFor="fullLegalName" error={fe.fullLegalName}><Input id="fullLegalName" name="fullLegalName" defaultValue={initial.fullLegalName} required invalid={!!fe.fullLegalName} /></Field>
          <Field label="Phone (private)" htmlFor="phone" error={fe.phone}><Input id="phone" name="phone" type="tel" defaultValue={initial.phone} /></Field>
          <Field label="Address (private)" htmlFor="addressLine" error={fe.addressLine}><Input id="addressLine" name="addressLine" defaultValue={initial.addressLine} /></Field>
        </div>
      </Card>

      <Card title="Location and languages">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City" htmlFor="locationCity" error={fe.locationCity}><Input id="locationCity" name="locationCity" defaultValue={initial.locationCity} required invalid={!!fe.locationCity} /></Field>
          <Field label="Country" htmlFor="locationCountry" error={fe.locationCountry}>
            <Select id="locationCountry" name="locationCountry" defaultValue={initial.locationCountry}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
          <Field label="Timezone" htmlFor="timezone" error={fe.timezone}>
            <Select id="timezone" name="timezone" defaultValue={initial.timezone}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select>
          </Field>
        </div>
        <div className="mt-4">
          <p className="mb-2 text-[13.5px] font-semibold text-ink-800">Languages</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {LANGUAGES.map((l) => <Checkbox key={l} name="languages" value={l} defaultChecked={initial.languages.includes(l)} label={l} />)}
          </div>
          {fe.languages && <p className="mt-1.5 text-[12.5px] font-medium text-red-600">{fe.languages}</p>}
        </div>
      </Card>

      <Card title="Work setup">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Setup" htmlFor="workSetup" error={fe.workSetup}>
            <Select id="workSetup" name="workSetup" defaultValue={initial.workSetup}>
              <option value="REMOTE">Remote (work from home)</option>
              <option value="OFFICE">Office-based</option>
              <option value="HYBRID">Hybrid</option>
            </Select>
          </Field>
          <Field label="Preferred shift" htmlFor="preferredShift" error={fe.preferredShift}>
            <Select id="preferredShift" name="preferredShift" defaultValue={initial.preferredShift}>
              <option value="">Select…</option>
              {SHIFTS.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Equipment" htmlFor="equipmentSummary" error={fe.equipmentSummary} hint="Computer specs, headset, backup power."><Textarea id="equipmentSummary" name="equipmentSummary" defaultValue={initial.equipmentSummary} /></Field>
          <Field label="Internet" htmlFor="internetSummary" error={fe.internetSummary} hint="Provider, speed, backup connection."><Textarea id="internetSummary" name="internetSummary" defaultValue={initial.internetSummary} /></Field>
        </div>
      </Card>

      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Saved.</FormAlert>}
      <SubmitButton pendingText="Saving…">Save personal information</SubmitButton>
    </form>
  );
}
