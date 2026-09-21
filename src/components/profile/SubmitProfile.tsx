"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";
import { submitProfileAction } from "@/app/(app)/actions";
import { idle } from "@/server/http/action-result";
import { SubmitButton, FormAlert } from "@/components/ui/Form";

export function SubmitProfile({ ready, blockers }: { ready: boolean; blockers: string[] }) {
  const [state, action] = useActionState(submitProfileAction, idle);
  return (
    <form action={action} className="mt-5 space-y-4">
      {!ready && (
        <FormAlert tone="info">
          Before you can submit: {blockers.join(", ")}.
        </FormAlert>
      )}
      {state.ok && <FormAlert tone="success">Submitted. Hirewise will review your profile and notify you.</FormAlert>}
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant="primary" disabled={!ready || state.ok} pendingText="Submitting…">
        <Send className="h-4 w-4" /> Submit for review
      </SubmitButton>
    </form>
  );
}
