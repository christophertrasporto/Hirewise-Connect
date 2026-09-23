"use client";

import { useActionState, useRef, useState } from "react";
import { UploadCloud, Loader2, FileText } from "lucide-react";
import { placementWorkflowAction, checklistAction, signedAgreementUrlAction, recordPaymentAction, depositAction, invoicePdfAction } from "@/app/(app)/commercial-actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Select, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";
import { cn } from "@/lib/cn";

export function PlacementButton({ placementId, op, label, variant = "dark", withReason, confirm }: { placementId: string; op: string; label: string; variant?: "dark" | "primary" | "outline" | "danger"; withReason?: boolean; confirm?: string }) {
  const [state, action] = useActionState(placementWorkflowAction, idle);
  return (
    <form action={action} className="space-y-2" onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      <input type="hidden" name="placementId" value={placementId} />
      <input type="hidden" name="op" value={op} />
      {withReason && <Input name="reason" placeholder="Reason (required, audited)" required className="h-10 text-[13.5px]" />}
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant={variant} pendingText="Working…" className="h-10 text-[13.5px]">{label}</SubmitButton>
    </form>
  );
}

export function ApproveForm({ placementId, policies, startDate }: { placementId: string; policies: Array<{ id: string; name: string; type: string; isDefault: boolean }>; startDate: string | null }) {
  const [state, action] = useActionState(placementWorkflowAction, idle);
  const [policyId, setPolicyId] = useState(policies.find((p) => p.isDefault)?.id ?? policies[0]?.id ?? "");
  const custom = policies.find((p) => p.id === policyId)?.type === "CUSTOM";
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="placementId" value={placementId} />
      <input type="hidden" name="op" value="APPROVE" />
      <Field label="Deposit policy" htmlFor="depositPolicyId" error={fe.depositPolicyId}>
        <Select id="depositPolicyId" name="depositPolicyId" value={policyId} onChange={(e) => setPolicyId(e.target.value)} className="h-10 text-[14px]">
          {policies.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isDefault ? " (default)" : ""}</option>)}
        </Select>
      </Field>
      {custom && <Field label="Custom deposit (USD)" htmlFor="customDepositUsd"><Input id="customDepositUsd" name="customDepositUsd" inputMode="decimal" placeholder="1000.00" className="h-10 text-[14px]" /></Field>}
      <Field label="Target start date" htmlFor="startDate" hint="Can be changed later; required before activation."><Input id="startDate" name="startDate" type="date" defaultValue={startDate ?? ""} className="h-10 text-[14px]" /></Field>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant="primary" pendingText="Approving…" className="h-10 text-[13.5px]">Approve and issue deposit invoice</SubmitButton>
    </form>
  );
}

export function StartDateForm({ placementId, startDate }: { placementId: string; startDate: string | null }) {
  const [state, action] = useActionState(placementWorkflowAction, idle);
  return (
    <form action={action} className="flex items-end gap-2" noValidate>
      <input type="hidden" name="placementId" value={placementId} />
      <input type="hidden" name="op" value="START_DATE" />
      <Field label="Start date" htmlFor="sd" className="flex-1"><Input id="sd" name="startDate" type="date" defaultValue={startDate ?? ""} className="h-10 text-[14px]" required /></Field>
      <SubmitButton variant="outline" pendingText="…" className="h-10 text-[13px]">Save</SubmitButton>
      {state.error && <span className="text-[12px] text-red-600">{state.error}</span>}
      {state.ok && <span className="text-[12px] font-semibold text-brand-700">Saved</span>}
    </form>
  );
}

