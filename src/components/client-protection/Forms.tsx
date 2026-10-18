"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2 } from "lucide-react";
import { updatePartnerIdentityAction, grantDisclosureAction, revokeDisclosureAction, reviewClientSafeDocumentAction, setClientLabelAction, clientSafeDocumentUrlAction } from "@/app/(app)/client-protection-actions";
import { idle } from "@/server/http/action-result";
import { Field, FormAlert, Input, Select, SubmitButton, Textarea } from "@/components/ui/Form";
import { StatusBadge, fmtDate } from "@/components/app/ui";
import type { DisclosureGrantView, ClientSafeDocumentStaffView } from "@/server/views/partner.views";

/** Hirewise edits the client-facing Partner Team name and specializations (partner.identity.manage). */
export function PartnerIdentityForm({ agencyId, name, specializations }: { agencyId: string; name: string; specializations: string[] }) {
  const router = useRouter();
  const [state, action] = useActionState(updatePartnerIdentityAction, idle);
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="agencyId" value={agencyId} />
      <Field label="Client-facing name" htmlFor={`pi-name-${agencyId}`} error={fe.clientFacingName} hint="Must not contain the agency's real name."><Input id={`pi-name-${agencyId}`} name="clientFacingName" defaultValue={name} /></Field>
      <Field label="Specializations (comma separated)" htmlFor={`pi-spec-${agencyId}`} error={fe.specializations} hint="Curated by Hirewise; shown to clients on the Partner Team page."><Input id={`pi-spec-${agencyId}`} name="specializations" defaultValue={specializations.join(", ")} placeholder="Appointment setting, Customer support" /></Field>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Client-facing identity updated.</FormAlert>}
      <SubmitButton pendingText="Saving…" className="h-10 text-[13.5px]">Save client-facing identity</SubmitButton>
    </form>
  );
}

/** Staff grant a disclosure to one client for a fixed subject (agent or agency). */
export function GrantDisclosureForm({ scope, agentProfileId, agencyId, clients }: { scope: "AGENT_IDENTITY" | "AGENCY_IDENTITY" | "CLIENT_IDENTITY"; agentProfileId?: string; agencyId?: string; clients: Array<{ id: string; companyName: string }> }) {
  const router = useRouter();
  const [state, action] = useActionState(grantDisclosureAction, idle);
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);
  const key = `${scope}-${agentProfileId ?? agencyId ?? ""}`;
  const label = scope === "AGENT_IDENTITY" ? "Disclose this agent's full name to a client" : scope === "AGENCY_IDENTITY" ? "Disclose the real agency identity to a client" : "Disclose a client's company name to this agent";
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="scope" value={scope} />
      {agentProfileId && <input type="hidden" name="agentProfileId" value={agentProfileId} />}
      {agencyId && <input type="hidden" name="agencyId" value={agencyId} />}
      <p className="text-[13.5px] font-semibold text-ink-800">{label}</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]">
        <Select name="clientId" id={`gd-client-${key}`} defaultValue="">
          <option value="" disabled>Choose a client</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
        </Select>
        <Input name="reason" id={`gd-reason-${key}`} placeholder="Reason (recorded in the audit log)" />
        <SubmitButton pendingText="Granting…" variant="outline" className="h-10 text-[13.5px]">Grant</SubmitButton>
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Disclosure granted.</FormAlert>}
    </form>
  );
}

export function DisclosureGrantList({ grants, canManage }: { grants: DisclosureGrantView[]; canManage: boolean }) {
  if (grants.length === 0) return <p className="text-[13px] text-ink-400">No disclosures yet. Clients see the client label and the Partner Team only.</p>;
  return (
    <ul className="divide-y divide-ink-100 text-[13.5px]">
      {grants.map((g) => (
        <li key={g.id} className="py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span><span className="font-semibold text-ink-800">{g.scope.replace(/_/g, " ").toLowerCase()}</span> · {g.client.companyName}{g.agent ? ` · ${g.agent.displayName}` : ""}{g.agency ? ` · ${g.agency.name}` : ""}</span>
            <StatusBadge status={g.active ? "ACTIVE" : "REVOKED"} />
          </div>
          <p className="text-[12.5px] text-ink-400">{g.grantedBy === "SYSTEM" ? "System" : g.grantedByEmail ?? "Staff"} · {fmtDate(g.grantedAt)} · {g.reason}{g.revokedAt ? ` · revoked ${fmtDate(g.revokedAt)}: ${g.revokeReason}` : ""}</p>
          {canManage && g.active && <RevokeDisclosureForm grantId={g.id} />}
        </li>
      ))}
    </ul>
  );
}

