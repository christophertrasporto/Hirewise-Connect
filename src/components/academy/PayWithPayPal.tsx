"use client";

import { useActionState } from "react";
import { payWithPayPalAction } from "@/app/(app)/paypal-actions";
import { idle } from "@/server/http/action-result";
import { SubmitButton, FormAlert } from "@/components/ui/Form";

/** Sends the learner to PayPal to approve a pending course payment. Unlocks automatically once PayPal confirms it. */
export function PayWithPayPalButton({ enrollmentId, priceLabel }: { enrollmentId: string; priceLabel: string }) {
  const [state, action] = useActionState(payWithPayPalAction, idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <SubmitButton variant="outline" pendingText="Opening PayPal…">Pay {priceLabel} with PayPal</SubmitButton>
      <p className="text-[12.5px] text-ink-500">PayPal balance or card. The course unlocks as soon as PayPal confirms your payment.</p>
      {state.error && <FormAlert>{state.error}</FormAlert>}
    </form>
  );
}
