"use client";

import { useActionState, useState } from "react";
import { reviewMediaAction } from "@/app/(app)/actions";
import { idle } from "@/server/http/action-result";
import { Textarea, SubmitButton, FormAlert } from "@/components/ui/Form";
import { cn } from "@/lib/cn";

const OPTIONS = [
  { value: "APPROVED", label: "Approve", variant: "primary" as const, needsFeedback: false },
  { value: "REVISION_REQUIRED", label: "Request revision", variant: "outline" as const, needsFeedback: true },
  { value: "REJECTED", label: "Reject", variant: "danger" as const, needsFeedback: true },
];

export function MediaReviewForm({ type, id }: { type: "VIDEO" | "RECORDING"; id: string }) {
  const [state, action] = useActionState(reviewMediaAction, idle);
  const [decision, setDecision] = useState("APPROVED");
  const opt = OPTIONS.find((o) => o.value === decision)!;
  if (state.ok) return <FormAlert tone="success">Decision recorded. The agent has been notified.</FormAlert>;
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="decision" value={decision} />
      <div className="flex flex-wrap gap-1.5">
        {OPTIONS.map((o) => (
          <button key={o.value} type="button" onClick={() => setDecision(o.value)} className={cn("rounded-full px-3 py-1.5 text-[12.5px] font-semibold", decision === o.value ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200")}>{o.label}</button>
        ))}
      </div>
      <Textarea name="feedback" rows={2} placeholder={opt.needsFeedback ? "Feedback for the agent (required)" : "Optional note for the agent"} required={opt.needsFeedback} className="min-h-0 text-[13.5px]" />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant={opt.variant} pendingText="Saving…">{opt.label}</SubmitButton>
    </form>
  );
}