export function Checklist({ placementId, items, editable }: { placementId: string; items: Array<{ id: string; label: string; isRequired: boolean; isDone: boolean; doneAt: Date | null }>; editable: boolean }) {
  return (
    <ul className="divide-y divide-ink-100">
      {items.map((it) => (
        <li key={it.id} className="flex items-center justify-between gap-3 py-2.5">
          <form action={checklistAction} className="flex items-center gap-3">
            <input type="hidden" name="placementId" value={placementId} />
            <input type="hidden" name="itemId" value={it.id} />
            <input type="hidden" name="done" value={it.isDone ? "false" : "true"} />
            <button type="submit" disabled={!editable} aria-label={it.isDone ? `Mark "${it.label}" not done` : `Mark "${it.label}" done`} className={cn("flex h-6 w-6 items-center justify-center rounded-md border text-[12px] font-bold", it.isDone ? "border-brand-500 bg-brand-500 text-white" : "border-ink-300 bg-white text-transparent hover:border-brand-400", !editable && "cursor-default opacity-70")}>✓</button>
            <span className={cn("text-[14px]", it.isDone ? "text-ink-500 line-through decoration-ink-300" : "text-ink-800")}>{it.label}{it.isRequired && !it.isDone && <span className="ml-1.5 text-[11px] font-semibold text-gold-600">required</span>}</span>
          </form>
          {it.doneAt && <span className="text-[12px] text-ink-400">{new Date(it.doneAt).toLocaleDateString()}</span>}
        </li>
      ))}
    </ul>
  );
}

export function SignedAgreementUploader({ placementId }: { placementId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, action] = useActionState(placementWorkflowAction, idle);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handle(file: File) {
    setErr(null);
    setBusy(true);
    const req = await signedAgreementUrlAction(placementId, file.type);
    if (!req.ok || !req.data) { setBusy(false); return setErr(req.error ?? "Upload could not start."); }
    const ok = await fetch(req.data.url, { method: req.data.method, headers: req.data.headers, body: file }).then((r) => r.ok).catch(() => false);
    setBusy(false);
    if (!ok) return setErr("The upload failed.");
    setKey(req.data.key);
  }

  if (state.ok) return <FormAlert tone="success">Signed agreement recorded. The deposit invoice is now due.</FormAlert>;
  return (
    <div className="space-y-2">
      <label className={cn("flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-ink-300 bg-ink-50/50 px-4 py-3 text-[13.5px] text-ink-600 hover:border-brand-400", busy && "opacity-60")}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : key ? <FileText className="h-4 w-4 text-brand-600" /> : <UploadCloud className="h-4 w-4" />}
        {key ? "PDF uploaded. Record it below." : "Upload the signed agreement (PDF)"}
        <input ref={input} type="file" accept="application/pdf" className="sr-only" onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />
      </label>
      {err && <FormAlert>{err}</FormAlert>}
      {key && (
        <form action={action}>
          <input type="hidden" name="placementId" value={placementId} />
          <input type="hidden" name="op" value="SIGNED_AGREEMENT" />
          <input type="hidden" name="storageKey" value={key} />
          {state.error && <FormAlert>{state.error}</FormAlert>}
          <SubmitButton variant="outline" pendingText="Recording…" className="h-9 text-[13px]">Record signed agreement</SubmitButton>
        </form>
      )}
    </div>
  );
}

export function AcceptAgreementForm({ placementId }: { placementId: string }) {
  const [state, action] = useActionState(placementWorkflowAction, idle);
  const [ticked, setTicked] = useState(false);
  if (state.ok) return <FormAlert tone="success">Agreement accepted. The deposit invoice is now available under Billing.</FormAlert>;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="placementId" value={placementId} />
      <input type="hidden" name="op" value="ACCEPT_AGREEMENT" />
      <Checkbox checked={ticked} onChange={(e) => setTicked(e.target.checked)} label={<>I have read and agree to the <strong>Placement Service Agreement</strong> above on behalf of my company.</>} />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton disabled={!ticked} variant="primary" pendingText="Recording…">Accept agreement</SubmitButton>
    </form>
  );
}

