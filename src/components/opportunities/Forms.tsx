"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Send, CalendarPlus } from "lucide-react";
import { publishOpportunityAction, closeOpportunityAction, reviewSubmissionAction, submitAgentAction, withdrawSubmissionAction, requestInterviewsFromOpportunityAction } from "@/app/(app)/opportunity-actions";
import { idle, type ActionResult } from "@/server/http/action-result";
import { Field, Input, Select, Textarea, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";
import { TIMEZONES } from "@/lib/options";
import { cn } from "@/lib/cn";

/** Hirewise publishes a requirement as an opportunity (opportunity.manage). */
export function PublishOpportunityForm({ requirements, agencies, defaultRequirementId }: { requirements: Array<{ id: string; title: string; role: string; companyName: string }>; agencies: Array<{ id: string; name: string }>; defaultRequirementId?: string }) {
  const router = useRouter();
  const [state, action] = useActionState(publishOpportunityAction, idle as ActionResult<{ id: string }>);
  const [visibility, setVisibility] = useState("ALL_AGENCIES");
  useEffect(() => {
    if (state.ok && state.data) router.push(`/staff/opportunities/${state.data.id}`);
  }, [state, router]);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3" noValidate>
      <Field label="Requirement" htmlFor="po-req" error={fe.requirementId}>
        <Select id="po-req" name="requirementId" defaultValue={defaultRequirementId ?? ""}>
          <option value="" disabled>Choose a client requirement</option>
          {requirements.map((r) => <option key={r.id} value={r.id}>{r.companyName} · {r.title} ({r.role})</option>)}
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Who may submit" htmlFor="po-vis">
          <Select id="po-vis" name="visibility" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            <option value="ALL_AGENCIES">All Partner Teams and direct talent</option>
            <option value="SELECTED_AGENCIES">Selected Partner Teams only</option>
            <option value="DIRECT_ONLY">Hirewise Direct talent only</option>
          </Select>
        </Field>
        <Field label="Headcount (optional override)" htmlFor="po-head" error={fe.headcount}><Input id="po-head" name="headcount" type="number" min={1} max={500} placeholder="From the requirement" /></Field>
      </div>
      {visibility === "SELECTED_AGENCIES" && (
        <fieldset className="rounded-2xl border border-ink-100 p-3">
          <legend className="px-1 text-[12.5px] font-semibold text-ink-500">Agencies</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">{agencies.map((a) => <Checkbox key={a.id} name="agencyIds" value={a.id} label={a.name} />)}</div>
        </fieldset>
      )}
      <Field label="Role summary shown to agencies and talent (optional)" htmlFor="po-sum" error={fe.roleSummary} hint="Defaults to the job description. Never mention the client's name."><Textarea id="po-sum" name="roleSummary" rows={3} /></Field>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton pendingText="Publishing…" variant="primary">Publish opportunity</SubmitButton>
    </form>
  );
}

export function CloseOpportunityForm({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const [state, action] = useActionState(closeOpportunityAction, idle);
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);
  return (
    <form action={action} className="space-y-2" noValidate>
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <Input name="reason" placeholder="Reason (required)" className="h-9 text-[13px]" />
      <div className="flex gap-2">
        <SubmitButton name="status" value="FILLED" variant="dark" pendingText="…" className="h-9 text-[12.5px]">Mark filled</SubmitButton>
        <SubmitButton name="status" value="CLOSED" variant="outline" pendingText="…" className="h-9 text-[12.5px]">Close</SubmitButton>
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
    </form>
  );
}

