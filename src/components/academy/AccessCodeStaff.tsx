"use client";

import { useActionState } from "react";
import { createAccessCodeAction, voidAccessCodeAction } from "@/app/(app)/access-code-actions";
import { idle } from "@/server/http/action-result";
import { Field, FormAlert, Input, Select, SubmitButton } from "@/components/ui/Form";

/** Staff: issue a one-time code for a course after confirming the buyer's bank or GCash payment. */
export function AccessCodeForm({ courses }: { courses: Array<{ id: string; title: string; priceLabel: string }> }) {
  const [state, action] = useActionState(createAccessCodeAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Course" htmlFor="ac-course" error={fe.courseId}>
          <Select id="ac-course" name="courseId" defaultValue="" invalid={!!fe.courseId}>
            <option value="" disabled>Choose a paid course…</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title} · {c.priceLabel}</option>)}
          </Select>
        </Field>
        <Field label="Payment reference" htmlFor="ac-ref" error={fe.paymentReference} hint="The bank or GCash reference you checked. It is recorded as the payment reference.">
          <Input id="ac-ref" name="paymentReference" invalid={!!fe.paymentReference} />
        </Field>
        <Field label="Buyer's email (recommended)" htmlFor="ac-email" error={fe.buyerEmail} hint="If set, only the account with this email can use the code.">
          <Input id="ac-email" name="buyerEmail" type="email" invalid={!!fe.buyerEmail} />
        </Field>
        <Field label="Valid for (days)" htmlFor="ac-days" error={fe.expiresInDays}>
          <Input id="ac-days" name="expiresInDays" type="number" min={1} max={365} defaultValue={30} invalid={!!fe.expiresInDays} />
        </Field>
      </div>
      <Field label="Note (optional)" htmlFor="ac-note" error={fe.note}>
        <Input id="ac-note" name="note" maxLength={200} />
      </Field>
      <SubmitButton variant="primary" pendingText="Creating…">Create access code</SubmitButton>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && state.data && (
        <FormAlert tone="success">
          Code for {state.data.courseTitle}: <strong className="select-all font-mono text-[15px]">{state.data.code}</strong>. Send it to the buyer. It is also in the list below.
        </FormAlert>
      )}
    </form>
  );
}

export function VoidCodeForm({ id }: { id: string }) {
  const [state, action] = useActionState(voidAccessCodeAction, idle);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="reason" placeholder="Reason" aria-label="Reason for voiding" className="h-9 w-40 text-[13px]" />
      <SubmitButton variant="outline" pendingText="Voiding…" className="h-9 text-[13px]">Void</SubmitButton>
      {state.error && <span className="text-[12.5px] text-red-600">{state.error}</span>}
    </form>
  );
}
