"use client";

import { useActionState } from "react";
import { payWithMayaAction } from "@/app/(app)/maya-actions";
import { idle } from "@/server/http/action-result";
import { SubmitButton, FormAlert } from "@/components/ui/Form";

/** Sends the learner to Maya's hosted checkout for a pending course payment. Unlocks automatically after Maya confirms. */
export function PayWithMayaButton({ enrollmentId, priceLabel }: { enrollmentId: string; priceLabel: string }) {
  const [state, action] = useActionState(payWithMayaAction, idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <SubmitButton variant="primary" pendingText="Opening Maya…">Pay {priceLabel} with Maya</SubmitButton>
      <p className="text-[12.5px] text-ink-500">Cards, Maya, and QR Ph. The course unlocks as soon as Maya confirms your payment.</p>
      {state.error && <FormAlert>{state.error}</FormAlert>}
    </form>
  );
}
