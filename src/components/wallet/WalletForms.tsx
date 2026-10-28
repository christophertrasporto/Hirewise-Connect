"use client";

import { useActionState, useState } from "react";
import { requestWithdrawalAction, savePayoutDetailsAction } from "@/app/(app)/wallet-actions";
import { idle } from "@/server/http/action-result";
import { Field, FormAlert, Input, Select, SubmitButton } from "@/components/ui/Form";

type Details = { method: "GCASH" | "MAYA" | "BANK_TRANSFER"; accountName: string; accountMasked: string; bankName: string | null } | null;

/** Where the coach's money is sent. The number is stored encrypted and only the last four digits are ever shown back. */
export function PayoutDetailsForm({ details }: { details: Details }) {
  const [state, action] = useActionState(savePayoutDetailsAction, idle);
  const [method, setMethod] = useState<"GCASH" | "MAYA" | "BANK_TRANSFER">(details?.method ?? "GCASH");
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {details && <p className="text-[13px] text-ink-500">Saved: {details.method === "GCASH" ? "GCash" : details.method === "MAYA" ? "Maya" : (details.bankName ?? "Bank")} {details.accountMasked} · {details.accountName}. Enter new details below to replace them.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Send my money to" htmlFor="pd-method">
          <Select id="pd-method" name="method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="GCASH">GCash</option>
            <option value="MAYA">Maya</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
          </Select>
        </Field>
        {method === "BANK_TRANSFER" && (
          <Field label="Bank" htmlFor="pd-bank" error={fe.bankName}>
            <Input id="pd-bank" name="bankName" invalid={!!fe.bankName} />
          </Field>
        )}
        <Field label="Name on the account" htmlFor="pd-name" error={fe.accountName}>
          <Input id="pd-name" name="accountName" autoComplete="off" invalid={!!fe.accountName} />
        </Field>
        <Field label={method === "BANK_TRANSFER" ? "Account number" : "Mobile number"} htmlFor="pd-number" error={fe.accountNumber} hint="Stored encrypted. Only the last four digits are shown again.">
          <Input id="pd-number" name="accountNumber" inputMode="numeric" autoComplete="off" invalid={!!fe.accountNumber} />
        </Field>
      </div>
      {state.error && !Object.keys(fe).length && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Payout details saved.</FormAlert>}
      <SubmitButton pendingText="Saving…" className="h-10">Save payout details</SubmitButton>
    </form>
  );
}

/** Withdraws the whole available balance. The server checks the minimum and that no request is already open. */
export function WithdrawButton({ available, disabledReason }: { available: string; disabledReason: string | null }) {
  const [state, action] = useActionState(requestWithdrawalAction, idle);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton variant="primary" pendingText="Requesting…" disabled={!!disabledReason}>Withdraw {available}</SubmitButton>
      {disabledReason && <p className="text-[12.5px] text-ink-500">{disabledReason}</p>}
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Withdrawal requested. Hirewise will review it and send the money.</FormAlert>}
    </form>
  );
}
