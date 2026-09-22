"use client";

import { useActionState } from "react";
import { reservationAction } from "@/app/(app)/actions";
import { idle } from "@/server/http/action-result";
import { Input, Select, SubmitButton, FormAlert } from "@/components/ui/Form";

export function ReserveForm({ agentProfileId, clients }: { agentProfileId: string; clients: Array<{ id: string; companyName: string }> }) {
  const [state, action] = useActionState(reservationAction, idle);
  if (state.ok) return <FormAlert tone="success">Reserved. The hold expires automatically unless extended.</FormAlert>;
  return (
    <form action={action} className="space-y-2.5" noValidate>
      <input type="hidden" name="op" value="RESERVE" />
      <input type="hidden" name="agentProfileId" value={agentProfileId} />
      <Select name="clientId" defaultValue="" required className="h-10 text-[13.5px]" aria-label="Client">
        <option value="" disabled>Reserve for client…</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
      </Select>
      <Input name="reason" placeholder="Reason (e.g. verbal commitment on call)" className="h-10 text-[13.5px]" />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant="outline" pendingText="Reserving…" className="h-9 text-[13px]">Reserve candidate</SubmitButton>
    </form>
  );
}

export function ReservationRowActions({ reservationId }: { reservationId: string }) {
  const [state, action] = useActionState(reservationAction, idle);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={action}>
        <input type="hidden" name="op" value="EXTEND" />
        <input type="hidden" name="reservationId" value={reservationId} />
        <SubmitButton variant="outline" pendingText="…" className="h-8 px-3 text-[12.5px]">Extend</SubmitButton>
      </form>
      <form action={action}>
        <input type="hidden" name="op" value="RELEASE" />
        <input type="hidden" name="reservationId" value={reservationId} />
        <SubmitButton variant="danger" pendingText="…" className="h-8 px-3 text-[12.5px]">Release</SubmitButton>
      </form>
      {state.error && <span className="text-[12px] text-red-600">{state.error}</span>}
    </div>
  );
}
