"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { registerApplicantAction } from "@/app/(auth)/actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, SubmitButton, FormAlert } from "@/components/ui/Form";
import { TermsCheckbox, type TermsBundleProp } from "@/components/terms/TermsDrawer";


/** Account for someone who wants to run a partner agency. Approval, not sign-up, is what creates the agency. */
export function ApplicantRegisterForm({ terms, continuation }: { terms: TermsBundleProp; continuation?: { token: string; email: string } | null }) {
  const [state, action] = useActionState(registerApplicantAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <div className="w-full max-w-[560px]">
      <Link href="/register" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Choose a different account type
      </Link>
      <h1 className="mt-6 text-[2rem] font-bold leading-tight">Apply to run an agency</h1>
      <p className="mt-2 text-[15px] text-ink-500">Create an account, verify your email, then submit your agency application. Hirewise reviews every application; your agency portal opens only once it is approved.</p>

      <form action={action} className="mt-8 space-y-6" noValidate>
        <div className="grid gap-4">
          <Field label="Full name" htmlFor="fullName" error={fe.fullName}><Input id="fullName" name="fullName" autoComplete="name" required invalid={!!fe.fullName} /></Field>
          <Field label="Email" htmlFor="email" error={fe.email} hint="Already have a talent or client account? Sign in and open Apply for Agency from your dashboard instead."><Input id="email" name="email" type="email" autoComplete="email" required invalid={!!fe.email} defaultValue={continuation?.email ?? ""} readOnly={!!continuation} /></Field>
          <Field label="Password" htmlFor="password" error={fe.password} hint="At least 10 characters, mixing lower case with upper case or digits."><Input id="password" name="password" type="password" autoComplete="new-password" required invalid={!!fe.password} /></Field>
        </div>
        {continuation && <input type="hidden" name="continuationToken" value={continuation.token} />}
        <TermsCheckbox bundle={terms} error={fe.termsAccepted} />
        {state.error && !fe.termsAccepted && <FormAlert>{state.error}</FormAlert>}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] text-ink-400">Next: verify your email, then fill in the application.</p>
          <SubmitButton pendingText="Creating account…">Create account <ArrowRight className="h-4 w-4" /></SubmitButton>
        </div>
      </form>
    </div>
  );
}
