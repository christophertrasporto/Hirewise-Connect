"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { reviewDecisionAction, agencyStatusAction, createAgencyDirectAction, setAgentAgencyAction } from "@/app/(app)/agency-actions";
import { idle, type ActionResult } from "@/server/http/action-result";
import { Field, FormAlert, Input, SubmitButton, Textarea, Select } from "@/components/ui/Form";
import { COUNTRIES } from "@/lib/options";

/** Reviewer controls for one application: notes, request info, approve, reject (with the cooldown override). */
export function ReviewPanel({ applicationId, status, reviewNotes, defaultCooldownDays }: { applicationId: string; status: string; reviewNotes: string | null; defaultCooldownDays: number }) {
  const router = useRouter();
  const [state, action] = useActionState(reviewDecisionAction, idle as ActionResult<{ agencyId?: string }>);
  const [mode, setMode] = useState<"NEEDS_MORE_INFO" | "APPROVE" | "REJECT" | null>(null);
  const fe = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.ok) {
      setMode(null);
      router.refresh();
    }
  }, [state.ok, router]);
  const open = status === "SUBMITTED" || status === "UNDER_REVIEW" || status === "NEEDS_MORE_INFO";

  return (
    <div className="space-y-5">
      <form action={action} className="space-y-3" noValidate>
        <input type="hidden" name="applicationId" value={applicationId} />
        <Field label="Internal notes" htmlFor={`rn-${applicationId}`} hint="Visible to Hirewise only. Never shown to the applicant.">
          <Textarea id={`rn-${applicationId}`} name="notes" rows={4} defaultValue={reviewNotes ?? ""} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <SubmitButton name="decision" value="NOTES" variant="outline" pendingText="Saving…" className="h-10 text-[13.5px]">Save notes</SubmitButton>
          {status === "SUBMITTED" && <SubmitButton name="decision" value="START" pendingText="Starting…" className="h-10 text-[13.5px]">Start review</SubmitButton>}
        </div>
      </form>

      {open && (
        <div className="space-y-3 rounded-2xl border border-ink-100 bg-ink-50/60 p-4">
          <p className="text-[13px] font-semibold text-ink-700">Decision</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setMode("APPROVE")} className={`rounded-full px-4 py-1.5 text-[13.5px] font-semibold ${mode === "APPROVE" ? "bg-brand-600 text-white" : "bg-white text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50"}`}>Approve</button>
            {status !== "NEEDS_MORE_INFO" && <button type="button" onClick={() => setMode("NEEDS_MORE_INFO")} className={`rounded-full px-4 py-1.5 text-[13.5px] font-semibold ${mode === "NEEDS_MORE_INFO" ? "bg-gold-600 text-white" : "bg-white text-gold-700 ring-1 ring-inset ring-gold-200 hover:bg-gold-50"}`}>Request more info</button>}
            <button type="button" onClick={() => setMode("REJECT")} className={`rounded-full px-4 py-1.5 text-[13.5px] font-semibold ${mode === "REJECT" ? "bg-red-600 text-white" : "bg-white text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50"}`}>Reject</button>
          </div>
          {mode && (
            <form action={action} className="space-y-3" noValidate>
              <input type="hidden" name="applicationId" value={applicationId} />
              <input type="hidden" name="decision" value={mode} />
              {mode === "APPROVE" && <p className="text-[13.5px] text-ink-600">Approving creates the agency from this application, gives the applicant the Owner seat (and the Agency Owner role if they have no other), and notifies them.</p>}
              <Field label={mode === "APPROVE" ? "Welcome message to the applicant (optional)" : mode === "REJECT" ? "Reason (sent to the applicant)" : "What do you need from the applicant? (sent to them)"} htmlFor={`rm-${applicationId}`} error={fe.message}>
                <Textarea id={`rm-${applicationId}`} name="message" rows={3} invalid={!!fe.message} />
              </Field>
              {mode === "REJECT" && (
                <Field label={`Re-application cooldown (days)`} htmlFor={`rc-${applicationId}`} error={fe.reapplyAfterDays} hint={`Blank uses the configured default of ${defaultCooldownDays} days. 0 lets them re-apply immediately.`} className="w-[220px]">
                  <Input id={`rc-${applicationId}`} name="reapplyAfterDays" type="number" min={0} max={3650} placeholder={String(defaultCooldownDays)} />
                </Field>
              )}
              <Field label="Internal note for this decision (optional)" htmlFor={`rd-${applicationId}`}><Input id={`rd-${applicationId}`} name="notes" /></Field>
              {state.error && <FormAlert>{state.error}</FormAlert>}
              <div className="flex gap-2">
                <SubmitButton pendingText="Saving…" variant={mode === "REJECT" ? "danger" : "dark"} className="h-10 text-[13.5px]">{mode === "APPROVE" ? "Confirm approval" : mode === "REJECT" ? "Confirm rejection" : "Send request"}</SubmitButton>
                <button type="button" onClick={() => setMode(null)} className="text-[13.5px] font-semibold text-ink-500 hover:text-ink-800">Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}
      {state.ok && state.data?.agencyId && <FormAlert tone="success">Approved. Agency created.</FormAlert>}
    </div>
  );
}

/** Suspend / reactivate / deactivate with a required reason. */
export function AgencyStatusForm({ agencyId, status }: { agencyId: string; status: string }) {
  const router = useRouter();
  const [state, action] = useActionState(agencyStatusAction, idle);
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);
  const targets = status === "ACTIVE" ? [["SUSPENDED", "Suspend"], ["INACTIVE", "Deactivate"]] : status === "SUSPENDED" ? [["ACTIVE", "Reactivate"], ["INACTIVE", "Deactivate"]] : [["ACTIVE", "Reactivate"]];
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="agencyId" value={agencyId} />
      <Field label="Reason (required, recorded in the audit log and sent to the owner)" htmlFor={`as-${agencyId}`}><Textarea id={`as-${agencyId}`} name="reason" rows={2} /></Field>
      <div className="flex flex-wrap gap-2">
        {targets.map(([to, label]) => <SubmitButton key={to} name="status" value={to} variant={to === "ACTIVE" ? "dark" : to === "INACTIVE" ? "danger" : "outline"} pendingText="Saving…" className="h-10 text-[13.5px]">{label}</SubmitButton>)}
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Status updated.</FormAlert>}
    </form>
  );
}

