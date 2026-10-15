"use client";

import { useActionState, useState } from "react";
import { adminSeatChangeAction, assignPlanAction, decideSeatRequestAction, recordSeatPurchaseAction, savePlanAction, savePackageAction } from "@/app/(app)/seat-actions";
import { idle } from "@/server/http/action-result";
import { Checkbox, Field, FormAlert, Input, Select, SubmitButton, Textarea } from "@/components/ui/Form";
import type { PlanView, PackageView } from "@/server/views/seat.views";

/** Hirewise: add, remove, grant, or override seats with a reason; removing below usage needs the override box. */
export function AdminSeatChangeForm({ agencyId }: { agencyId: string }) {
  const [state, action] = useActionState(adminSeatChangeAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="agencyId" value={agencyId} />
      <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
        <Field label="Change" htmlFor={`sc-type-${agencyId}`}>
          <Select id={`sc-type-${agencyId}`} name="changeType" defaultValue="ADMIN_ADD">
            <option value="ADMIN_ADD">Add seats</option>
            <option value="PROMO_GRANT">Grant promotional seats</option>
            <option value="ADMIN_REMOVE">Remove seats</option>
            <option value="OVERRIDE">Override limit (add)</option>
          </Select>
        </Field>
        <Field label="Quantity" htmlFor={`sc-q-${agencyId}`} error={fe.quantity}><Input id={`sc-q-${agencyId}`} name="quantity" type="number" min={1} max={10000} defaultValue={5} className="h-10 text-[14px]" /></Field>
      </div>
      <Field label="Reason (recorded in the ledger and the audit log)" htmlFor={`sc-r-${agencyId}`} error={fe.reason}><Input id={`sc-r-${agencyId}`} name="reason" className="h-10 text-[14px]" /></Field>
      <Checkbox name="override" label="Override: allow removing seats below current usage (agents are never removed automatically)" />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && state.data && <FormAlert tone="success">Done. {state.data.total} seat(s), {state.data.available} available.</FormAlert>}
      <SubmitButton pendingText="Saving…" className="h-10 text-[13.5px]">Apply change</SubmitButton>
    </form>
  );
}

export function AssignPlanForm({ agencyId, plans, currentKey }: { agencyId: string; plans: PlanView[]; currentKey: string | null }) {
  const [state, action] = useActionState(assignPlanAction, idle);
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="agencyId" value={agencyId} />
      <Field label="Plan" htmlFor={`pl-${agencyId}`}>
        <Select id={`pl-${agencyId}`} name="planKey" defaultValue={currentKey ?? ""}>
          <option value="">No plan</option>
          {plans.filter((p) => p.isActive).map((p) => <option key={p.key} value={p.key}>{p.name} · {p.baseAgentSeats === null ? "custom seats" : `${p.baseAgentSeats} seats`} · {p.priceLabel}</option>)}
        </Select>
      </Field>
      <Field label="Reason" htmlFor={`plr-${agencyId}`}><Input id={`plr-${agencyId}`} name="reason" className="h-10 text-[14px]" placeholder="e.g. Confirmed at approval" /></Field>
      <Checkbox name="override" label="Override: allow a plan with fewer seats than agents in use" />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && state.data && <FormAlert tone="success">Plan assigned. {state.data.total} seat(s), {state.data.available} available.</FormAlert>}
      <SubmitButton pendingText="Saving…" variant="outline" className="h-10 text-[13.5px]">Assign plan</SubmitButton>
    </form>
  );
}

