"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { registerAgentAction } from "@/app/(auth)/actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Select, SubmitButton, FormAlert } from "@/components/ui/Form";
import { AGENT_ROLES, COUNTRIES, TIMEZONES } from "@/lib/options";

export function AgentRegisterForm() {
  const [state, action] = useActionState(registerAgentAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <div className="w-full max-w-[600px]">
      <Link href="/register" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Choose a different account type
      </Link>
      <h1 className="mt-6 text-[2rem] font-bold leading-tight">Apply as talent</h1>
      <p className="mt-2 text-[15px] text-ink-500">Create your account first. You will complete your full profile, résumé, video, and voice sample from your dashboard.</p>

      <form action={action} className="mt-8 space-y-6" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full legal name" htmlFor="fullName" error={fe.fullName} hint="Private. Only Hirewise sees this."><Input id="fullName" name="fullName" autoComplete="name" required invalid={!!fe.fullName} /></Field>
          <Field label="Professional name" htmlFor="displayName" error={fe.displayName} hint="Shown to clients, e.g. “Maria S.”"><Input id="displayName" name="displayName" required invalid={!!fe.displayName} /></Field>
          <Field label="Email" htmlFor="email" error={fe.email}><Input id="email" name="email" type="email" autoComplete="email" required invalid={!!fe.email} /></Field>
          <Field label="Phone" htmlFor="phone" error={fe.phone} hint="Optional. Never shown to clients."><Input id="phone" name="phone" type="tel" autoComplete="tel" invalid={!!fe.phone} /></Field>
          <Field label="Password" htmlFor="password" error={fe.password} hint="At least 10 characters, mixing lower case with upper case or digits." className="sm:col-span-2"><Input id="password" name="password" type="password" autoComplete="new-password" required invalid={!!fe.password} /></Field>
          <Field label="City" htmlFor="locationCity" error={fe.locationCity}><Input id="locationCity" name="locationCity" required invalid={!!fe.locationCity} /></Field>
          <Field label="Country" htmlFor="locationCountry" error={fe.locationCountry}>
            <Select id="locationCountry" name="locationCountry" defaultValue="Philippines" required invalid={!!fe.locationCountry}>
              {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Timezone" htmlFor="timezone" error={fe.timezone}>
            <Select id="timezone" name="timezone" defaultValue="Asia/Manila" required invalid={!!fe.timezone}>
              {TIMEZONES.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Primary role" htmlFor="primaryRole" error={fe.primaryRole}>
            <Select id="primaryRole" name="primaryRole" defaultValue="" required invalid={!!fe.primaryRole}>
              <option value="" disabled>Select…</option>
              {AGENT_ROLES.map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Years of experience" htmlFor="yearsExperience" error={fe.yearsExperience} className="sm:col-span-2"><Input id="yearsExperience" name="yearsExperience" type="number" min={0} max={50} defaultValue={1} required invalid={!!fe.yearsExperience} /></Field>
        </div>

        {state.error && <FormAlert>{state.error}</FormAlert>}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] text-ink-400">Next: verify your email, then accept the talent agreements.</p>
          <SubmitButton pendingText="Creating account…">Create account <ArrowRight className="h-4 w-4" /></SubmitButton>
        </div>
      </form>
    </div>
  );
}