/** Super Admin only: create an agency for an existing account without an application. */
export function CreateAgencyDirectForm() {
  const [state, action] = useActionState(createAgencyDirectAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Owner's account email" htmlFor="da-owner" error={fe.ownerEmail} hint="An existing talent, client, or applicant account. Staff accounts are refused."><Input id="da-owner" name="ownerEmail" type="email" invalid={!!fe.ownerEmail} /></Field>
        <Field label="Agency name" htmlFor="da-name" error={fe.name}><Input id="da-name" name="name" invalid={!!fe.name} /></Field>
        <Field label="Contact email (optional)" htmlFor="da-email" error={fe.contactEmail}><Input id="da-email" name="contactEmail" type="email" /></Field>
        <Field label="Contact phone (optional)" htmlFor="da-phone"><Input id="da-phone" name="contactPhone" /></Field>
        <Field label="Country" htmlFor="da-country" error={fe.country}><Select id="da-country" name="country" defaultValue="Philippines">{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="City (optional)" htmlFor="da-city"><Input id="da-city" name="city" /></Field>
        <Field label="Website (optional)" htmlFor="da-web" error={fe.website}><Input id="da-web" name="website" type="url" placeholder="https://" /></Field>
        <Field label="Reason for bypassing the application" htmlFor="da-reason" error={fe.reason}><Input id="da-reason" name="reason" invalid={!!fe.reason} /></Field>
      </div>
      <Field label="Description (optional)" htmlFor="da-desc"><Textarea id="da-desc" name="description" rows={2} /></Field>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton pendingText="Creating…">Create agency</SubmitButton>
    </form>
  );
}

/** Admin override of an agent's primary agency. */
export function SetAgentAgencyForm({ agentProfileId, currentAgencyId, agencies }: { agentProfileId: string; currentAgencyId: string | null; agencies: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [state, action] = useActionState(setAgentAgencyAction, idle);
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="agentProfileId" value={agentProfileId} />
      <Field label="Primary agency" htmlFor={`aa-${agentProfileId}`} className="min-w-[220px]">
        <Select id={`aa-${agentProfileId}`} name="agencyId" defaultValue={currentAgencyId ?? ""}><option value="">Hirewise Direct</option>{agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
      </Field>
      <Field label="Reason" htmlFor={`ar-${agentProfileId}`} className="min-w-[220px] flex-1"><Input id={`ar-${agentProfileId}`} name="reason" /></Field>
      <SubmitButton pendingText="Saving…" className="h-10 text-[13.5px]">Change</SubmitButton>
      {state.error && <p className="w-full text-[12.5px] text-red-600">{state.error}</p>}
    </form>
  );
}
