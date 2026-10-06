"use client";

import { useActionState, useEffect, useState } from "react";
import { resendVerificationAction } from "@/app/(gate)/actions";
import { idle, type ActionResult } from "@/server/http/action-result";
import { SubmitButton, FormAlert, DevLink } from "@/components/ui/Form";

type R = ActionResult<{ devUrl?: string; alreadyVerified?: boolean }>;

/**
 * Resend with a visible cooldown. The server enforces the limit; the countdown only mirrors it so the
 * button does not invite a click that will be refused.
 */
export function ResendVerification({ cooldownSeconds }: { cooldownSeconds: number }) {
  const [state, action] = useActionState(resendVerificationAction, idle as R);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (state.ok) setWait(cooldownSeconds);
    else if (state.retryAfterSeconds) setWait(state.retryAfterSeconds);
  }, [state, cooldownSeconds]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  return (
    <form action={action} className="mt-6 space-y-3">
      {state.ok && state.data?.alreadyVerified && <FormAlert tone="success">Your email is already verified. Reload the page to continue.</FormAlert>}
      {state.ok && !state.data?.alreadyVerified && <FormAlert tone="success">Verification email sent successfully. Please check your inbox and spam folder.</FormAlert>}
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <DevLink url={state.data?.devUrl} label="verification link:" />
      <SubmitButton variant="outline" pendingText="Sending…" disabled={wait > 0}>
        {wait > 0 ? `Resend available in ${wait}s` : "Resend verification email"}
      </SubmitButton>
    </form>
  );
}
