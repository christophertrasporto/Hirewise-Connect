"use client";

import { useActionState, useState } from "react";
import { Building2 } from "lucide-react";
import { requestLeaveAction, cancelLeaveAction } from "@/app/(app)/exit-actions";
import { idle } from "@/server/http/action-result";
import { Field, FormAlert, Input, Select, SubmitButton, Textarea } from "@/components/ui/Form";
import type { ExitRequestView } from "@/server/views/exit.views";

type Membership =
  | { kind: "MEMBER"; membershipId: string; agencyName: string; status: string; joinedAt: Date; effectiveEndAt: Date | null; exit: ExitRequestView | null }
  | { kind: "FORMER"; agencyName: string; formerAt: Date | null };

const OPTION_LABEL: Record<string, string> = { IMMEDIATE: "As soon as approved", END_OF_ASSIGNMENT: "When my current client assignment ends", END_OF_BILLING_PERIOD: "At the end of the agency's billing period" };

function fmt(d: Date | string | null | undefined) {
  return d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "";
}

/** The agent's "My agency" card: membership status, the request to leave, or the former-agent notice. */
export function AgentAgencyCard({ membership }: { membership: Membership }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(requestLeaveAction, idle);
  const [cancel, cancelAction] = useActionState(cancelLeaveAction, idle);
  const fe = state.fieldErrors ?? {};
  if (membership.kind === "FORMER") {
    return (
      <div className="rounded-3xl border border-ink-100 bg-white p-5 shadow-soft">
        <p className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400"><Building2 className="h-4 w-4 text-brand-600" /> Former agency agent</p>
        <p className="mt-2 text-[15px] text-ink-800">You left <span className="font-semibold">{membership.agencyName}</span>{membership.formerAt ? ` on ${fmt(membership.formerAt)}` : ""}. Your profile is kept as a former agency profile; agency-sponsored training and certifications no longer count for platform use.</p>
        <p className="mt-1 text-[13.5px] text-ink-500">Applying as an independent freelancer, or joining another agency through its invitation link, opens in the next phase.</p>
      </div>
    );
  }
  const exit = membership.exit;
  const pending = exit && (exit.status === "PENDING_AGENCY" || exit.status === "PENDING_ADMIN");
  const approved = exit && exit.status === "APPROVED";
  return (
    <div className="rounded-3xl border border-ink-100 bg-white p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400"><Building2 className="h-4 w-4 text-brand-600" /> My agency</p>
          <p className="mt-1 text-[18px] font-bold text-ink-900">{membership.agencyName}</p>
          <p className="text-[12.5px] text-ink-400">Member since {fmt(membership.joinedAt)} · {membership.status.toLowerCase().replace(/_/g, " ")}{membership.effectiveEndAt ? ` · ends ${fmt(membership.effectiveEndAt)}` : ""}</p>
        </div>
        {!exit && membership.status === "ACTIVE" && !state.ok && <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-full border border-ink-200 px-4 py-1.5 text-[13px] font-semibold text-ink-700 hover:bg-ink-50">{open ? "Cancel" : "Request to Leave Agency"}</button>}
      </div>
      <p className="mt-3 text-[13px] text-ink-500">While you belong to an agency, Hirewise shares opportunities through them and you keep one Hirewise profile. Leaving goes through your agency and Hirewise; there is no instant exit.</p>
      {state.ok && <div className="mt-3"><FormAlert tone="success">Request sent. Your agency reviews it first; Hirewise reviews it too when you have an active client assignment.</FormAlert></div>}
      {open && !state.ok && (
        <form action={action} className="mt-4 space-y-3 rounded-2xl border border-ink-100 bg-ink-50/60 p-4" noValidate>
          <Field label="Why do you want to leave?" htmlFor="rl-reason" error={fe.reason}><Textarea id="rl-reason" name="reason" rows={3} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Preferred timing" htmlFor="rl-opt" hint="Your agency or Hirewise sets the final date."><Select id="rl-opt" name="effectiveOption" defaultValue="IMMEDIATE">{Object.entries(OPTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Preferred date (optional)" htmlFor="rl-date"><Input id="rl-date" name="requestedEffectiveDate" type="date" className="h-10 text-[14px]" /></Field>
          </div>
          {state.error && !fe.reason && <FormAlert>{state.error}</FormAlert>}
          <SubmitButton pendingText="Sending…" className="h-10 text-[13.5px]">Send request</SubmitButton>
        </form>
      )}
      {exit && (
        <div className="mt-4 rounded-2xl border border-ink-100 bg-ink-50/60 p-4 text-[13.5px]">
          <p className="font-semibold text-ink-900">{exit.type === "AGENT_REQUESTED_LEAVE" ? "Your request to leave" : "The agency asked to end your membership"} · {exit.status.toLowerCase().replace(/_/g, " ")}</p>
          <p className="mt-1 text-ink-600">Reason: {exit.reason}</p>
          <p className="text-ink-500">Timing: {OPTION_LABEL[exit.effectiveOption] ?? exit.effectiveOption}{exit.effectiveAt ? ` · effective ${fmt(exit.effectiveAt)}` : ""}{exit.adminRequired ? " · Hirewise review required" : ""}</p>
          {exit.agencyDecision && <p className="text-ink-500">Agency: {exit.agencyDecision.toLowerCase()}{exit.agencyDecisionNote ? ` · ${exit.agencyDecisionNote}` : ""}</p>}
          {exit.adminDecision && <p className="text-ink-500">Hirewise: {exit.adminDecision.toLowerCase()}{exit.adminDecisionNote ? ` · ${exit.adminDecisionNote}` : ""}</p>}
          {pending && exit.type === "AGENT_REQUESTED_LEAVE" && !cancel.ok && (
            <form action={cancelAction} className="mt-2"><SubmitButton variant="outline" pendingText="Cancelling…" className="h-9 text-[13px]">Withdraw my request</SubmitButton>{cancel.error && <span className="ml-2 text-[12.5px] text-red-600">{cancel.error}</span>}</form>
          )}
          {cancel.ok && <p className="mt-2 text-brand-700">Request withdrawn.</p>}
          {approved && <p className="mt-2 text-ink-700">Approved. Your membership ends {exit.effectiveAt ? `on ${fmt(exit.effectiveAt)}` : "when your current assignment ends"}.</p>}
        </div>
      )}
    </div>
  );
}

/** Shown to an agent whose only profile was archived after leaving an agency. */
export function FormerAgentHolding({ email, notifications }: { email: string; notifications: unknown }) {
  void notifications;
  return (
    <div className="mx-auto max-w-2xl rounded-3xl border border-ink-100 bg-white p-8 shadow-soft">
      <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-600">Your Hirewise Connect account</p>
      <h1 className="mt-3 text-[1.8rem] font-bold leading-tight">Your agency profile has been archived</h1>
      <p className="mt-3 text-[15px] text-ink-600">Signed in as <span className="font-semibold">{email}</span>. Your previous agency membership ended and the profile that belonged to it is now part of your history, which only Hirewise can see.</p>
      <p className="mt-2 text-[15px] text-ink-600">Applying as an independent freelancer starts a fresh profile; that flow opens in the next phase. Joining a new agency through its invitation link works today.</p>
    </div>
  );
}
