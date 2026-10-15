"use client";

import { useActionState, useState } from "react";
import { requestRemovalAction, agencyExitDecisionAction, adminExitDecisionAction } from "@/app/(app)/exit-actions";
import { idle } from "@/server/http/action-result";
import { Field, FormAlert, Input, Select, SubmitButton, Textarea } from "@/components/ui/Form";
import type { ExitRequestView } from "@/server/views/exit.views";

const OPTION_LABEL: Record<string, string> = { IMMEDIATE: "Immediate", END_OF_ASSIGNMENT: "End of client assignment", END_OF_BILLING_PERIOD: "End of billing period" };

function fmt(d: Date | string | null | undefined) {
  return d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "";
}

/** Owner: Remove Agent with a reason and an effective option. Hirewise reviews it when the agent has an active assignment. */
export function RemoveAgentForm({ membershipId, displayName }: { membershipId: string; displayName: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(requestRemovalAction, idle);
  const fe = state.fieldErrors ?? {};
  if (state.ok && state.data) return <span className="text-[12.5px] font-semibold text-brand-700">{state.data.status === "COMPLETED" ? "Removed" : state.data.status === "PENDING_ADMIN" ? "Sent to Hirewise for review" : "Removal scheduled"}</span>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-[12.5px] font-semibold text-red-600 hover:text-red-700">Remove agent</button>;
  return (
    <form action={action} className="mt-3 w-full space-y-3 rounded-2xl border border-red-100 bg-red-50/40 p-4" noValidate>
      <input type="hidden" name="membershipId" value={membershipId} />
      <p className="text-[13px] text-ink-700">Removing {displayName} ends their membership and releases their seat per your seat release rule. If they have an active client assignment, Hirewise must approve first. Agency-sponsored training and certifications stop counting for them.</p>
      <Field label="Reason (shared with the agent and Hirewise)" htmlFor={`rm-r-${membershipId}`} error={fe.reason}><Textarea id={`rm-r-${membershipId}`} name="reason" rows={2} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Effective" htmlFor={`rm-o-${membershipId}`}><Select id={`rm-o-${membershipId}`} name="effectiveOption" defaultValue="IMMEDIATE">{Object.entries(OPTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Preferred date (optional)" htmlFor={`rm-d-${membershipId}`}><Input id={`rm-d-${membershipId}`} name="requestedEffectiveDate" type="date" className="h-10 text-[14px]" /></Field>
      </div>
      {state.error && !fe.reason && <FormAlert>{state.error}</FormAlert>}
      <div className="flex gap-2">
        <SubmitButton variant="danger" pendingText="Submitting…" className="h-10 text-[13.5px]">Confirm removal</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="text-[13.5px] font-semibold text-ink-500 hover:text-ink-800">Cancel</button>
      </div>
    </form>
  );
}

/** Owner or Hirewise decides a request. */
export function ExitDecisionForm({ request, audience }: { request: ExitRequestView; audience: "OWNER" | "STAFF" }) {
  const [state, action] = useActionState(audience === "OWNER" ? agencyExitDecisionAction : adminExitDecisionAction, idle);
  const [decision, setDecision] = useState<"APPROVE" | "DECLINE" | null>(null);
  if (state.ok && state.data) return <FormAlert tone="success">{state.data.status === "COMPLETED" ? "Approved and completed; the membership has ended." : state.data.status === "APPROVED" ? "Approved; the membership ends on the effective date." : state.data.status === "PENDING_ADMIN" ? "Approved by the agency; Hirewise reviews it next." : "Declined; the membership stays active."}</FormAlert>;
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button type="button" onClick={() => setDecision("APPROVE")} className={`rounded-full px-4 py-1.5 text-[13.5px] font-semibold ${decision === "APPROVE" ? "bg-brand-600 text-white" : "bg-white text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50"}`}>Approve</button>
        <button type="button" onClick={() => setDecision("DECLINE")} className={`rounded-full px-4 py-1.5 text-[13.5px] font-semibold ${decision === "DECLINE" ? "bg-red-600 text-white" : "bg-white text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50"}`}>Decline</button>
      </div>
      {decision && (
        <form action={action} className="space-y-3" noValidate>
          <input type="hidden" name="requestId" value={request.id} />
          <input type="hidden" name="decision" value={decision} />
          {decision === "APPROVE" && <Field label="Effective" htmlFor={`ed-o-${request.id}`} hint={`The ${request.type === "AGENT_REQUESTED_LEAVE" ? "agent" : "agency"} asked for: ${OPTION_LABEL[request.effectiveOption] ?? request.effectiveOption}${request.requestedEffectiveDate ? ` (${fmt(request.requestedEffectiveDate)})` : ""}.`}><Select id={`ed-o-${request.id}`} name="effectiveOption" defaultValue={request.effectiveOption}>{Object.entries(OPTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>}
          <Field label="Note (shared with the other side, optional)" htmlFor={`ed-n-${request.id}`}><Input id={`ed-n-${request.id}`} name="note" className="h-10 text-[14px]" /></Field>
          {state.error && <FormAlert>{state.error}</FormAlert>}
          <div className="flex gap-2">
            <SubmitButton pendingText="Saving…" variant={decision === "DECLINE" ? "danger" : "dark"} className="h-10 text-[13.5px]">Confirm</SubmitButton>
            <button type="button" onClick={() => setDecision(null)} className="text-[13.5px] font-semibold text-ink-500 hover:text-ink-800">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Read-only summary of a request, used by the owner and staff lists. */
export function ExitRequestSummary({ r, audience }: { r: ExitRequestView; audience: "OWNER" | "STAFF" }) {
  return (
    <div className="text-[13.5px]">
      <p className="font-semibold text-ink-900">{r.displayName}{audience === "STAFF" && r.agencyName ? ` · ${r.agencyName}` : ""} <span className="font-normal text-ink-400">· {r.type === "AGENT_REQUESTED_LEAVE" ? "asked to leave" : "removal by the agency"} · {fmt(r.createdAt)}</span></p>
      <p className="text-ink-600">Reason: {r.reason}</p>
      <p className="text-ink-500">Timing: {OPTION_LABEL[r.effectiveOption] ?? r.effectiveOption}{r.requestedEffectiveDate ? ` (asked for ${fmt(r.requestedEffectiveDate)})` : ""}{r.effectiveAt ? ` · effective ${fmt(r.effectiveAt)}` : ""}{r.adminRequired ? ` · Hirewise review: ${r.adminRequiredReason ?? "required"}` : ""}</p>
      {r.agencyDecision && <p className="text-ink-500">Agency: {r.agencyDecision.toLowerCase()}{r.agencyDecisionNote ? ` · ${r.agencyDecisionNote}` : ""}{r.agencyDecidedAt ? ` · ${fmt(r.agencyDecidedAt)}` : ""}</p>}
      {r.adminDecision && <p className="text-ink-500">Hirewise: {r.adminDecision.toLowerCase()}{r.adminDecisionNote ? ` · ${r.adminDecisionNote}` : ""}{r.adminDecidedAt ? ` · ${fmt(r.adminDecidedAt)}` : ""}</p>}
      {r.escalatedAt && <p className="text-gold-700">Escalated to Hirewise on {fmt(r.escalatedAt)}</p>}
    </div>
  );
}
