"use client";

import { useActionState } from "react";
import { adjustWalletAction, decideWithdrawalAction, importFeesAction, setFeeAction, setOverrideAction, updateWalletSettingsAction } from "@/app/(app)/wallet-actions";
import { idle } from "@/server/http/action-result";
import { Checkbox, Field, FormAlert, Input, Select, SubmitButton, Textarea } from "@/components/ui/Form";

/** Approve, mark paid with a reference, or reject with a reason. Rejecting returns the amount to the coach's balance. */
export function WithdrawalDecisionForm({ withdrawalId, status }: { withdrawalId: string; status: "REQUESTED" | "APPROVED" }) {
  const [state, action] = useActionState(decideWithdrawalAction, idle);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        {status === "REQUESTED" && (
          <form action={action}>
            <input type="hidden" name="withdrawalId" value={withdrawalId} />
            <input type="hidden" name="outcome" value="APPROVED" />
            <SubmitButton variant="outline" pendingText="…" className="h-9 px-4 text-[13px]">Approve</SubmitButton>
          </form>
        )}
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="withdrawalId" value={withdrawalId} />
          <input type="hidden" name="outcome" value="PAID" />
          <Input name="reference" placeholder="Payment reference" aria-label="Payment reference" className="h-9 w-[220px] text-[13px]" />
          <SubmitButton pendingText="…" className="h-9 px-4 text-[13px]">Mark paid</SubmitButton>
        </form>
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="withdrawalId" value={withdrawalId} />
          <input type="hidden" name="outcome" value="REJECTED" />
          <Input name="reason" placeholder="Reason for declining" aria-label="Reason for declining" className="h-9 w-[240px] text-[13px]" />
          <SubmitButton variant="danger" pendingText="…" className="h-9 px-4 text-[13px]">Reject</SubmitButton>
        </form>
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Saved.</FormAlert>}
    </div>
  );
}

/** The actual fee the gateway charged for one sale (from the Maya settlement report). The sale waits until it is entered. */
export function FeeForm({ earningId }: { earningId: string }) {
  const [state, action] = useActionState(setFeeAction, idle);
  if (state.ok) return <span className="text-[12.5px] font-semibold text-brand-700">Fee saved</span>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="earningId" value={earningId} />
      <Input name="fee" inputMode="decimal" placeholder="Fee, e.g. 102.47" aria-label="Gateway fee" className="h-9 w-[150px] text-[13px]" />
      <SubmitButton pendingText="…" className="h-9 px-4 text-[13px]">Save fee</SubmitButton>
      {state.error && <span className="w-full text-[12px] text-red-600">{state.error}</span>}
    </form>
  );
}

/** Upload (or paste) the settlement report from Maya Business Manager; every sale named in it gets its real fee. */
export function FeeImportForm() {
  const [state, action] = useActionState(importFeesAction, idle);
  const r = state.data;
  return (
    <form action={action} className="space-y-3" encType="multipart/form-data">
      <Field label="Settlement report (CSV)" htmlFor="fi-file" hint="Needs a header row with a reference column (Payment ID, Reference, or RRN) and a fee column (Fee or MDR).">
        <input id="fi-file" name="file" type="file" accept=".csv,text/csv" className="block w-full text-[13.5px] text-ink-700 file:mr-3 file:rounded-full file:border-0 file:bg-ink-100 file:px-4 file:py-2 file:text-[13px] file:font-semibold" />
      </Field>
      <Field label="Or paste the rows" htmlFor="fi-csv">
        <Textarea id="fi-csv" name="csv" rows={4} placeholder={"Payment ID,Fee\npay_abc123,102.47"} />
      </Field>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {r && !r.headerError && (
        <FormAlert tone={r.invalid.length || r.notFound.length ? "info" : "success"}>
          Applied {r.applied} fee{r.applied === 1 ? "" : "s"}; {r.alreadyRecorded} already recorded; {r.notFound.length} not matched to a sale{r.notFound.length ? ` (${r.notFound.slice(0, 5).map((n) => `line ${n.line}`).join(", ")}${r.notFound.length > 5 ? ", …" : ""})` : ""}; {r.invalid.length} unusable row{r.invalid.length === 1 ? "" : "s"}{r.invalid.length ? ` (${r.invalid.slice(0, 3).map((n) => `line ${n.line}: ${n.error}`).join("; ")})` : ""}.
        </FormAlert>
      )}
      <SubmitButton pendingText="Importing…" className="h-10">Import fees</SubmitButton>
    </form>
  );
}

