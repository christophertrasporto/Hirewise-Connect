"use client";

import { useActionState } from "react";
import { enrolAction } from "@/app/(app)/academy-actions";
import { idle } from "@/server/http/action-result";
import { SubmitButton, FormAlert } from "@/components/ui/Form";

export function EnrolButton({ courseId, priceLabel }: { courseId: string; priceLabel: string }) {
  const [state, action] = useActionState(enrolAction, idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="courseId" value={courseId} />
      <SubmitButton variant="primary" pendingText="Enrolling…">{priceLabel === "Free" ? "Enrol for free" : `Enrol · ${priceLabel}`}</SubmitButton>
      {state.error && <FormAlert>{state.error}</FormAlert>}
    </form>
  );
}