export function SeatRequestDecisionForm({ requestId, requestedSeats }: { requestId: string; requestedSeats: number }) {
  const [state, action] = useActionState(decideSeatRequestAction, idle);
  const [decision, setDecision] = useState<"APPROVE" | "REJECT" | null>(null);
  if (state.ok && state.data) return <FormAlert tone="success">{state.data.status === "APPROVED" ? "Approved and seats added." : "Rejected."}</FormAlert>;
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button type="button" onClick={() => setDecision("APPROVE")} className={`rounded-full px-4 py-1.5 text-[13.5px] font-semibold ${decision === "APPROVE" ? "bg-brand-600 text-white" : "bg-white text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50"}`}>Approve</button>
        <button type="button" onClick={() => setDecision("REJECT")} className={`rounded-full px-4 py-1.5 text-[13.5px] font-semibold ${decision === "REJECT" ? "bg-red-600 text-white" : "bg-white text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50"}`}>Reject</button>
      </div>
      {decision && (
        <form action={action} className="space-y-3" noValidate>
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="decision" value={decision} />
          {decision === "APPROVE" && <Field label="Seats to add" htmlFor={`gr-${requestId}`} hint={`Requested ${requestedSeats}.`}><Input id={`gr-${requestId}`} name="grantedSeats" type="number" min={1} max={10000} defaultValue={requestedSeats} className="h-10 w-[140px] text-[14px]" /></Field>}
          <Field label="Note to the owner (optional)" htmlFor={`gn-${requestId}`}><Input id={`gn-${requestId}`} name="note" className="h-10 text-[14px]" /></Field>
          {state.error && <FormAlert>{state.error}</FormAlert>}
          <div className="flex gap-2">
            <SubmitButton pendingText="Saving…" variant={decision === "REJECT" ? "danger" : "dark"} className="h-10 text-[13.5px]">Confirm</SubmitButton>
            <button type="button" onClick={() => setDecision(null)} className="text-[13.5px] font-semibold text-ink-500 hover:text-ink-800">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function SeatPurchaseRecordForm({ purchaseId }: { purchaseId: string }) {
  const [state, action] = useActionState(recordSeatPurchaseAction, idle);
  const fe = state.fieldErrors ?? {};
  if (state.ok && state.data) return <FormAlert tone="success">Recorded as {state.data.status.toLowerCase()}.</FormAlert>;
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="purchaseId" value={purchaseId} />
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Field label="Outcome" htmlFor={`po-${purchaseId}`}><Select id={`po-${purchaseId}`} name="outcome" defaultValue="PAID"><option value="PAID">Paid</option><option value="WAIVED">Waived</option><option value="CANCELLED">Cancelled</option></Select></Field>
        <Field label="Payment reference (required when paid)" htmlFor={`pr-${purchaseId}`} error={fe.reference}><Input id={`pr-${purchaseId}`} name="reference" className="h-10 text-[14px]" /></Field>
      </div>
      <Field label="Note (optional)" htmlFor={`pn-${purchaseId}`}><Input id={`pn-${purchaseId}`} name="note" className="h-10 text-[14px]" /></Field>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton pendingText="Saving…" className="h-10 text-[13.5px]">Record</SubmitButton>
    </form>
  );
}

export function PlanForm({ plan }: { plan: PlanView | null }) {
  const [state, action] = useActionState(savePlanAction, idle);
  const fe = state.fieldErrors ?? {};
  const k = plan?.key ?? "new";
  return (
    <form action={action} className="space-y-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Key" htmlFor={`pk-${k}`} error={fe.key}><Input id={`pk-${k}`} name="key" defaultValue={plan?.key ?? ""} readOnly={!!plan} className="h-10 text-[14px] font-mono" placeholder="STARTER" /></Field>
        <Field label="Name" htmlFor={`pnm-${k}`} error={fe.name}><Input id={`pnm-${k}`} name="name" defaultValue={plan?.name ?? ""} className="h-10 text-[14px]" /></Field>
        <Field label="Base agent seats (blank = custom)" htmlFor={`pb-${k}`} error={fe.baseAgentSeats}><Input id={`pb-${k}`} name="baseAgentSeats" type="number" min={0} defaultValue={plan?.baseAgentSeats ?? ""} className="h-10 text-[14px]" /></Field>
        <Field label="Price" htmlFor={`pp-${k}`} error={fe.priceMinor}><Input id={`pp-${k}`} name="price" type="number" min={0} step="0.01" defaultValue={plan ? (plan.priceMinor / 100).toFixed(2) : "0.00"} className="h-10 text-[14px]" /></Field>
        <Field label="Currency" htmlFor={`pc-${k}`} error={fe.currency}><Input id={`pc-${k}`} name="currency" defaultValue={plan?.currency ?? "USD"} maxLength={3} className="h-10 text-[14px] uppercase" /></Field>
        <Field label="Billing period" htmlFor={`pbp-${k}`}><Select id={`pbp-${k}`} name="billingPeriod" defaultValue={plan?.billingPeriod ?? "MONTHLY"}><option value="MONTHLY">Monthly</option><option value="ANNUAL">Annual</option></Select></Field>
        <Field label="Sort order" htmlFor={`ps-${k}`}><Input id={`ps-${k}`} name="sortOrder" type="number" min={0} defaultValue={plan?.sortOrder ?? 0} className="h-10 text-[14px]" /></Field>
      </div>
      <Field label="Features (one per line)" htmlFor={`pf-${k}`}><Textarea id={`pf-${k}`} name="features" rows={3} defaultValue={plan?.features.join("\n") ?? ""} /></Field>
      <div className="flex flex-wrap gap-4">
        <Checkbox name="trainingAccess" defaultChecked={plan?.trainingAccess ?? true} label="Training access" />
        <Checkbox name="opportunityAccess" defaultChecked={plan?.opportunityAccess ?? true} label="Opportunity access" />
        <Checkbox name="isActive" defaultChecked={plan?.isActive ?? true} label="Active" />
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Saved.</FormAlert>}
      <SubmitButton pendingText="Saving…" variant="outline" className="h-10 text-[13.5px]">{plan ? "Save plan" : "Create plan"}</SubmitButton>
    </form>
  );
}

export function PackageForm({ pkg }: { pkg: PackageView | null }) {
  const [state, action] = useActionState(savePackageAction, idle);
  const fe = state.fieldErrors ?? {};
  const k = pkg?.id ?? "new";
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="id" value={pkg?.id ?? ""} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Name" htmlFor={`kn-${k}`} error={fe.name} className="sm:col-span-2"><Input id={`kn-${k}`} name="name" defaultValue={pkg?.name ?? ""} className="h-10 text-[14px]" /></Field>
        <Field label="Seats" htmlFor={`ks-${k}`} error={fe.seatCount}><Input id={`ks-${k}`} name="seatCount" type="number" min={1} defaultValue={pkg?.seatCount ?? 5} className="h-10 text-[14px]" /></Field>
        <Field label="Price" htmlFor={`kp-${k}`} error={fe.priceMinor}><Input id={`kp-${k}`} name="price" type="number" min={0} step="0.01" defaultValue={pkg ? (pkg.priceMinor / 100).toFixed(2) : "0.00"} className="h-10 text-[14px]" /></Field>
        <Field label="Currency" htmlFor={`kc-${k}`}><Input id={`kc-${k}`} name="currency" defaultValue={pkg?.currency ?? "USD"} maxLength={3} className="h-10 text-[14px] uppercase" /></Field>
        <Field label="Sort order" htmlFor={`ko-${k}`}><Input id={`ko-${k}`} name="sortOrder" type="number" min={0} defaultValue={pkg?.sortOrder ?? 0} className="h-10 text-[14px]" /></Field>
      </div>
      <Checkbox name="isActive" defaultChecked={pkg?.isActive ?? true} label="Active" />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Saved.</FormAlert>}
      <SubmitButton pendingText="Saving…" variant="outline" className="h-10 text-[13.5px]">{pkg ? "Save package" : "Create package"}</SubmitButton>
    </form>
  );
}
