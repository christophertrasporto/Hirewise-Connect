"use client";

import { useActionState, useState } from "react";
import { purchaseCourseSeatsAction, assignCourseAction, recordCoursePurchaseAction, recordIndependentAccessAction, applyIndependentAction } from "@/app/(app)/training-actions";
import { idle } from "@/server/http/action-result";
import { Field, FormAlert, Input, Select, SubmitButton } from "@/components/ui/Form";
import { TermsCheckbox, type TermsBundleProp } from "@/components/terms/TermsDrawer";
import type { CourseCatalogView } from "@/server/views/training.views";

/** Owner: buy Course Seats for one course. Hirewise records the payment; free courses need no purchase. */
export function BuyCourseSeatsForm({ course, disabled }: { course: CourseCatalogView; disabled: boolean }) {
  const [state, action] = useActionState(purchaseCourseSeatsAction, idle);
  const fe = state.fieldErrors ?? {};
  if (state.ok) return <FormAlert tone="success">Purchase requested. Hirewise will confirm the payment and the seats will appear here.</FormAlert>;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="courseId" value={course.id} />
      <Field label="Course seats" htmlFor={`cs-${course.id}`} error={fe.seatCount} className="w-[120px]"><Input id={`cs-${course.id}`} name="seatCount" type="number" min={1} max={500} defaultValue={5} className="h-10 text-[14px]" disabled={disabled} /></Field>
      <Field label="Note (optional)" htmlFor={`cn-${course.id}`} className="min-w-[200px] flex-1"><Input id={`cn-${course.id}`} name="note" className="h-10 text-[14px]" disabled={disabled} /></Field>
      <SubmitButton pendingText="Requesting…" variant="outline" className="h-10 text-[13.5px]" disabled={disabled}>Buy course seats</SubmitButton>
      {state.error && <div className="basis-full"><FormAlert>{state.error}</FormAlert></div>}
    </form>
  );
}

/** Owner: give a member a Course Seat (creates an agency-sponsored enrollment). */
export function AssignCourseForm({ course, members, disabled }: { course: CourseCatalogView; members: Array<{ agentProfileId: string; displayName: string }>; disabled: boolean }) {
  const [state, action] = useActionState(assignCourseAction, idle);
  if (state.ok) return <FormAlert tone="success">Assigned. The member is enrolled and notified.</FormAlert>;
  if (members.length === 0) return <p className="text-[13px] text-ink-400">No active members to assign yet.</p>;
  const noSeats = course.priceCents > 0 && course.seatsAvailable === 0;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="courseId" value={course.id} />
      <Field label="Member" htmlFor={`am-${course.id}`} className="min-w-[220px] flex-1"><Select id={`am-${course.id}`} name="agentProfileId" disabled={disabled || noSeats}>{members.map((m) => <option key={m.agentProfileId} value={m.agentProfileId}>{m.displayName}</option>)}</Select></Field>
      <SubmitButton pendingText="Assigning…" className="h-10 text-[13.5px]" disabled={disabled || noSeats}>{noSeats ? "No Course Seats left" : "Assign course"}</SubmitButton>
      {state.error && <div className="basis-full"><FormAlert>{state.error}</FormAlert></div>}
    </form>
  );
}

/** Hirewise: record a course purchase or an independent access fee. */
export function RecordOutcomeForm({ kind, id }: { kind: "COURSE_PURCHASE" | "INDEPENDENT_ACCESS"; id: string }) {
  const [state, action] = useActionState(kind === "COURSE_PURCHASE" ? recordCoursePurchaseAction : recordIndependentAccessAction, idle);
  const fe = state.fieldErrors ?? {};
  if (state.ok && state.data) return <FormAlert tone="success">Recorded as {state.data.status.toLowerCase().replace(/_/g, " ")}.</FormAlert>;
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name={kind === "COURSE_PURCHASE" ? "purchaseId" : "accessId"} value={id} />
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Field label="Outcome" htmlFor={`ro-${id}`}><Select id={`ro-${id}`} name="outcome" defaultValue="PAID"><option value="PAID">Paid</option><option value="WAIVED">Waived</option><option value="CANCELLED">Cancelled</option></Select></Field>
        <Field label="Payment reference (required when paid)" htmlFor={`rr-${id}`} error={fe.reference}><Input id={`rr-${id}`} name="reference" className="h-10 text-[14px]" /></Field>
      </div>
      <Field label="Note (optional)" htmlFor={`rn-${id}`}><Input id={`rn-${id}`} name="note" className="h-10 text-[14px]" /></Field>
      {state.error && !fe.reference && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton pendingText="Saving…" className="h-10 text-[13.5px]">Record</SubmitButton>
    </form>
  );
}

/** Former agent: apply as an independent freelancer (fresh profile, terms re-accepted, fee when configured). */
export function ApplyIndependentForm({ terms, feeLabel, pending }: { terms: TermsBundleProp; feeLabel: string | null; pending: { amountLabel: string } | null }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(applyIndependentAction, idle);
  const fe = state.fieldErrors ?? {};
  if (pending) return <p className="rounded-2xl border border-gold-200 bg-gold-50 p-3 text-[13.5px] text-gold-900">Your independent access ({pending.amountLabel}) is waiting for Hirewise to record the fee. Your fresh profile opens as soon as it does.</p>;
  if (state.ok && state.data) return <FormAlert tone="success">{state.data.status === "ACTIVE" ? "Your fresh independent profile is ready. Reload to start your onboarding." : "Applied. Hirewise will record your access fee; your fresh profile opens as soon as it does."}</FormAlert>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="rounded-full bg-ink-900 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-ink-800">Apply as Independent Freelancer</button>;
  return (
    <form action={action} className="space-y-3 rounded-2xl border border-ink-100 bg-ink-50/60 p-4" noValidate>
      <p className="text-[13.5px] text-ink-700">You start fresh: a new profile, no agency-sponsored certifications, assessments, or course access. Your history stays with Hirewise only.{feeLabel ? ` The independent access fee is ${feeLabel}; Hirewise records it before your profile opens.` : ""}</p>
      <TermsCheckbox bundle={terms} error={fe.termsAccepted} />
      {state.error && !fe.termsAccepted && <FormAlert>{state.error}</FormAlert>}
      <div className="flex gap-2">
        <SubmitButton pendingText="Applying…" className="h-10 text-[13.5px]">Confirm</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="text-[13.5px] font-semibold text-ink-500 hover:text-ink-800">Cancel</button>
      </div>
    </form>
  );
}
