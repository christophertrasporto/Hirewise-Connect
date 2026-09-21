"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { activateClientAction } from "@/app/(app)/actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, SubmitButton, FormAlert } from "@/components/ui/Form";

export function ActivateClientForm({ clientId }: { clientId: string }) {
  const [state, action] = useActionState(activateClientAction, idle);
  return (
    <form action={action} className="space-y-3 rounded-2xl bg-ink-50 p-4" noValidate>
      <input type="hidden" name="clientId" value={clientId} />
      <Field label="Qualification note" htmlFor={`reason-${clientId}`} hint="Optional, recorded in the audit log.">
        <Input id={`reason-${clientId}`} name="reason" placeholder="e.g. Verified website and requirement by phone" />
      </Field>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Activated.</FormAlert>}
      <SubmitButton variant="primary" pendingText="Activating…" className="w-full">
        <CheckCircle2 className="h-4 w-4" /> Activate client
      </SubmitButton>
    </form>
  );
}