export function ReviewSubmissionForm({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [state, action] = useActionState(reviewSubmissionAction, idle);
  const [decision, setDecision] = useState<"APPROVE" | "DECLINE">("APPROVE");
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);
  if (state.ok) return <FormAlert tone="success">Decision recorded.</FormAlert>;
  return (
    <form action={action} className="space-y-2" noValidate>
      <input type="hidden" name="submissionId" value={submissionId} />
      <input type="hidden" name="decision" value={decision} />
      <div className="flex gap-1.5">
        {(["APPROVE", "DECLINE"] as const).map((d) => <button key={d} type="button" onClick={() => setDecision(d)} className={cn("rounded-full px-3 py-1.5 text-[12.5px] font-semibold ring-1 ring-inset", decision === d ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-ink-700 ring-ink-200 hover:bg-ink-50")}>{d === "APPROVE" ? "Approve for client" : "Decline"}</button>)}
      </div>
      {decision === "DECLINE" && <Textarea name="note" rows={2} placeholder="Why (sent to the submitter)" />}
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant={decision === "DECLINE" ? "danger" : "dark"} pendingText="Saving…" className="h-9 text-[13px]">Confirm</SubmitButton>
    </form>
  );
}

/** Agency owner submits a member; direct talent submits themselves (agentProfileId fixed). */
export function SubmitAgentForm({ opportunityId, members, fixedAgentProfileId, disabledReason }: { opportunityId: string; members?: Array<{ id: string; displayName: string; primaryRole: string | null; eligible: boolean; reason: string | null }>; fixedAgentProfileId?: string; disabledReason?: string | null }) {
  const router = useRouter();
  const [state, action] = useActionState(submitAgentAction, idle);
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);
  if (state.ok) return <FormAlert tone="success">Submitted. Hirewise reviews it before the client sees the candidate.</FormAlert>;
  if (disabledReason) return <p className="text-[13px] text-ink-500">{disabledReason}</p>;
  return (
    <form action={action} className="space-y-2.5" noValidate>
      <input type="hidden" name="opportunityId" value={opportunityId} />
      {fixedAgentProfileId ? <input type="hidden" name="agentProfileId" value={fixedAgentProfileId} /> : (
        <Select name="agentProfileId" defaultValue="" aria-label="Agent">
          <option value="" disabled>Choose an agent</option>
          {(members ?? []).map((m) => <option key={m.id} value={m.id} disabled={!m.eligible}>{m.displayName} · {m.primaryRole ?? "Talent"}{m.eligible ? "" : ` · ${m.reason}`}</option>)}
        </Select>
      )}
      <Textarea name="note" rows={2} placeholder="Why this agent fits (shown to Hirewise, not to the client)" />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant="primary" pendingText="Submitting…" className="h-10 text-[13.5px]"><Send className="h-4 w-4" /> {fixedAgentProfileId ? "Apply through Hirewise" : "Submit agent"}</SubmitButton>
    </form>
  );
}

export function WithdrawSubmissionForm({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [state, action] = useActionState(withdrawSubmissionAction, idle);
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" noValidate>
      <input type="hidden" name="submissionId" value={submissionId} />
      <Input name="reason" placeholder="Reason to withdraw" className="h-9 max-w-xs text-[13px]" />
      <SubmitButton variant="outline" pendingText="…" className="h-9 text-[12.5px]">Withdraw</SubmitButton>
      {state.error && <span className="text-[12.5px] text-red-600">{state.error}</span>}
    </form>
  );
}

/** Client requests interviews with approved candidates on their opportunity. */
export function RequestInterviewsFromOpportunityForm({ opportunityId, candidates, defaultTimezone }: { opportunityId: string; candidates: Array<{ id: string; name: string; primaryRole: string | null }>; defaultTimezone: string }) {
  const [state, action] = useActionState(requestInterviewsFromOpportunityAction, idle);
  if (candidates.length === 0) return <p className="text-[13px] text-ink-400">Candidates appear here once Hirewise approves submissions for you.</p>;
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <div className="space-y-1.5">{candidates.map((c) => <Checkbox key={c.id} name="agentProfileIds" value={c.id} label={<span><span className="font-semibold">{c.name}</span> <span className="text-ink-400">· {c.primaryRole ?? "Talent"}</span></span>} />)}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your timezone" htmlFor={`rio-tz-${opportunityId}`}><Select id={`rio-tz-${opportunityId}`} name="timezone" defaultValue={defaultTimezone}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <Field label="Windows that work (one per line, optional)" htmlFor={`rio-win-${opportunityId}`}><Textarea id={`rio-win-${opportunityId}`} name="requestedWindows" rows={2} /></Field>
      </div>
      <Field label="Notes for Hirewise (optional)" htmlFor={`rio-notes-${opportunityId}`}><Textarea id={`rio-notes-${opportunityId}`} name="notes" rows={2} /></Field>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant="primary" pendingText="Requesting…"><CalendarPlus className="h-4 w-4" /> Request interviews</SubmitButton>
    </form>
  );
}
