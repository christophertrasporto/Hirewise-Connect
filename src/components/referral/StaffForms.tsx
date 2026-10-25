"use client";

import { useActionState } from "react";
import { updateReferralSettingsAction, reviewFlagAction, reverseCommissionAction, adjustBalanceAction, payoutDecisionAction, recordRefundAction } from "@/app/(app)/referral-actions";
import { idle } from "@/server/http/action-result";
import { Field, FormAlert, Input, Select, SubmitButton } from "@/components/ui/Form";

type Settings = { commissionRateBps: number; holdDays: number; cookieDays: number; minimumPayoutMinor: number; payoutCurrency: string };

/** Program settings. A new rate applies to future sales only; every commission keeps the rate it was made at. */
export function ReferralSettingsForm({ s }: { s: Settings }) {
  const [state, action] = useActionState(updateReferralSettingsAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Commission rate (%)" htmlFor="rs-rate" error={fe.ratePercent} hint="Future sales only"><Input id="rs-rate" name="ratePercent" inputMode="decimal" defaultValue={String(s.commissionRateBps / 100)} invalid={!!fe.ratePercent} /></Field>
        <Field label="Hold period (days)" htmlFor="rs-hold" error={fe.holdDays} hint="Refund window"><Input id="rs-hold" name="holdDays" type="number" min={0} max={365} defaultValue={s.holdDays} /></Field>
        <Field label="Cookie length (days)" htmlFor="rs-cookie" error={fe.cookieDays}><Input id="rs-cookie" name="cookieDays" type="number" min={1} max={365} defaultValue={s.cookieDays} /></Field>
        <Field label="Minimum payout" htmlFor="rs-min" error={fe.minimumPayout} hint="In the payout currency"><Input id="rs-min" name="minimumPayout" inputMode="decimal" defaultValue={(s.minimumPayoutMinor / 100).toFixed(2)} invalid={!!fe.minimumPayout} /></Field>
        <Field label="Payout currency" htmlFor="rs-cur" error={fe.payoutCurrency}><Input id="rs-cur" name="payoutCurrency" maxLength={3} defaultValue={s.payoutCurrency} className="uppercase" /></Field>
      </div>
      <Field label="Reason for the change (optional)" htmlFor="rs-reason"><Input id="rs-reason" name="reason" /></Field>
      {state.error && !Object.keys(fe).length && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Settings saved. They apply to new clicks and new sales.</FormAlert>}
      <SubmitButton pendingText="Saving…" className="h-10">Save settings</SubmitButton>
    </form>
  );
}

export function ReviewFlagButton({ flagId }: { flagId: string }) {
  const [state, action] = useActionState(reviewFlagAction, idle);
  if (state.ok) return <span className="text-[12px] font-semibold text-brand-700">Reviewed</span>;
  return (
    <form action={action}>
      <input type="hidden" name="flagId" value={flagId} />
      <SubmitButton variant="outline" pendingText="…" className="h-8 px-3 text-[12px]">Mark reviewed</SubmitButton>
      {state.error && <span className="ml-2 text-[12px] text-red-600">{state.error}</span>}
    </form>
  );
}

export function ReverseCommissionForm({ commissionId }: { commissionId: string }) {
  const [state, action] = useActionState(reverseCommissionAction, idle);
  if (state.ok) return <span className="text-[12px] font-semibold text-brand-700">Reversed</span>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="commissionId" value={commissionId} />
      <Input name="note" placeholder="Required note" aria-label="Reason for reversing" className="h-8 w-[200px] text-[12.5px]" />
      <SubmitButton variant="danger" pendingText="…" className="h-8 px-3 text-[12px]">Reverse</SubmitButton>
      {state.error && <span className="w-full text-[12px] text-red-600">{state.error}</span>}
    </form>
  );
}

/** A signed manual change to the balance, with a required note that goes to the audit log and the member. */
export function AdjustBalanceForm({ referrerId, currency }: { referrerId: string; currency: string }) {
  const [state, action] = useActionState(adjustBalanceAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end" noValidate>
      <input type="hidden" name="referrerId" value={referrerId} />
      <Field label={`Amount (${currency}, minus to deduct)`} htmlFor="adj-amount" error={fe.amount}><Input id="adj-amount" name="amount" inputMode="decimal" placeholder="-5.00" invalid={!!fe.amount} /></Field>
      <Field label="Note (required)" htmlFor="adj-note" error={fe.note}><Input id="adj-note" name="note" invalid={!!fe.note} /></Field>
      <SubmitButton variant="outline" pendingText="…" className="h-10">Adjust</SubmitButton>
      <div className="sm:col-span-3">
        {state.error && !Object.keys(fe).length && <FormAlert>{state.error}</FormAlert>}
        {state.ok && <FormAlert tone="success">Balance adjusted. The member was notified.</FormAlert>}
      </div>
    </form>
  );
}

/** Approve, mark paid with the transfer reference, or reject with a reason. */
export function PayoutDecisionForm({ payoutId, status }: { payoutId: string; status: "REQUESTED" | "APPROVED" }) {
  const [state, action] = useActionState(payoutDecisionAction, idle);
  if (state.ok) return <FormAlert tone="success">Done.</FormAlert>;
  return (
    <div className="space-y-2">
      {status === "REQUESTED" && (
        <form action={action}>
          <input type="hidden" name="payoutId" value={payoutId} />
          <input type="hidden" name="op" value="APPROVE" />
          <SubmitButton pendingText="…" className="h-9 text-[13px]">Approve</SubmitButton>
        </form>
      )}
      {status === "APPROVED" && (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="payoutId" value={payoutId} />
          <input type="hidden" name="op" value="PAY" />
          <Input name="reference" placeholder="Transfer reference number" aria-label="Transfer reference" className="h-9 w-[230px] text-[13px]" />
          <SubmitButton pendingText="…" className="h-9 text-[13px]">Mark paid</SubmitButton>
        </form>
      )}
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="payoutId" value={payoutId} />
        <input type="hidden" name="op" value="REJECT" />
        <Input name="reason" placeholder="Reason to reject" aria-label="Reason to reject" className="h-9 w-[230px] text-[13px]" />
        <SubmitButton variant="danger" pendingText="…" className="h-9 text-[13px]">Reject</SubmitButton>
      </form>
      {state.error && <FormAlert>{state.error}</FormAlert>}
    </div>
  );
}

/** Record a refund or chargeback on a paid course enrolment or Course Seat purchase. Ends access and reverses any commission. */
export function RefundForm({ target, id }: { target: "ENROLLMENT" | "COURSE_PURCHASE"; id: string }) {
  const [state, action] = useActionState(recordRefundAction, idle);
  if (state.ok) return <FormAlert tone="success">Recorded. Access ended and any referral commission was reversed.</FormAlert>;
  return (
    <details className="text-[13px]">
      <summary className="cursor-pointer font-semibold text-red-700">Record a refund or chargeback</summary>
      <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="target" value={target} />
        <input type="hidden" name="id" value={id} />
        <Select name="kind" defaultValue="REFUND" className="h-9 w-[140px] text-[13px]" aria-label="Kind"><option value="REFUND">Refund</option><option value="CHARGEBACK">Chargeback</option></Select>
        <Input name="reason" placeholder="Reason (required)" aria-label="Reason" className="h-9 w-[230px] text-[13px]" />
        <SubmitButton variant="danger" pendingText="…" className="h-9 text-[13px]">Record</SubmitButton>
        {state.error && <span className="w-full text-[12px] text-red-600">{state.error}</span>}
      </form>
    </details>
  );
}
