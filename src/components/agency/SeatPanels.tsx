"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, RefreshCw, Check } from "lucide-react";
import { requestSeatsAction, purchasePackageAction, rotateInviteLinkAction, sendEmailInvitesAction, revokeEmailInviteAction, joinAgencyAction } from "@/app/(app)/seat-actions";
import { idle } from "@/server/http/action-result";
import { Field, FormAlert, Input, Select, SubmitButton, Textarea } from "@/components/ui/Form";
import type { PackageView } from "@/server/views/seat.views";

/** Owner: ask Hirewise for more seats. */
export function SeatRequestForm({ disabled }: { disabled: boolean }) {
  const [state, action] = useActionState(requestSeatsAction, idle);
  const fe = state.fieldErrors ?? {};
  if (state.ok) return <FormAlert tone="success">Request sent. Hirewise will review it and you will be notified.</FormAlert>;
  return (
    <form action={action} className="space-y-3" noValidate>
      <fieldset disabled={disabled} className="space-y-3 disabled:opacity-60">
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <Field label="Seats needed" htmlFor="sr-n" error={fe.requestedSeats}><Input id="sr-n" name="requestedSeats" type="number" min={1} max={500} defaultValue={5} className="h-10 text-[14px]" /></Field>
          <Field label="Why (optional)" htmlFor="sr-note" error={fe.note}><Input id="sr-note" name="note" placeholder="e.g. New solar campaign starting next month" className="h-10 text-[14px]" /></Field>
        </div>
        {state.error && <FormAlert>{state.error}</FormAlert>}
        <SubmitButton pendingText="Sending…" variant="outline" className="h-10 text-[13.5px]">Request Additional Seats</SubmitButton>
      </fieldset>
    </form>
  );
}

/** Owner: buy a seat package. Hirewise records the payment; seats are added when it does. */
export function BuySeatsForm({ packages, disabled }: { packages: PackageView[]; disabled: boolean }) {
  const [state, action] = useActionState(purchasePackageAction, idle);
  if (state.ok) return <FormAlert tone="success">Purchase requested. Hirewise will confirm the payment and the seats will appear here.</FormAlert>;
  if (packages.length === 0) return <p className="text-[13.5px] text-ink-500">No seat packages are available yet.</p>;
  return (
    <form action={action} className="space-y-3" noValidate>
      <fieldset disabled={disabled} className="space-y-3 disabled:opacity-60">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
          <Field label="Package" htmlFor="bp-pkg"><Select id="bp-pkg" name="packageId">{packages.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.priceLabel}</option>)}</Select></Field>
          <Field label="Note for Hirewise (optional)" htmlFor="bp-note"><Input id="bp-note" name="note" className="h-10 text-[14px]" /></Field>
        </div>
        {state.error && <FormAlert>{state.error}</FormAlert>}
        <SubmitButton pendingText="Requesting…" className="h-10 text-[13.5px]">Add More Seats</SubmitButton>
      </fieldset>
    </form>
  );
}

/** Owner: the unique invitation link and email invites. */
export function InviteTools({ link, invitable, disabled, invites }: { link: { url: string; label: string; uses: number } | null; invitable: number; disabled: boolean; invites: Array<{ id: string; email: string; status: string; expiresAt: Date; expired: boolean }> }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [rotate, rotateAction] = useActionState(rotateInviteLinkAction, idle);
  const [send, sendAction] = useActionState(sendEmailInvitesAction, idle);
  const url = rotate.ok && rotate.data ? rotate.data.url : link?.url ?? "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the field stays selectable */
    }
  };
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-ink-100 bg-ink-50/60 p-4">
        <p className="text-[13.5px] font-semibold text-ink-900">Your agency invitation link</p>
        <p className="mt-0.5 text-[12.5px] text-ink-500">{link?.label ?? "Join your agency on Hirewise Connect"}. Anyone who signs up from it joins your team and takes one Agent Seat. Rotate it if it leaks; the old link stops working.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-10 min-w-0 flex-1 rounded-xl border border-ink-200 bg-white px-3 font-mono text-[12.5px] text-ink-700" aria-label="Invitation link" />
          <button type="button" onClick={copy} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink-900 px-3 text-[13px] font-semibold text-white hover:bg-ink-800">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}</button>
          <form action={rotateAction}><SubmitButton variant="outline" pendingText="Rotating…" className="h-10 text-[13px]" disabled={disabled}><RefreshCw className="h-4 w-4" /> Rotate</SubmitButton></form>
        </div>
        {link && <p className="mt-2 text-[12px] text-ink-400">Used {link.uses} time{link.uses === 1 ? "" : "s"}.</p>}
        {rotate.error && <div className="mt-2"><FormAlert>{rotate.error}</FormAlert></div>}
      </div>

      <form action={sendAction} className="space-y-3" noValidate>
        <Field label="Invite by email" htmlFor="inv-emails" hint={invitable > 0 ? `${invitable} seat${invitable === 1 ? "" : "s"} available for invites. Open invites reserve a seat until they are accepted, revoked, or expire.` : "No Available Agent Seats. Add more seats before inviting."} error={send.fieldErrors?.emails}>
          <Textarea id="inv-emails" name="emails" rows={3} placeholder="one@example.com, two@example.com" disabled={disabled || invitable <= 0} />
        </Field>
        {send.error && <FormAlert>{send.error}</FormAlert>}
        {send.ok && send.data && (
          <FormAlert tone={send.data.skipped.length ? "info" : "success"}>
            {send.data.sent.length ? `Invited ${send.data.sent.join(", ")}.` : "No new invites were sent."}
            {send.data.skipped.length ? ` Skipped: ${send.data.skipped.map((s) => `${s.email} (${s.reason})`).join("; ")}.` : ""}
          </FormAlert>
        )}
        <SubmitButton pendingText="Sending…" className="h-10 text-[13.5px]" disabled={disabled || invitable <= 0}>Send invites</SubmitButton>
      </form>

      {invites.length > 0 && (
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Email invites</p>
          <ul className="mt-2 divide-y divide-ink-100 text-[13.5px]">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-ink-800">{i.email} <span className="text-ink-400">· {i.expired ? "expired" : i.status.toLowerCase()}{i.status === "PENDING" && !i.expired ? ` · expires ${new Date(i.expiresAt).toLocaleDateString()}` : ""}</span></span>
                {i.status === "PENDING" && !i.expired && !disabled && <RevokeInviteButton id={i.id} onDone={() => router.refresh()} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RevokeInviteButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [state, action] = useActionState(revokeEmailInviteAction, idle);
  if (state.ok) {
    onDone();
    return <span className="text-[12.5px] text-ink-400">Revoked</span>;
  }
  return (
    <form action={action}>
      <input type="hidden" name="inviteId" value={id} />
      <button type="submit" className="text-[12.5px] font-semibold text-red-600 hover:text-red-700">Revoke</button>
      {state.error && <span className="ml-2 text-[12px] text-red-600">{state.error}</span>}
    </form>
  );
}

/** The join page for a signed-in talent account. */
export function JoinButton({ token, agencyName }: { token: string; agencyName: string }) {
  const [state, action] = useActionState(joinAgencyAction, idle);
  const router = useRouter();
  if (state.ok) {
    setTimeout(() => router.push("/dashboard"), 600);
    return <FormAlert tone="success">You joined {agencyName}. Taking you to your dashboard…</FormAlert>;
  }
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton pendingText="Joining…">Join {agencyName}</SubmitButton>
    </form>
  );
}
