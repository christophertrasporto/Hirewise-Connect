"use client";

import { useActionState } from "react";
import { resendVerificationAction } from "@/app/(gate)/actions";
import { idle, type ActionResult } from "@/server/http/action-result";
import { SubmitButton, FormAlert, DevLink } from "@/components/ui/Form";

export function ResendVerification() {
  const [state, action] = useActionState(resendVerificationAction, idle as ActionResult<{ devUrl?: string }>);
  return (
    <form action={action} className="mt-6 space-y-3">
      {state.ok && <FormAlert tone="success">A new link is on its way.</FormAlert>}
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <DevLink url={state.data?.devUrl} label="verification link:" />
      <SubmitButton variant="outline" pendingText="Sending…">Resend verification email</SubmitButton>
    </form>
  );
}
