"use client";

import { useActionState } from "react";
import { saveDepositPolicyAction } from "@/app/(app)/commercial-actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Select, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";

type Policy = { id?: string; name: string; type: string; value: number; currency: string | null; isDefault: boolean; isActive: boolean };

export function DepositPolicyForm({ p }: { p?: Policy }) {
  const [state, action] = useActionState(saveDepositPolicyAction, idle);
  const fe = state.fieldErrors ?? {};
  const k = p?.id ?? "new";
  const value = p ? (p.type === "PERCENTAGE" ? (p.value / 100).toString() : (p.value / 100).toFixed(2)) : "";
  return (
    <form action={action} className="space-y-3" noValidate>
      {p?.id && <input type="hidden" name="id" value={p.id} />}
      <div className="grid gap-3 sm:grid-cols-[1fr_180px_140px_90px]">
        <Field label="Name" htmlFor={`n-${k}`} error={fe.name}><Input id={`n-${k}`} name="name" defaultValue={p?.name ?? ""} className="h-10 text-[14px]" /></Field>
        <Field label="Type" htmlFor={`t-${k}`} error={fe.type}><Select id={`t-${k}`} name="type" defaultValue={p?.type ?? "ONE_MONTH"} className="h-10 text-[14px]"><option value="ONE_MONTH">One month</option><option value="TWO_WEEKS">Two weeks</option><option value="FIXED">Fixed amount</option><option value="PERCENTAGE">% of a month</option><option value="CUSTOM">Custom at approval</option></Select></Field>
        <Field label="Value" htmlFor={`v-${k}`} error={fe.value} hint="USD for fixed; percent for %"><Input id={`v-${k}`} name="value" defaultValue={value} className="h-10 text-[14px]" /></Field>
        <Field label="Currency" htmlFor={`c-${k}`} error={fe.currency}><Input id={`c-${k}`} name="currency" defaultValue={p?.currency ?? ""} placeholder="USD" className="h-10 text-[14px] uppercase" /></Field>
      </div>
      <div className="flex gap-4"><Checkbox name="isDefault" defaultChecked={p?.isDefault ?? false} label="Default policy" /><Checkbox name="isActive" defaultChecked={p?.isActive ?? true} label="Active" /></div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Saved.</FormAlert>}
      <SubmitButton variant="outline" pendingText="Saving…" className="h-9 text-[13px]">{p ? "Save policy" : "Create policy"}</SubmitButton>
    </form>
  );
}
