"use client";

import { useActionState, useState } from "react";
import { requestWorkflowAction, clientDecisionAction, completeInterviewAction } from "@/app/(app)/actions";
import { idle } from "@/server/http/action-result";
import { Textarea, Input, SubmitButton, FormAlert, Select } from "@/components/ui/Form";
import { cn } from "@/lib/cn";

/** One-button workflow step (start review, client confirm, candidate confirm/decline, cancel, notes). */
export function WorkflowButton({ requestId, op, label, variant = "dark", withMessage, withReason, defaultText }: { requestId: string; op: string; label: string; variant?: "dark" | "primary" | "outline" | "danger"; withMessage?: string; withReason?: boolean; defaultText?: string }) {
  const [state, action] = useActionState(requestWorkflowAction, idle);
  return (
    <form action={action} className="space-y-2.5">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="op" value={op} />
      {withMessage && <Textarea name={op === "SALES_NOTES" ? "salesNotes" : "message"} rows={3} placeholder={withMessage} defaultValue={defaultText} required={op === "PROPOSE"} className="min-h-0 text-[13.5px]" />}
      {withReason && <Input name="reason" placeholder="Reason (required)" required />}
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && op === "SALES_NOTES" && <FormAlert tone="success">Saved.</FormAlert>}
      <SubmitButton variant={variant} pendingText="Working…" className="h-10 text-[13.5px]">{label}</SubmitButton>
    </form>
  );
}

export function CandidateRespond({ requestId }: { requestId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <WorkflowButton requestId={requestId} op="CANDIDATE_CONFIRM" label="I am available" variant="primary" />
      <WorkflowButton requestId={requestId} op="CANDIDATE_DECLINE" label="Decline" variant="outline" />
    </div>
  );
}

export function DecisionForm({ requestId, interviewId, displayName }: { requestId: string; interviewId: string; displayName: string }) {
  const [state, action] = useActionState(clientDecisionAction, idle);
  const [decision, setDecision] = useState("SELECTED");
  const options = [
    { v: "SELECTED", label: "Select", help: `Hire ${displayName}. Hirewise will confirm terms and prepare deployment.`, variant: "primary" as const },
    { v: "SECOND_INTERVIEW", label: "Second interview", help: "Hirewise proposes new times.", variant: "dark" as const },
    { v: "INTERESTED", label: "Interested", help: "Keep in consideration without deciding yet.", variant: "outline" as const },
    { v: "NOT_SELECTED", label: "Not selected", help: "The candidate is notified politely; your feedback stays with Hirewise.", variant: "danger" as const },
  ];
  const cur = options.find((o) => o.v === decision)!;
  if (state.ok) return <FormAlert tone="success">Decision recorded.</FormAlert>;
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="interviewId" value={interviewId} />
      <input type="hidden" name="decision" value={decision} />
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o.v} type="button" onClick={() => setDecision(o.v)} className={cn("rounded-full px-3 py-1.5 text-[12.5px] font-semibold", decision === o.v ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200")}>{o.label}</button>
        ))}
      </div>
      <p className="text-[13px] text-ink-500">{cur.help}</p>
      <Textarea name="feedback" rows={2} placeholder="Feedback for Hirewise (optional)" className="min-h-0 text-[13.5px]" />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant={cur.variant} pendingText="Saving…" className="h-10 text-[13.5px]">{cur.label}</SubmitButton>
    </form>
  );
}

export function CompleteInterviewForm({ requestId, interviewId }: { requestId: string; interviewId: string }) {
  const [state, action] = useActionState(completeInterviewAction, idle);
  if (state.ok) return <FormAlert tone="success">Outcome recorded.</FormAlert>;
  return (
    <form action={action} className="space-y-2.5" noValidate>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="interviewId" value={interviewId} />
      <Select name="status" defaultValue="COMPLETED" className="h-9 text-[13px]" aria-label="Outcome">
        <option value="COMPLETED">Took place</option>
        <option value="NO_SHOW_CLIENT">Client no-show</option>
        <option value="NO_SHOW_AGENT">Candidate no-show</option>
        <option value="CANCELLED">Cancelled</option>
      </Select>
      <Textarea name="internalFeedback" rows={2} placeholder="Internal notes (never shown to client or candidate)" className="min-h-0 text-[13px]" />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant="outline" pendingText="Saving…" className="h-9 text-[13px]">Record outcome</SubmitButton>
    </form>
  );
}
