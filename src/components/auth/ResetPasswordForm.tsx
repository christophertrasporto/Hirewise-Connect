"use client";

import { useActionState } from "react";
import { resetPasswordAction } from "@/app/(auth)/actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, SubmitButton, FormAlert } from "@/components/ui/Form";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, idle);
  return (
    <div className="w-full max-w-[420px]">
      <h1 className="text-[2rem] font-bold leading-tight">Choose a new password</h1>
      <p className="mt-2 text-[15px] text-ink-500">At least 10 characters, mixing lower case with upper case or digits. All other sessions will be signed out.</p>
      <form action={action} className="mt-6 space-y-4" noValidate>
        <input type="hidden" name="token" value={token} />
        <Field label="New password" htmlFor="password" error={state.fieldErrors?.password}>
          <Input id="password" name="password" type="password" autoComplete="new-password" required invalid={!!state.fieldErrors?.password} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={state.fieldErrors?.confirm}>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required invalid={!!state.fieldErrors?.confirm} />
        </Field>
        {state.error && <FormAlert>{state.error}</FormAlert>}
        <SubmitButton pendingText="Saving…" className="w-full">
          Update password
        </SubmitButton>
      </form>
    </div>
  );
}
