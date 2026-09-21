"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { registerClientAction } from "@/app/(auth)/actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Select, Textarea, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";
import { COUNTRIES, INDUSTRIES, SERVICES, TIMEZONES } from "@/lib/options";

export function ClientRegisterForm() {
  const [state, action] = useActionState(registerClientAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <div className="w-full max-w-[640px]">
      <Link href="/register" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Choose a different account type
      </Link>
      <h1 className="mt-6 text-[2rem] font-bold leading-tight">Create a client account</h1>
      <p className="mt-2 text-[15px] text-ink-500">Tell us about your company and what you need. Hirewise reviews every client before the marketplace opens.</p>

      <form action={action} className="mt-8 space-y-8" noValidate>
        <section className="space-y-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-400">Company</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company name" htmlFor="companyName" error={fe.companyName}><Input id="companyName" name="companyName" required invalid={!!fe.companyName} /></Field>
            <Field label="Industry" htmlFor="industry" error={fe.industry}>
              <Select id="industry" name="industry" defaultValue="" required invalid={!!fe.industry}>
                <option value="" disabled>Select…</option>
                {INDUSTRIES.map((i) => <option key={i}>{i}</option>)}
              </Select>
            </Field>
            <Field label="Website" htmlFor="website" error={fe.website} hint="Optional"><Input id="website" name="website" type="url" placeholder="https://" invalid={!!fe.website} /></Field>
            <Field label="Country" htmlFor="country" error={fe.country}>
              <Select id="country" name="country" defaultValue="" required invalid={!!fe.country}>
                <option value="" disabled>Select…</option>
                {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Timezone" htmlFor="timezone" error={fe.timezone} className="sm:col-span-2">
              <Select id="timezone" name="timezone" defaultValue="" required invalid={!!fe.timezone}>
                <option value="" disabled>Select…</option>
                {TIMEZONES.map((t) => <option key={t}>{t}</option>)}
              </Select>
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-400">Contact person</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="contactName" error={fe.contactName}><Input id="contactName" name="contactName" autoComplete="name" required invalid={!!fe.contactName} /></Field>
            <Field label="Position" htmlFor="position" error={fe.position}><Input id="position" name="position" autoComplete="organization-title" required invalid={!!fe.position} /></Field>
            <Field label="Business email" htmlFor="email" error={fe.email} hint="Free-mail addresses (Gmail, Yahoo) are not accepted for client accounts."><Input id="email" name="email" type="email" autoComplete="email" required invalid={!!fe.email} /></Field>
            <Field label="Phone" htmlFor="phone" error={fe.phone} hint="Optional. Never shown to talent."><Input id="phone" name="phone" type="tel" autoComplete="tel" invalid={!!fe.phone} /></Field>
            <Field label="Password" htmlFor="password" error={fe.password} hint="At least 10 characters, mixing lower case with upper case or digits." className="sm:col-span-2"><Input id="password" name="password" type="password" autoComplete="new-password" required invalid={!!fe.password} /></Field>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-400">What you need</h2>
          <div>
            <p className="mb-2 text-[13.5px] font-semibold text-ink-800">Services needed</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {SERVICES.map((s) => <Checkbox key={s} name="servicesNeeded" value={s} label={s} />)}
            </div>
            {fe.servicesNeeded && <p className="mt-1.5 text-[12.5px] font-medium text-red-600">{fe.servicesNeeded}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Agents required" htmlFor="agentsRequired" error={fe.agentsRequired}><Input id="agentsRequired" name="agentsRequired" type="number" min={1} defaultValue={1} required invalid={!!fe.agentsRequired} /></Field>
            <Field label="Preferred schedule" htmlFor="preferredSchedule" error={fe.preferredSchedule}><Input id="preferredSchedule" name="preferredSchedule" placeholder="e.g. Mon–Fri 9–5 PST" /></Field>
            <Field label="Expected start date" htmlFor="expectedStartDate" error={fe.expectedStartDate}><Input id="expectedStartDate" name="expectedStartDate" type="date" /></Field>
          </div>
          <Field label="Notes" htmlFor="notes" error={fe.notes} hint="Optional. Campaign details, tools, anything that helps us match you."><Textarea id="notes" name="notes" /></Field>
        </section>

        {state.error && <FormAlert>{state.error}</FormAlert>}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] text-ink-400">Next: verify your email, then review and accept the client agreements.</p>
          <SubmitButton pendingText="Creating account…">Create account <ArrowRight className="h-4 w-4" /></SubmitButton>
        </div>
      </form>
    </div>
  );
}
