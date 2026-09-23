"use client";

import { useActionState } from "react";
import { proposeRateAction, decideRateAction, setCompensationAction } from "@/app/(app)/commercial-actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Select, Textarea, SubmitButton, FormAlert } from "@/components/ui/Form";

export function ProposeRateForm({ agentProfileId, canSeeNotes }: { agentProfileId: string; canSeeNotes: boolean }) {
  const [state, action] = useActionState(proposeRateAction, idle);
  const fe = state.fieldErrors ?? {};
  if (state.ok) return <FormAlert tone="success">Proposal sent to Admin for approval.</FormAlert>;
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="agentProfileId" value={agentProfileId} />
      <div className="grid grid-cols-[1fr_120px] gap-2">
        <Field label="Amount (USD)" htmlFor="rate-amount" error={fe.amountUsd}><Input id="rate-amount" name="amountUsd" inputMode="decimal" placeholder="9.00" className="h-10 text-[14px]" invalid={!!fe.amountUsd} /></Field>
        <Field label="Unit" htmlFor="rate-unit" error={fe.unit}><Select id="rate-unit" name="unit" defaultValue="HOURLY" className="h-10 text-[14px]"><option value="HOURLY">per hour</option><option value="MONTHLY">per month</option></Select></Field>
      </div>
      {canSeeNotes && <Field label="Positioning notes (internal)" htmlFor="rate-notes" error={fe.positioningNotes} hint="Admin only. Never shown to Sales, clients, or the agent."><Textarea id="rate-notes" name="positioningNotes" rows={2} className="min-h-[60px] text-[14px]" /></Field>}
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant="outline" pendingText="Sending…" className="h-9 text-[13px]">Propose client rate</SubmitButton>
    </form>
  );
}

export function RateDecision({ rateId, mode }: { rateId: string; mode: "PENDING" | "PUBLISHED" }) {
  const [state, action] = useActionState(decideRateAction, idle);
  if (state.ok) return <span className="text-[12.5px] font-semibold text-brand-700">Updated.</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {mode === "PENDING" && (
        <form action={action}>
          <input type="hidden" name="rateId" value={rateId} />
          <input type="hidden" name="op" value="PUBLISH" />
          <SubmitButton variant="primary" pendingText="…" className="h-8 px-3 text-[12.5px]">Publish</SubmitButton>
        </form>
      )}
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="rateId" value={rateId} />
        <input type="hidden" name="op" value={mode === "PENDING" ? "REJECT" : "RETIRE"} />
        <Input name="reason" placeholder="Reason" className="h-8 w-[160px] text-[12.5px]" required />
        <SubmitButton variant={mode === "PENDING" ? "danger" : "outline"} pendingText="…" className="h-8 px-3 text-[12.5px]">{mode === "PENDING" ? "Reject" : "Retire"}</SubmitButton>
      </form>
      {state.error && <span className="text-[12px] text-red-600">{state.error}</span>}
    </div>
  );
}

export function CompensationForm({ agentProfileId }: { agentProfileId: string }) {
  const [state, action] = useActionState(setCompensationAction, idle);
  const fe = state.fieldErrors ?? {};
  if (state.ok) return <FormAlert tone="success">Compensation recorded with a history row.</FormAlert>;
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="agentProfileId" value={agentProfileId} />
      <div className="grid grid-cols-[1fr_120px] gap-2">
        <Field label="Amount (USD)" htmlFor="comp-amount" error={fe.amountUsd}><Input id="comp-amount" name="amountUsd" inputMode="decimal" placeholder="5.00" className="h-10 text-[14px]" invalid={!!fe.amountUsd} /></Field>
        <Field label="Unit" htmlFor="comp-unit" error={fe.unit}><Select id="comp-unit" name="unit" defaultValue="HOURLY" className="h-10 text-[14px]"><option value="HOURLY">per hour</option><option value="MONTHLY">per month</option></Select></Field>
      </div>
      <Field label="Reason (audited)" htmlFor="comp-reason"><Input id="comp-reason" name="reason" className="h-10 text-[14px]" placeholder="e.g. Annual review" /></Field>
      <Field label="Notes (confidential)" htmlFor="comp-notes" error={fe.notes}><Textarea id="comp-notes" name="notes" rows={2} className="min-h-[60px] text-[14px]" /></Field>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant="outline" pendingText="Saving…" className="h-9 text-[13px]">Set compensation</SubmitButton>
    </form>
  );
}
