"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { decideDuplicateFlagAction } from "@/app/(app)/identity-actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, SubmitButton, FormAlert } from "@/components/ui/Form";
import type { DuplicateFlagView } from "@/server/views/identity.views";
import { fmtDate } from "@/components/app/ui";

const REASON_LABEL: Record<string, string> = {
  EMAIL: "same email",
  PHONE: "same phone number",
  IDENTITY: "matches an existing platform identity",
  ACTIVE_MEMBERSHIP: "that identity has an active agency membership",
  INDEPENDENT_PROFILE: "that identity has an independent profile",
};

/** One flagged sign-up with the three decisions. Nothing here creates an account; approval emails a continuation link. */
export function DuplicateFlagCard({ flag }: { flag: DuplicateFlagView }) {
  const [state, action] = useActionState(decideDuplicateFlagAction, idle);
  const [decision, setDecision] = useState<"APPROVED_NEW_PROFILE" | "LINKED" | "REJECTED" | null>(null);
  const open = flag.status === "OPEN" && !state.ok;
  return (
    <article className="rounded-3xl border border-ink-100 bg-white p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-400">{flag.kind.toLowerCase().replace(/_/g, " ")} · {fmtDate(flag.createdAt)}</p>
          <h3 className="text-[16px] font-bold text-ink-900">{flag.attemptedName} <span className="font-normal text-ink-500">· {flag.attemptedEmail}{flag.attemptedPhone ? ` · ${flag.attemptedPhone}` : ""}</span></h3>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold uppercase tracking-wide ${flag.status === "OPEN" ? "bg-gold-50 text-gold-800" : flag.status === "REJECTED" ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-700"}`}>{state.ok ? state.data?.status.replace(/_/g, " ") : flag.status.replace(/_/g, " ")}</span>
      </div>
      <ul className="mt-3 space-y-1 text-[13.5px] text-ink-700">
        {flag.matchReasons.map((r) => <li key={r}>• {REASON_LABEL[r] ?? r}</li>)}
      </ul>
      {flag.matched && (
        <p className="mt-2 text-[13px] text-ink-600">
          Matched account: <span className="font-semibold">{flag.matched.email ?? flag.matched.userId}</span>{flag.matched.role ? ` (${flag.matched.role.toLowerCase().replace(/_/g, " ")})` : ""}
          {flag.matched.identityId && <> · <Link href={`/staff/identity/${flag.matched.identityId}`} className="font-semibold text-brand-700 hover:underline">Open identity</Link></>}
        </p>
      )}
      {flag.attemptedSummary.length > 0 && <p className="mt-2 text-[12.5px] text-ink-400">Attempted details: {flag.attemptedSummary.join(" · ")}</p>}
      {!open && (flag.reviewedAt || state.ok) && <p className="mt-3 text-[12.5px] text-ink-400">{flag.reviewedBy ? `Decided by ${flag.reviewedBy}` : "Decided"}{flag.reviewedAt ? ` on ${fmtDate(flag.reviewedAt)}` : ""}{flag.decisionNote ? ` · ${flag.decisionNote}` : ""}{flag.continuationIssued ? " · continuation link emailed" : ""}</p>}
      {open && (
        <div className="mt-4 space-y-3 rounded-2xl border border-ink-100 bg-ink-50/60 p-4">
          <p className="text-[13px] font-semibold text-ink-700">Decision</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setDecision("APPROVED_NEW_PROFILE")} className={`rounded-full px-4 py-1.5 text-[13.5px] font-semibold ${decision === "APPROVED_NEW_PROFILE" ? "bg-brand-600 text-white" : "bg-white text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50"}`}>Approve new profile</button>
            <button type="button" onClick={() => setDecision("LINKED")} className={`rounded-full px-4 py-1.5 text-[13.5px] font-semibold ${decision === "LINKED" ? "bg-ink-900 text-white" : "bg-white text-ink-700 ring-1 ring-inset ring-ink-200 hover:bg-ink-50"}`}>Linked to existing</button>
            <button type="button" onClick={() => setDecision("REJECTED")} className={`rounded-full px-4 py-1.5 text-[13.5px] font-semibold ${decision === "REJECTED" ? "bg-red-600 text-white" : "bg-white text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50"}`}>Reject</button>
          </div>
          {decision && (
            <form action={action} className="space-y-3" noValidate>
              <input type="hidden" name="flagId" value={flag.id} />
              <input type="hidden" name="decision" value={decision} />
              <p className="text-[13px] text-ink-600">
                {decision === "APPROVED_NEW_PROFILE" && "Emails the person a one-time link to finish the same sign-up without the duplicate check. Use it when this is a different person."}
                {decision === "LINKED" && "Emails the existing address a reminder to sign in. No new account is created."}
                {decision === "REJECTED" && "Closes the case. No email is sent."}
              </p>
              <Field label="Note (audited, optional)" htmlFor={`note-${flag.id}`}><Input id={`note-${flag.id}`} name="note" className="h-10 text-[13.5px]" /></Field>
              {state.error && <FormAlert>{state.error}</FormAlert>}
              <div className="flex gap-2">
                <SubmitButton pendingText="Saving…" variant={decision === "REJECTED" ? "danger" : "dark"} className="h-10 text-[13.5px]">Confirm</SubmitButton>
                <button type="button" onClick={() => setDecision(null)} className="text-[13.5px] font-semibold text-ink-500 hover:text-ink-800">Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}
      {state.ok && <div className="mt-3"><FormAlert tone="success">Decision recorded.</FormAlert></div>}
    </article>
  );
}
