"use client";

import { useActionState, useState } from "react";
import { reviewAgentAction } from "@/app/(app)/actions";
import { idle } from "@/server/http/action-result";
import { Field, Textarea, SubmitButton, FormAlert } from "@/components/ui/Form";
import { labelFor } from "@/lib/options";

const COPY: Record<string, { label: string; variant: "dark" | "primary" | "outline" | "danger"; help: string }> = {
  UNDER_REVIEW: { label: "Start review", variant: "dark", help: "Marks the profile as being reviewed by you." },
  APPROVED: { label: "Approve profile", variant: "primary", help: "Makes the profile visible to clients and sets availability to Available." },
  REVISION_REQUIRED: { label: "Request changes", variant: "outline", help: "The agent is notified with your feedback and can resubmit." },
  REJECTED: { label: "Reject", variant: "danger", help: "The agent is notified. This is final unless an admin reinstates." },
  HIDDEN: { label: "Hide from marketplace", variant: "outline", help: "Keeps the profile approved but not searchable." },
  SUSPENDED: { label: "Suspend", variant: "danger", help: "Removes the profile from the marketplace pending investigation." },
};

export function ReviewActions({ agentProfileId, allowed }: { agentProfileId: string; allowed: Array<{ to: string; requiresReason: boolean }> }) {
  const [state, action] = useActionState(reviewAgentAction, idle);
  const [choice, setChoice] = useState(allowed[0]?.to ?? "");
  const current = allowed.find((a) => a.to === choice);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="agentProfileId" value={agentProfileId} />
      <input type="hidden" name="to" value={choice} />
      <div className="flex flex-wrap gap-1.5">
        {allowed.map((a) => (
          <button key={a.to} type="button" onClick={() => setChoice(a.to)} className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${choice === a.to ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200"}`}>
            {COPY[a.to]?.label ?? labelFor(a.to)}
          </button>
        ))}
      </div>
      {current && <p className="text-[13px] text-ink-500">{COPY[current.to]?.help}</p>}
      <Field label={current?.requiresReason ? "Reason / feedback (required)" : "Note (optional)"} htmlFor="reason" hint={current?.to === "REVISION_REQUIRED" ? "This text is sent to the agent." : "Recorded in the audit log."}>
        <Textarea id="reason" name="reason" rows={4} required={current?.requiresReason} />
      </Field>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {current && <SubmitButton variant={COPY[current.to]?.variant ?? "dark"} pendingText="Saving…" className="w-full">{COPY[current.to]?.label}</SubmitButton>}
    </form>
  );
}
