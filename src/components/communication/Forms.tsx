"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Send, ShieldAlert, Flag, UploadCloud, FileText, Loader2, EyeOff } from "lucide-react";
import { postToThreadAction, reportBypassAction, decideBypassAction, bypassEvidenceUploadUrlAction, attachBypassEvidenceAction, bypassEvidenceUrlAction, type PostResult } from "@/app/(app)/communication-actions";
import { idle, type ActionResult } from "@/server/http/action-result";
import { Field, Textarea, Input, Select, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";
import { StatusBadge, fmtDate } from "@/components/app/ui";
import type { MessageView, ThreadAudience } from "@/server/views/thread.views";
import { cn } from "@/lib/cn";

/** One mediated thread. Clients, talent, and Partner Teams write to Hirewise; staff choose who sees each message. */
export function ThreadPanel({ threadId, messages, audience, closed }: { threadId: string; messages: MessageView[]; audience: ThreadAudience; closed: boolean }) {
  const [state, action] = useActionState(postToThreadAction, idle as ActionResult<PostResult>);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return (
    <div>
      <div className="max-h-[480px] space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 && <p className="text-[13.5px] text-ink-400">No messages yet. {audience === "STAFF" ? "Reply here; choose who sees it." : "Hirewise is in this conversation and relays what is needed."}</p>}
        {messages.map((m) => (
          <div key={m.id} className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed", m.mine ? "ml-auto bg-ink-900 text-white" : ["CLIENT", "AGENT", "AGENCY_OWNER", "AGENCY_MANAGER"].includes(m.authorRole) ? "bg-ink-100 text-ink-800" : "bg-brand-50 text-ink-800 ring-1 ring-inset ring-brand-200")}>
            <div className={cn("mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider", m.mine ? "text-ink-300" : "text-ink-400")}>
              <span>{m.mine ? "You" : m.authorLabel}</span>
              <span>{new Date(m.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              {audience === "STAFF" && <span className="rounded-full bg-white/60 px-1.5 text-[10px] text-ink-500">{m.visibleTo.toLowerCase().replace(/_/g, " ")}</span>}
              {m.masked && <span className="inline-flex items-center gap-1 rounded-full bg-gold-100 px-1.5 text-[10px] text-gold-700"><EyeOff className="h-3 w-3" /> contact details removed</span>}
              {m.heldForReview && !m.blocked && <span className="inline-flex items-center gap-1 rounded-full bg-gold-100 px-1.5 text-[10px] text-gold-700"><ShieldAlert className="h-3 w-3" /> held for review</span>}
              {m.blocked && <span className="rounded-full bg-red-100 px-1.5 text-[10px] text-red-700">blocked</span>}
            </div>
            <p className="whitespace-pre-line">{m.body}</p>
            {m.originalBody && <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-[12.5px] text-ink-600"><span className="font-semibold">As typed (Hirewise only):</span> {m.originalBody}</p>}
          </div>
        ))}
      </div>
      {!closed && (
        <form ref={form} action={action} className="mt-4 space-y-2.5" noValidate>
          <input type="hidden" name="threadId" value={threadId} />
          <Textarea name="body" rows={3} required placeholder={audience === "STAFF" ? "Message…" : "Message to Hirewise"} className="min-h-0 text-[14px]" />
          <div className="flex flex-wrap items-center gap-3">
            {audience === "STAFF" && (
              <Select name="visibleTo" defaultValue="ALL" className="h-9 w-auto text-[13px]" aria-label="Visible to">
                <option value="ALL">Everyone in the thread</option>
                <option value="CLIENT_AND_HIREWISE">Client only</option>
                <option value="AGENT_AND_HIREWISE">Candidates only</option>
                <option value="AGENCY_AND_HIREWISE">Partner Team only</option>
                <option value="HIREWISE_ONLY">Hirewise only (internal)</option>
              </Select>
            )}
            <SubmitButton variant="dark" pendingText="Sending…" className="h-9 text-[13px]"><Send className="h-3.5 w-3.5" /> Send</SubmitButton>
          </div>
          {state.ok && state.data?.masked && <FormAlert tone="info">Contact details were removed before delivery ({state.data.reasons.join(", ")}). All coordination goes through Hirewise; a flag was recorded.</FormAlert>}
          {state.ok && state.data?.held && <FormAlert tone="info">Your message is pending Hirewise review because it appears to include contact details ({state.data.reasons.join(", ")}).</FormAlert>}
          {state.error && <FormAlert>{state.error}</FormAlert>}
          {audience !== "STAFF" && <p className="text-[12px] text-ink-400">Keep contact details, links, and rate discussions out of this thread. Hirewise handles scheduling, pricing, and contracts.</p>}
        </form>
      )}
      {closed && <p className="mt-3 text-[12.5px] text-ink-400">This conversation is closed.</p>}
    </div>
  );
}

/** "Report Direct Contact / Bypass Attempt" for clients, talent, agency users, and staff. */
export function ReportBypassForm({ reportedUserId, reportedAgencyId, reportedClientId, relatedType, relatedId, subjectLabel, compact }: { reportedUserId?: string; reportedAgencyId?: string; reportedClientId?: string; relatedType?: string; relatedId?: string; subjectLabel?: string; compact?: boolean }) {
  const [state, action] = useActionState(reportBypassAction, idle as ActionResult<{ id: string }>);
  const [open, setOpen] = useState(!compact);
  if (state.ok) return <FormAlert tone="success">Thank you. Hirewise is reviewing your report; nothing changes automatically and you will hear back once a decision is made.</FormAlert>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-500 hover:text-red-700"><Flag className="h-3.5 w-3.5" /> Report direct contact or bypass attempt</button>;
  return (
    <form action={action} className="space-y-3 rounded-2xl border border-ink-100 bg-ink-50/60 p-4" noValidate>
      {reportedUserId && <input type="hidden" name="reportedUserId" value={reportedUserId} />}
      {reportedAgencyId && <input type="hidden" name="reportedAgencyId" value={reportedAgencyId} />}
      {reportedClientId && <input type="hidden" name="reportedClientId" value={reportedClientId} />}
      {relatedType && <input type="hidden" name="relatedType" value={relatedType} />}
      {relatedId && <input type="hidden" name="relatedId" value={relatedId} />}
      <p className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-ink-900"><Flag className="h-4 w-4 text-red-600" /> Report direct contact or bypass attempt{subjectLabel ? ` · ${subjectLabel}` : ""}</p>
      <Field label="What happened?" htmlFor={`rb-${relatedId ?? "general"}`} hint="Who contacted whom, how, and when. Hirewise reviews every report; a report alone never suspends anyone."><Textarea id={`rb-${relatedId ?? "general"}`} name="description" rows={4} required /></Field>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <div className="flex gap-2">
        <SubmitButton variant="danger" pendingText="Sending…" className="h-10 text-[13.5px]">Send report</SubmitButton>
        {compact && <button type="button" onClick={() => setOpen(false)} className="text-[13px] font-semibold text-ink-500">Cancel</button>}
      </div>
    </form>
  );
}

const NEXT: Record<string, Array<[string, string]>> = {
  REPORTED: [["UNDER_REVIEW", "Start review"], ["CLOSED", "Close (no action)"]],
  UNDER_REVIEW: [["WARNING_ISSUED", "Issue warning"], ["RESTRICTED", "Restrict"], ["SUSPENDED", "Suspend account"], ["CLOSED", "Close"]],
  WARNING_ISSUED: [["RESTRICTED", "Restrict"], ["SUSPENDED", "Suspend account"], ["CLOSED", "Close"]],
  RESTRICTED: [["SUSPENDED", "Suspend account"], ["CLOSED", "Close"]],
  SUSPENDED: [["CLOSED", "Close"]],
  CLOSED: [],
};

/** Staff decisions on a case (bypass.review). */
export function BypassActions({ reportId, status, canSuspend }: { reportId: string; status: string; canSuspend: boolean }) {
  const router = useRouter();
  const [state, action] = useActionState(decideBypassAction, idle);
  const [to, setTo] = useState<string>(NEXT[status]?.[0]?.[0] ?? "");
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);
  const options = (NEXT[status] ?? []).filter(([v]) => v !== "SUSPENDED" || canSuspend);
  if (options.length === 0) return <p className="text-[13px] text-ink-400">This case is closed.</p>;
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="reportId" value={reportId} />
      <input type="hidden" name="to" value={to} />
      <div className="flex flex-wrap gap-1.5">
        {options.map(([v, l]) => <button key={v} type="button" onClick={() => setTo(v)} className={cn("rounded-full px-3 py-1.5 text-[12.5px] font-semibold ring-1 ring-inset", to === v ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-ink-700 ring-ink-200 hover:bg-ink-50")}>{l}</button>)}
      </div>
      {to !== "UNDER_REVIEW" && <Field label="Decision note (required, sent to the parties where relevant)" htmlFor={`bn-${reportId}`}><Textarea id={`bn-${reportId}`} name="note" rows={3} /></Field>}
      {to === "RESTRICTED" && <Field label="Restriction length (days)" htmlFor={`bd-${reportId}`} hint="Hides an agent's profile or suspends a client or agency, with this end date recorded. Lifting is a staff decision when closing."><Input id={`bd-${reportId}`} name="restrictionDays" type="number" min={1} max={365} defaultValue={30} className="max-w-[140px]" /></Field>}
      {to === "CLOSED" && (status === "RESTRICTED" || status === "SUSPENDED") && <Checkbox name="liftRestriction" label="Lift the restriction (restore the profile, client, or agency)" />}
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant={to === "SUSPENDED" || to === "RESTRICTED" ? "danger" : "dark"} pendingText="Saving…" className="h-10 text-[13.5px]">Confirm</SubmitButton>
    </form>
  );
}

export function BypassEvidenceUploader({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [state, action] = useActionState(attachBypassEvidenceAction, idle);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);
  async function handle(file: File) {
    setErr(null);
    setBusy(true);
    const req = await bypassEvidenceUploadUrlAction(reportId, file.type);
    if (!req.ok || !req.data) {
      setBusy(false);
      return setErr(req.error ?? "Upload could not start.");
    }
    const ok = await fetch(req.data.url, { method: req.data.method, headers: req.data.headers, body: file }).then((r) => r.ok).catch(() => false);
    setBusy(false);
    if (!ok) return setErr("The upload failed.");
    setKey(req.data.key);
  }
  if (state.ok) return <FormAlert tone="success">Evidence attached.</FormAlert>;
  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-ink-300 bg-ink-50/50 px-4 py-3 text-[13.5px] text-ink-600 hover:border-brand-400">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : key ? <FileText className="h-4 w-4 text-brand-600" /> : <UploadCloud className="h-4 w-4" />}
        {key ? "File uploaded. Attach it below." : "Upload evidence (PDF, PNG, JPEG, or text)"}
        <input type="file" accept="application/pdf,image/png,image/jpeg,text/plain" className="sr-only" onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />
      </label>
      {err && <FormAlert>{err}</FormAlert>}
      {key && <form action={action}><input type="hidden" name="reportId" value={reportId} /><input type="hidden" name="storageKey" value={key} />{state.error && <FormAlert>{state.error}</FormAlert>}<SubmitButton variant="outline" pendingText="…" className="h-9 text-[13px]">Attach to case</SubmitButton></form>}
    </div>
  );
}

export function BypassEvidenceLink({ reportId, documentId, name }: { reportId: string; documentId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  return <button type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await bypassEvidenceUrlAction(reportId, documentId); setBusy(false); if (r.ok && r.data) window.open(r.data.url, "_blank", "noopener"); }} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-60"><FileText className="h-3.5 w-3.5" /> {name}</button>;
}

export function BypassHistory({ history }: { history: Array<{ id: string; from: string | null; to: string; note: string | null; at: Date }> }) {
  return (
    <ol className="space-y-2 text-[13px]">
      {history.map((h) => (
        <li key={h.id} className="flex items-start gap-3">
          <StatusBadge status={h.to} />
          <div><p className="text-ink-700">{fmtDate(h.at)}{h.from ? ` · from ${h.from.toLowerCase().replace(/_/g, " ")}` : " · reported"}</p>{h.note && <p className="text-ink-500">{h.note}</p>}</div>
        </li>
      ))}
    </ol>
  );
}

export function ThreadListLink({ id, title, counterpart, status, lastMessageAt }: { id: string; title: string; counterpart: string; status: string; lastMessageAt: Date | null }) {
  return (
    <Link href={`/messages/${id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-ink-100 bg-white px-4 py-3 hover:border-brand-300">
      <div className="min-w-0">
        <p className="truncate text-[14.5px] font-semibold text-ink-900">{title}</p>
        <p className="truncate text-[12.5px] text-ink-500">{counterpart}{lastMessageAt ? ` · last message ${fmtDate(lastMessageAt)}` : " · no messages yet"}</p>
      </div>
      <StatusBadge status={status} />
    </Link>
  );
}
