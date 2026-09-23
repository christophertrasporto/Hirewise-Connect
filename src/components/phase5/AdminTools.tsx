"use client";

import { useActionState, useState } from "react";
import { bulkAgentActionAction, broadcastAction, anonymiseUserAction, runRetentionAction, checkoutAction } from "@/app/(app)/phase5-actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Select, Textarea, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";

type Row = { id: string; displayName: string; status: string };

/** Bulk actions over the talent pipeline. Each selected agent goes through the normal single-item service, so guards and audit hold. */
export function BulkAgentActions({ rows, canHide, canAvailability, canVerification, canNotify }: { rows: Row[]; canHide: boolean; canAvailability: boolean; canVerification: boolean; canNotify: boolean }) {
  const [state, action] = useActionState(bulkAgentActionAction, idle);
  const [selected, setSelected] = useState<string[]>([]);
  const [op, setOp] = useState<string>(canHide ? "HIDE" : canAvailability ? "SET_AVAILABILITY" : canVerification ? "SET_VERIFICATION" : "NOTIFY");
  const all = selected.length === rows.length && rows.length > 0;
  const ops = [canHide && ["HIDE", "Hide from marketplace"], canHide && ["UNHIDE", "Unhide (re-approve)"], canAvailability && ["SET_AVAILABILITY", "Set availability"], canVerification && ["SET_VERIFICATION", "Set verification level"], canNotify && ["NOTIFY", "Send notification"]].filter(Boolean) as Array<[string, string]>;
  if (ops.length === 0) return null;
  return (
    <form action={action} className="mb-4 rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-[13.5px] font-semibold text-ink-800"><input type="checkbox" checked={all} onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])} className="h-4 w-4 accent-brand-600" /> Select all ({selected.length}/{rows.length})</label>
        {selected.map((id) => <input key={id} type="hidden" name="agentProfileIds" value={id} />)}
        <Select name="op" value={op} onChange={(e) => setOp(e.target.value)} className="h-10 w-[220px] text-[13.5px]" aria-label="Bulk action">{ops.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        {op === "SET_AVAILABILITY" && <Select name="availability" defaultValue="AVAILABLE" className="h-10 w-[180px] text-[13.5px]" aria-label="Availability"><option value="AVAILABLE">Available</option><option value="AVAILABLE_SOON">Available soon</option><option value="PAUSED">Paused</option><option value="UNAVAILABLE">Unavailable</option></Select>}
        {op === "SET_VERIFICATION" && <Select name="level" defaultValue="PROFILE_VERIFIED" className="h-10 w-[200px] text-[13.5px]" aria-label="Level">{["PROFILE_SUBMITTED", "PROFILE_VERIFIED", "SKILLS_ASSESSED", "HIREWISE_CERTIFIED", "INTERVIEW_READY", "DEPLOYMENT_READY"].map((l) => <option key={l} value={l}>{l.replace(/_/g, " ").toLowerCase()}</option>)}</Select>}
        {op !== "NOTIFY" && <Input name="reason" placeholder="Reason (audited)" className="h-10 w-[220px] text-[13.5px]" />}
        <SubmitButton variant="dark" pendingText="Applying…" className="h-10 text-[13.5px]" disabled={selected.length === 0}>Apply to {selected.length}</SubmitButton>
      </div>
      {op === "NOTIFY" && <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr]"><Input name="title" placeholder="Notification title" className="h-10 text-[13.5px]" /><Input name="body" placeholder="Message body (also emailed)" className="h-10 text-[13.5px]" /></div>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {rows.map((r) => <label key={r.id} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${selected.includes(r.id) ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-600"}`}><input type="checkbox" className="sr-only" checked={selected.includes(r.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))} />{r.displayName}</label>)}
      </div>
      {state.error && <div className="mt-3"><FormAlert>{state.error}</FormAlert></div>}
      {state.ok && state.data && <div className="mt-3"><FormAlert tone={state.data.failed.length ? "info" : "success"}>{state.data.done} updated.{state.data.failed.length > 0 && ` ${state.data.failed.length} skipped: ${state.data.failed.map((f) => f.error).slice(0, 3).join("; ")}`}</FormAlert></div>}
    </form>
  );
}

export function BroadcastForm() {
  const [state, action] = useActionState(broadcastAction, idle);
  const fe = state.fieldErrors ?? {};
  if (state.ok && state.data) return <FormAlert tone="success">Sent to {state.data.recipients} user(s).</FormAlert>;
  return (
    <form action={action} className="space-y-3" noValidate>
      <div className="flex flex-wrap gap-3">{["AGENT", "CLIENT", "SALES", "RECRUITER", "COACH", "OPERATIONS", "ADMIN"].map((r) => <Checkbox key={r} name="roles" value={r} label={r.toLowerCase()} />)}</div>
      {fe.roles && <p className="text-[12.5px] text-red-600">{fe.roles}</p>}
      <Field label="Title" htmlFor="bc-title" error={fe.title}><Input id="bc-title" name="title" className="h-10 text-[14px]" /></Field>
      <Field label="Message" htmlFor="bc-body" error={fe.body}><Textarea id="bc-body" name="body" rows={3} className="text-[14px]" /></Field>
      <Checkbox name="email" label="Also send by email" />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton pendingText="Sending…" className="h-10 text-[13.5px]">Send broadcast</SubmitButton>
    </form>
  );
}

export function AnonymiseForm({ userId, label }: { userId: string; label: string }) {
  const [state, action] = useActionState(anonymiseUserAction, idle);
  if (state.ok) return <FormAlert tone="success">Anonymised.</FormAlert>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" noValidate onSubmit={(e) => { if (!window.confirm(`Anonymise ${label}? This cannot be undone.`)) e.preventDefault(); }}>
      <input type="hidden" name="userId" value={userId} />
      <Input name="reason" placeholder="Reason / request reference" className="h-9 w-[240px] text-[13px]" required />
      <SubmitButton variant="danger" pendingText="…" className="h-9 px-3 text-[12.5px]">Anonymise</SubmitButton>
      {state.error && <span className="w-full text-[12px] text-red-600">{state.error}</span>}
    </form>
  );
}

export function RetentionRunButton({ count }: { count: number }) {
  const [state, action] = useActionState(runRetentionAction, idle);
  if (state.ok && state.data) return <FormAlert tone="success">Considered {state.data.considered}, anonymised {state.data.done}{state.data.failed.length ? `, ${state.data.failed.length} skipped (${state.data.failed[0].error})` : ""}.</FormAlert>;
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(`Anonymise ${count} account(s) now? This cannot be undone.`)) e.preventDefault(); }}>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant="danger" pendingText="Running…" className="h-10 text-[13.5px]" disabled={count === 0}>Run retention job ({count})</SubmitButton>
    </form>
  );
}

export function PayOnlineButton({ invoiceId }: { invoiceId: string }) {
  const [state, action] = useActionState(checkoutAction, idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <SubmitButton variant="primary" pendingText="Opening checkout…">Pay online</SubmitButton>
      {state.error && <FormAlert>{state.error}</FormAlert>}
    </form>
  );
}