/** A signed manual change to one coach's balance. The note is required and goes in the ledger and the audit log. */
export function AdjustForm({ coachUserId }: { coachUserId: string }) {
  const [state, action] = useActionState(adjustWalletAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="coachUserId" value={coachUserId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Direction" htmlFor="aj-dir">
          <Select id="aj-dir" name="direction" defaultValue="CREDIT">
            <option value="CREDIT">Add to the balance</option>
            <option value="DEBIT">Take off the balance</option>
          </Select>
        </Field>
        <Field label="Amount (PHP)" htmlFor="aj-amount" error={fe.amount}>
          <Input id="aj-amount" name="amount" inputMode="decimal" invalid={!!fe.amount} />
        </Field>
        <Field label="Note (required)" htmlFor="aj-note" error={fe.note}>
          <Input id="aj-note" name="note" invalid={!!fe.note} />
        </Field>
      </div>
      {state.error && !Object.keys(fe).length && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Recorded in the ledger.</FormAlert>}
      <SubmitButton pendingText="Saving…" className="h-10">Record adjustment</SubmitButton>
    </form>
  );
}

/** A special rate for one coach, for new sales only. Capped so the platform share can always cover the affiliate commission. */
export function OverrideForm({ coachUserId, current }: { coachUserId: string; current: { percent: number; note: string } | null }) {
  const [state, action] = useActionState(setOverrideAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="coachUserId" value={coachUserId} />
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Field label="Coach share (%)" htmlFor="ov-pct" error={fe.percent} hint="0 to 80">
          <Input id="ov-pct" name="percent" inputMode="decimal" defaultValue={current ? String(current.percent) : ""} invalid={!!fe.percent} />
        </Field>
        <Field label="Why (required)" htmlFor="ov-note" error={fe.note}>
          <Input id="ov-note" name="note" defaultValue={current?.note ?? ""} invalid={!!fe.note} />
        </Field>
      </div>
      {state.error && !Object.keys(fe).length && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Saved. It applies to new sales only.</FormAlert>}
      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingText="Saving…" className="h-10">{current ? "Update special rate" : "Set special rate"}</SubmitButton>
        {current && <SubmitButton variant="outline" name="intent" value="clear" pendingText="Clearing…" className="h-10">Back to the standard rate</SubmitButton>}
      </div>
    </form>
  );
}

type Settings = { coachShareBps: number; refundWindowDays: number; holdBufferDays: number; minimumWithdrawalMinor: number; showBuyerEmail: boolean };

export function WalletSettingsForm({ s }: { s: Settings }) {
  const [state, action] = useActionState(updateWalletSettingsAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Coach share (%)" htmlFor="ws-share" error={fe.sharePercent} hint="Of the net, new sales only. Platform gets the rest. Max 80.">
          <Input id="ws-share" name="sharePercent" inputMode="decimal" defaultValue={String(s.coachShareBps / 100)} invalid={!!fe.sharePercent} />
        </Field>
        <Field label="Refund window (days)" htmlFor="ws-window" hint="Match your refund policy">
          <Input id="ws-window" name="refundWindowDays" type="number" min={0} max={365} defaultValue={s.refundWindowDays} />
        </Field>
        <Field label="Extra hold (days)" htmlFor="ws-buffer" hint="Added on top of the window">
          <Input id="ws-buffer" name="holdBufferDays" type="number" min={0} max={365} defaultValue={s.holdBufferDays} />
        </Field>
        <Field label="Minimum withdrawal (PHP)" htmlFor="ws-min" error={fe.minimumWithdrawal}>
          <Input id="ws-min" name="minimumWithdrawal" inputMode="decimal" defaultValue={(s.minimumWithdrawalMinor / 100).toFixed(2)} invalid={!!fe.minimumWithdrawal} />
        </Field>
      </div>
      <Checkbox name="showBuyerEmail" defaultChecked={s.showBuyerEmail} label={<span><span className="font-semibold">Show the buyer&apos;s email to coaches</span> <span className="text-ink-500">Off by default. Coaches always see only the buyer&apos;s first name and last initial otherwise. Phone numbers are never shown.</span></span>} />
      <Field label="Reason for the change (optional)" htmlFor="ws-reason"><Input id="ws-reason" name="reason" /></Field>
      {state.error && !Object.keys(fe).length && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Saved. New sales use the new split and hold; existing earnings keep theirs.</FormAlert>}
      <SubmitButton pendingText="Saving…" className="h-10">Save settings</SubmitButton>
    </form>
  );
}