function RevokeDisclosureForm({ grantId }: { grantId: string }) {
  const router = useRouter();
  const [state, action] = useActionState(revokeDisclosureAction, idle);
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);
  return (
    <form action={action} className="mt-1.5 flex flex-wrap items-center gap-2" noValidate>
      <input type="hidden" name="grantId" value={grantId} />
      <Input name="reason" placeholder="Reason to revoke" className="h-9 max-w-xs text-[13px]" />
      <SubmitButton pendingText="Revoking…" variant="danger" className="h-9 text-[12.5px]">Revoke</SubmitButton>
      {state.error && <span className="text-[12.5px] text-red-600">{state.error}</span>}
    </form>
  );
}

const DECISIONS: Array<["APPROVE" | "REJECT" | "REGENERATE", string]> = [["APPROVE", "Approve for clients"], ["REJECT", "Reject"], ["REGENERATE", "Regenerate PDF"]];

/** Staff review of one client-safe document. */
export function ClientSafeReviewForm({ doc }: { doc: ClientSafeDocumentStaffView }) {
  const router = useRouter();
  const [state, action] = useActionState(reviewClientSafeDocumentAction, idle);
  const [decision, setDecision] = useState<"APPROVE" | "REJECT" | "REGENERATE">("APPROVE");
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);
  const generated = doc.sourceType === "PROFILE" || doc.sourceType === "CERTIFICATION";
  if (state.ok) return <FormAlert tone="success">Decision recorded.</FormAlert>;
  return (
    <form action={action} className="space-y-2.5" noValidate>
      <input type="hidden" name="id" value={doc.id} />
      <input type="hidden" name="decision" value={decision} />
      <div className="flex flex-wrap gap-1.5">
        {(generated ? DECISIONS : DECISIONS.filter((d) => d[0] !== "REGENERATE")).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setDecision(v)} className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ring-1 ring-inset ${decision === v ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-ink-700 ring-ink-200 hover:bg-ink-50"}`}>{l}</button>
        ))}
      </div>
      {decision === "REJECT" && <Textarea name="note" rows={2} placeholder="Why it cannot be shown to clients (sent to the agent)" />}
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton pendingText="Saving…" variant={decision === "REJECT" ? "danger" : "dark"} className="h-9 text-[13px]">Confirm</SubmitButton>
    </form>
  );
}

/** Staff pin or reset the label clients see. */
export function ClientLabelForm({ agentProfileId, label, override }: { agentProfileId: string; label: string; override: boolean }) {
  const router = useRouter();
  const [state, action] = useActionState(setClientLabelAction, idle);
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);
  return (
    <form action={action} className="space-y-2" noValidate>
      <input type="hidden" name="agentProfileId" value={agentProfileId} />
      <div className="flex flex-wrap items-center gap-2">
        <Input name="label" defaultValue={label} className="h-9 max-w-[220px] text-[13.5px]" />
        <SubmitButton pendingText="Saving…" variant="outline" className="h-9 text-[12.5px]">Set label</SubmitButton>
        <SubmitButton name="label" value="" pendingText="Resetting…" variant="outline" className="h-9 text-[12.5px]">Reset to legal name</SubmitButton>
      </div>
      <p className="text-[12px] text-ink-400">{override ? "Pinned by staff; legal-name changes no longer update it." : "Derived from the legal name (first name plus last initial)."}</p>
      {state.error && <FormAlert>{state.error}</FormAlert>}
    </form>
  );
}

/** Opens a client-safe document through a short-lived signed URL. */
export function DocumentLink({ id, label }: { id: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await clientSafeDocumentUrlAction(id);
          setBusy(false);
          if (r.ok && r.data) window.open(r.data.url, "_blank", "noopener");
          else setError(r.error ?? "Could not open the document.");
        }}
        className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />} {label}
      </button>
      {error && <span className="text-[12.5px] text-red-600">{error}</span>}
    </span>
  );
}
