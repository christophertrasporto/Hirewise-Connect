"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { registerAgentQuickAction } from "@/app/(auth)/actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, SubmitButton, FormAlert } from "@/components/ui/Form";
import { TermsCheckbox, type TermsBundleProp } from "@/components/terms/TermsDrawer";

/**
 * The short sign-up for someone who came to buy a course: name, email, password, terms. Everything else about the
 * profile is asked later, from the profile page. After email verification the dashboard sends them back to checkout.
 */
export function AgentQuickRegisterForm({ terms }: { terms: TermsBundleProp }) {
  const [state, action] = useActionState(registerAgentQuickAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <div className="w-full max-w-[460px]">
      <h1 className="text-[2rem] font-bold leading-tight">Create your account to continue</h1>
      <p className="mt-2 text-[15px] text-ink-500">Just your name, email and a password. You go straight back to check out, and you can finish your profile any time.</p>

      <form action={action} className="mt-8 space-y-5" noValidate>
        <Field label="Full name" htmlFor="fullName" error={fe.fullName} hint="Private. Clients see only your first name and last initial.">
          <Input id="fullName" name="fullName" autoComplete="name" required invalid={!!fe.fullName} />
        </Field>
        <Field label="Email" htmlFor="email" error={fe.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required invalid={!!fe.email} />
        </Field>
        <Field label="Password" htmlFor="password" error={fe.password} hint="At least 10 characters, mixing lower case with upper case or digits.">
          <Input id="password" name="password" type="password" autoComplete="new-password" required invalid={!!fe.password} />
        </Field>
        <TermsCheckbox bundle={terms} error={fe.termsAccepted} />
        {state.error && !fe.termsAccepted && <FormAlert>{state.error}</FormAlert>}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] text-ink-400">Next: verify your email.</p>
          <SubmitButton pendingText="Creating account…">
            Create account <ArrowRight className="h-4 w-4" />
          </SubmitButton>
        </div>
      </form>

      <p className="mt-6 text-[13.5px] text-ink-500">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-brand-700 hover:text-brand-800">
          Log in
        </Link>
        . Want a full talent profile first?{" "}
        <Link href="/register/talent" className="font-semibold text-brand-700 hover:text-brand-800">
          Apply as talent
        </Link>
        .
      </p>
    </div>
  );
}
