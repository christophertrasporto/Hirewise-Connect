"use client";

import { useActionState, useEffect, useState } from "react";
import { beginMfaAction, completeMfaAction } from "@/app/(gate)/actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, SubmitButton, FormAlert } from "@/components/ui/Form";

export function MfaSetup() {
  const [enrol, setEnrol] = useState<{ secretBase32: string; qrDataUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, action] = useActionState(completeMfaAction, idle);

  useEffect(() => {
    beginMfaAction().then((r) => (r.ok && r.data ? setEnrol(r.data) : setError(r.error ?? "Could not start setup.")));
  }, []);

  return (
    <div className="mt-6">
      {error && <FormAlert>{error}</FormAlert>}
      {enrol && (
        <div className="grid gap-6 sm:grid-cols-[200px_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrol.qrDataUrl} alt="Authenticator QR code" width={200} height={200} className="rounded-2xl border border-ink-100" />
          <div>
            <p className="text-[13px] font-semibold text-ink-800">Can&apos;t scan? Enter this key manually:</p>
            <code className="mt-1 block rounded-xl bg-ink-50 px-3 py-2 text-[13px] break-all text-ink-700">{enrol.secretBase32}</code>
            <form action={action} className="mt-5 space-y-4" noValidate>
              <Field label="Six-digit code" htmlFor="code" error={state.fieldErrors?.code}>
                <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} placeholder="123 456" required className="tracking-[0.3em]" />
              </Field>
              {state.error && <FormAlert>{state.error}</FormAlert>}
              <SubmitButton pendingText="Verifying…">Enable two-factor</SubmitButton>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
