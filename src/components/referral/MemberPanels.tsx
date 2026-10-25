"use client";

import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { savePayoutDetailsAction, requestPayoutAction } from "@/app/(app)/referral-actions";
import { idle } from "@/server/http/action-result";
import { Field, FormAlert, Input, Select, SubmitButton } from "@/components/ui/Form";

/** The member's personal link with a copy button. */
export function ReferralLinkCard({ link, code }: { link: string; code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the link is selectable in the field.
    }
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Your referral link" className="h-11 min-w-0 flex-1 rounded-xl border border-ink-200 bg-ink-50 px-3.5 font-mono text-[13.5px] text-ink-800" />
      <button type="button" onClick={() => void copy()} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ink-900 px-5 text-[14px] font-semibold text-white transition hover:bg-brand-600">
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy link"}
      </button>
      <span className="sr-only" role="status">{copied ? `Link copied. Your code is ${code}.` : ""}</span>
    </div>
  );
}

export function PayoutDetailsForm({ current }: { current: { method: string; accountName: string; bankName: string | null; accountMasked: string | null } | null }) {
  const [state, action] = useActionState(savePayoutDetailsAction, idle);
  const [method, setMethod] = useState(current?.method ?? "GCASH");
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Payout method" htmlFor="pd-method">
          <Select id="pd-method" name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="GCASH">GCash</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
          </Select>
        </Field>
        <Field label="Name on the account" htmlFor="pd-name" error={fe.accountName}><Input id="pd-name" name="accountName" defaultValue={current?.accountName ?? ""} invalid={!!fe.accountName} /></Field>
        <Field label={method === "GCASH" ? "GCash mobile number" : "Account number"} htmlFor="pd-number" error={fe.accountNumber} hint={current?.accountMasked ? `Saved: ${current.accountMasked}. Enter it again to change it.` : undefined}><Input id="pd-number" name="accountNumber" inputMode="tel" autoComplete="off" invalid={!!fe.accountNumber} /></Field>
        {method === "BANK_TRANSFER" && <Field label="Bank name" htmlFor="pd-bank" error={fe.bankName}><Input id="pd-bank" name="bankName" defaultValue={current?.bankName ?? ""} invalid={!!fe.bankName} /></Field>}
      </div>
      {state.error && !Object.keys(fe).length && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Payout details saved.</FormAlert>}
      <SubmitButton variant="outline" pendingText="Saving…" className="h-10 text-[13.5px]">Save payout details</SubmitButton>
    </form>
  );
}

export function RequestPayoutButton({ enabled, label, hint }: { enabled: boolean; label: string; hint: string }) {
  const [state, action] = useActionState(requestPayoutAction, idle);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton pendingText="Requesting…" className="h-11" disabled={!enabled}>{label}</SubmitButton>
      <p className="text-[12.5px] text-ink-500">{hint}</p>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Payout requested. Hirewise will review it and pay you by the method above.</FormAlert>}
    </form>
  );
}
