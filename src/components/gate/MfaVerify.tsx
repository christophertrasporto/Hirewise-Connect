"use client";

import { useActionState } from "react";
import { verifyMfaAction } from "@/app/(gate)/actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, SubmitButton, FormAlert } from "@/components/ui/Form";

export function MfaVerify() {
  const [state, action] = useActionState(verifyMfaAction, idle);
  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      <Field label="Six-digit code" htmlFor="code">
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} placeholder="123 456" required autoFocus className="tracking-[0.3em]" />
      </Field>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton pendingText="Checking…" className="w-full">Continue</SubmitButton>
    </form>
  );
}