export function PaymentForm({ invoiceId, placementId, balanceLabel }: { invoiceId: string; placementId?: string; balanceLabel: string }) {
  const [state, action] = useActionState(recordPaymentAction, idle);
  const fe = state.fieldErrors ?? {};
  if (state.ok) return <FormAlert tone="success">Payment recorded.</FormAlert>;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      {placementId && <input type="hidden" name="placementId" value={placementId} />}
      <Input name="amountUsd" inputMode="decimal" placeholder={`Amount (${balanceLabel})`} className="h-9 w-[160px] text-[13px]" invalid={!!fe.amountUsd} />
      <Select name="method" defaultValue="BANK_TRANSFER" className="h-9 w-[150px] text-[13px]" aria-label="Method"><option value="BANK_TRANSFER">Bank transfer</option><option value="PAYPAL">PayPal</option><option value="CARD">Card</option><option value="OTHER">Other</option></Select>
      <Input name="reference" placeholder="Reference" className="h-9 w-[150px] text-[13px]" />
      <Input name="paidAt" type="date" className="h-9 w-[150px] text-[13px]" aria-label="Paid on" />
      <SubmitButton variant="outline" pendingText="…" className="h-9 px-3 text-[12.5px]">Record payment</SubmitButton>
      {(state.error || fe.amountUsd) && <span className="w-full text-[12px] text-red-600">{fe.amountUsd ?? state.error}</span>}
    </form>
  );
}

export function DepositTools({ depositId, placementId, policies, canWaive, canRecalculate }: { depositId: string; placementId: string; policies: Array<{ id: string; name: string; type: string }>; canWaive: boolean; canRecalculate: boolean }) {
  const [state, action] = useActionState(depositAction, idle);
  if (state.ok) return <FormAlert tone="success">Deposit updated.</FormAlert>;
  return (
    <div className="space-y-3">
      {canRecalculate && (
        <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
          <input type="hidden" name="depositId" value={depositId} />
          <input type="hidden" name="placementId" value={placementId} />
          <input type="hidden" name="op" value="RECALCULATE" />
          <Select name="policyId" defaultValue="" className="h-9 w-[200px] text-[13px]" aria-label="Policy"><option value="" disabled>Recalculate with policy…</option>{policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Input name="customUsd" inputMode="decimal" placeholder="Custom USD" className="h-9 w-[120px] text-[13px]" />
          <SubmitButton variant="outline" pendingText="…" className="h-9 px-3 text-[12.5px]">Recalculate</SubmitButton>
        </form>
      )}
      {canWaive && (
        <form action={action} className="flex flex-wrap items-end gap-2" noValidate onSubmit={(e) => { if (!window.confirm("Waive this deposit? This is audited and lets the placement proceed without payment.")) e.preventDefault(); }}>
          <input type="hidden" name="depositId" value={depositId} />
          <input type="hidden" name="placementId" value={placementId} />
          <input type="hidden" name="op" value="WAIVE" />
          <Input name="reason" placeholder="Waive reason (required)" className="h-9 w-[260px] text-[13px]" required />
          <SubmitButton variant="danger" pendingText="…" className="h-9 px-3 text-[12.5px]">Waive deposit</SubmitButton>
        </form>
      )}
      {state.error && <FormAlert>{state.error}</FormAlert>}
    </div>
  );
}

export function VoidInvoiceForm({ invoiceId, placementId }: { invoiceId: string; placementId?: string }) {
  const [state, action] = useActionState(depositAction, idle);
  if (state.ok) return <span className="text-[12px] font-semibold text-brand-700">Voided.</span>;
  return (
    <form action={action} className="flex items-center gap-2" noValidate>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      {placementId && <input type="hidden" name="placementId" value={placementId} />}
      <input type="hidden" name="op" value="VOID_INVOICE" />
      <Input name="reason" placeholder="Void reason" className="h-8 w-[150px] text-[12.5px]" required />
      <SubmitButton variant="outline" pendingText="…" className="h-8 px-3 text-[12.5px]">Void</SubmitButton>
      {state.error && <span className="text-[12px] text-red-600">{state.error}</span>}
    </form>
  );
}

export function InvoicePdfLink({ invoiceId, label = "Download PDF" }: { invoiceId: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); setErr(null); const r = await invoicePdfAction(invoiceId); setBusy(false); if (r.ok && r.data) window.open(r.data.url, "_blank", "noopener"); else setErr(r.error ?? "Unavailable"); }} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-60">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} {label}
      </button>
      {err && <span className="text-[12px] text-red-600">{err}</span>}
    </span>
  );
}
