"use client";

import { useActionState, useState } from "react";
import { redeemAccessCodeAction } from "@/app/(app)/access-code-actions";
import { idle } from "@/server/http/action-result";
import { FormAlert, Input, SubmitButton } from "@/components/ui/Form";

/** "Have an access code?" Hirewise gives one after confirming a bank or GCash payment; entering it opens the course. */
export function AccessCodeBox({ courseId, defaultOpen = false }: { courseId: string; defaultOpen?: boolean }) {
  const [state, action] = useActionState(redeemAccessCodeAction, idle);
  const [open, setOpen] = useState(defaultOpen);
  if (state.ok) return <FormAlert tone="success">Access code accepted. Your course is open.</FormAlert>;
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="text-[13.5px] font-semibold text-brand-700 hover:text-brand-800">Have an access code?</button>;
  }
  return (
    <form action={action} className="max-w-sm space-y-2">
      <input type="hidden" name="courseId" value={courseId} />
      <label htmlFor={`access-code-${courseId}`} className="block text-[13px] font-semibold text-ink-700">Access code</label>
      <div className="flex gap-2">
        <Input id={`access-code-${courseId}`} name="code" autoComplete="off" spellCheck={false} placeholder="HW-XXXX-XXXX" className="h-10 uppercase" />
        <SubmitButton variant="primary" pendingText="Checking…" className="h-10 shrink-0 px-4 text-[13.5px]">Open course</SubmitButton>
      </div>
      <p className="text-[12.5px] text-ink-500">Paid by bank transfer or GCash? Hirewise sends you a code once the payment is confirmed.</p>
      {state.error && <FormAlert>{state.error}</FormAlert>}
    </form>
  );
}
