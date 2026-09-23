"use client";

import { useActionState, useState } from "react";
import { UploadCloud, Loader2, FileText } from "lucide-react";
import { createIncidentAction, incidentWorkflowAction, evidenceUploadUrlAction, evidenceUrlAction } from "@/app/(app)/phase5-actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Select, Textarea, SubmitButton, FormAlert } from "@/components/ui/Form";

export function IncidentForm({ subjectUserId, subjectLabel, relatedType, relatedId, compact }: { subjectUserId?: string; subjectLabel?: string; relatedType?: string; relatedId?: string; compact?: boolean }) {
  const [state, action] = useActionState(createIncidentAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3" noValidate>
      {relatedType && <input type="hidden" name="relatedType" value={relatedType} />}
      {relatedId && <input type="hidden" name="relatedId" value={relatedId} />}
      {subjectUserId ? <input type="hidden" name="subjectUserId" value={subjectUserId} /> : <Field label="Subject user id" htmlFor="subjectUserId" error={fe.subjectUserId} hint="From Staff → Users."><Input id="subjectUserId" name="subjectUserId" className="h-10 text-[14px]" /></Field>}
      {subjectLabel && <p className="text-[13px] text-ink-500">Subject: <span className="font-semibold text-ink-800">{subjectLabel}</span></p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type" htmlFor="inc-type" error={fe.type}><Select id="inc-type" name="type" defaultValue="OFF_PLATFORM_CONTACT" className="h-10 text-[14px]"><option value="RATE_DISCUSSION">Rate discussion</option><option value="OFF_PLATFORM_CONTACT">Off-platform contact</option><option value="DIRECT_HIRE_ATTEMPT">Direct hire attempt</option><option value="POLICY_VIOLATION">Policy violation</option><option value="OTHER">Other</option></Select></Field>
        <Field label="Severity" htmlFor="inc-sev" error={fe.severity}><Select id="inc-sev" name="severity" defaultValue="MEDIUM" className="h-10 text-[14px]"><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></Select></Field>
      </div>
      <Field label="What happened" htmlFor="inc-desc" error={fe.description}><Textarea id="inc-desc" name="description" rows={compact ? 3 : 5} className="text-[14px]" placeholder="Facts only: what was observed on the platform, when, and by whom." /></Field>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant="outline" pendingText="Creating…" className="h-9 text-[13px]">Create incident</SubmitButton>
    </form>
  );
}

export function IncidentActions({ incidentId, status, subjectUserId, subjectStatus, canResolve, canSuspend }: { incidentId: string; status: string; subjectUserId: string; subjectStatus: string; canResolve: boolean; canSuspend: boolean }) {
  const [state, action] = useActionState(incidentWorkflowAction, idle);
  const open = status === "OPEN" || status === "UNDER_REVIEW";
  return (
    <div className="space-y-3">
      {open && canResolve && status === "OPEN" && (
        <form action={action}><input type="hidden" name="incidentId" value={incidentId} /><input type="hidden" name="op" value="UNDER_REVIEW" /><SubmitButton variant="dark" pendingText="…" className="h-10 text-[13.5px]">Start review</SubmitButton></form>
      )}
      {open && canResolve && (
        <form action={action} className="space-y-2" noValidate>
          <input type="hidden" name="incidentId" value={incidentId} />
          <Textarea name="resolution" rows={2} placeholder="Resolution note (required)" className="min-h-0 text-[13.5px]" required />
          <div className="flex gap-2">
            <button type="submit" name="op" value="RESOLVED" className="inline-flex h-10 items-center rounded-full bg-brand-500 px-4 text-[13.5px] font-semibold text-white">Resolve</button>
            <button type="submit" name="op" value="DISMISSED" className="inline-flex h-10 items-center rounded-full border border-ink-200 bg-white px-4 text-[13.5px] font-semibold text-ink-800">Dismiss</button>
          </div>
        </form>
      )}
      {canSuspend && subjectStatus === "ACTIVE" && (
        <form action={action} className="space-y-2" noValidate onSubmit={(e) => { if (!window.confirm("Suspend this user? They are signed out immediately and their profile leaves the marketplace.")) e.preventDefault(); }}>
          <input type="hidden" name="incidentId" value={incidentId} /><input type="hidden" name="op" value="SUSPEND" /><input type="hidden" name="userId" value={subjectUserId} />
          <Input name="reason" placeholder="Suspension reason (required, sent to the user)" className="h-10 text-[13.5px]" required />
          <SubmitButton variant="danger" pendingText="…" className="h-10 text-[13.5px]">Suspend user</SubmitButton>
        </form>
      )}
      {canSuspend && subjectStatus === "SUSPENDED" && (
        <form action={action} className="space-y-2" noValidate>
          <input type="hidden" name="incidentId" value={incidentId} /><input type="hidden" name="op" value="REINSTATE" /><input type="hidden" name="userId" value={subjectUserId} />
          <Input name="reason" placeholder="Reinstatement reason (required)" className="h-10 text-[13.5px]" required />
          <SubmitButton variant="outline" pendingText="…" className="h-10 text-[13.5px]">Reinstate user</SubmitButton>
        </form>
      )}
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Updated.</FormAlert>}
    </div>
  );
}

export function EvidenceUploader({ incidentId }: { incidentId: string }) {
  const [state, action] = useActionState(incidentWorkflowAction, idle);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function handle(file: File) {
    setErr(null);
    setBusy(true);
    const req = await evidenceUploadUrlAction(incidentId, file.type);
    if (!req.ok || !req.data) { setBusy(false); return setErr(req.error ?? "Upload could not start."); }
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
      {key && <form action={action}><input type="hidden" name="incidentId" value={incidentId} /><input type="hidden" name="op" value="ATTACH" /><input type="hidden" name="storageKey" value={key} />{state.error && <FormAlert>{state.error}</FormAlert>}<SubmitButton variant="outline" pendingText="…" className="h-9 text-[13px]">Attach to incident</SubmitButton></form>}
    </div>
  );
}

export function EvidenceLink({ incidentId, documentId, name }: { incidentId: string; documentId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  return <button type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await evidenceUrlAction(incidentId, documentId); setBusy(false); if (r.ok && r.data) window.open(r.data.url, "_blank", "noopener"); }} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-60"><FileText className="h-3.5 w-3.5" /> {name}</button>;
}
