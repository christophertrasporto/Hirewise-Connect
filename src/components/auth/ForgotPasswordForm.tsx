"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft } from "lucide-react";
import { forgotPasswordAction } from "@/app/(auth)/actions";
import { idle, type ActionResult } from "@/server/http/action-result";
import { Field, Input, SubmitButton, FormAlert, DevLink } from "@/components/ui/Form";

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPasswordAction, idle as ActionResult<{ devUrl?: string }>);
  return (
    <div className="w-full max-w-[420px]">
      <Link href="/login" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Back to login
      </Link>
      <h1 className="mt-6 text-[2rem] font-bold leading-tight">Reset your password</h1>
      <p className="mt-2 text-[15px] text-ink-500">Enter your email and we will send a reset link if an account exists.</p>
      <form action={action} className="mt-6 space-y-4" noValidate>
        <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
          <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
        </Field>
        {state.ok ? <FormAlert tone="success">If an account exists, a reset link is on its way. It expires in 1 hour.</FormAlert> : state.error && <FormAlert>{state.error}</FormAlert>}
        <DevLink url={state.data?.devUrl} label="reset link:" />
        <SubmitButton pendingText="Sending…" className="w-full">
          Send reset link
        </SubmitButton>
      </form>
    </div>
  );
}
