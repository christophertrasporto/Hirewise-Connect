"use client";

import { useActionState, useState } from "react";
import { publishAgreementAction, updateSettingAction } from "@/app/(app)/launch-actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Select, Textarea, SubmitButton, FormAlert } from "@/components/ui/Form";

export function AgreementVersionForm({ type, title, currentBody, nextVersion }: { type: string; title: string; currentBody: string; nextVersion: number }) {
  const [state, action] = useActionState(publishAgreementAction, idle);
  const [body, setBody] = useState(currentBody);
  const fe = state.fieldErrors ?? {};
  const stillPlaceholder = body.includes("LEGAL_PLACEHOLDER");
  if (state.ok && state.data) return <FormAlert tone="success">Version {state.data.version} published. Users in the required role must accept it on their next visit.</FormAlert>;
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="type" value={type} />
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <Field label="Title" htmlFor={`t-${type}`} error={fe.title}><Input id={`t-${type}`} name="title" defaultValue={title} className="h-10 text-[14px]" /></Field>
        <Field label="Effective from" htmlFor={`e-${type}`} error={fe.effectiveFrom}><Input id={`e-${type}`} name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="h-10 text-[14px]" /></Field>
      </div>
      <Field label={`Body (Markdown) for version ${nextVersion}`} htmlFor={`b-${type}`} error={fe.bodyMarkdown} hint={stillPlaceholder ? "Contains LEGAL_PLACEHOLDER: the readiness check will keep failing until counsel text replaces it." : "No placeholders detected."}>
        <Textarea id={`b-${type}`} name="bodyMarkdown" rows={14} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-[12.5px]" />
      </Field>
      <Field label="Change note (audited)" htmlFor={`c-${type}`} error={fe.changeNote}><Input id={`c-${type}`} name="changeNote" placeholder="e.g. Counsel review 2026-10, clause 4 updated" className="h-10 text-[14px]" /></Field>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant={stillPlaceholder ? "outline" : "primary"} pendingText="Publishing…" className="h-10 text-[13.5px]">Publish version {nextVersion}</SubmitButton>
    </form>
  );
}

export function SettingForm({ setting }: { setting: { key: string; value: unknown; meta: { label: string; help: string; kind: "number" | "boolean" | "text" | "json" | "enum"; options?: string[] } } }) {
  const [state, action] = useActionState(updateSettingAction, idle);
  const { key, value, meta } = setting;
  return (
    <form action={action} className="grid gap-2 py-3 sm:grid-cols-[260px_1fr_auto] sm:items-start" noValidate>
      <input type="hidden" name="key" value={key} />
      <div><p className="text-[14px] font-semibold text-ink-900">{meta.label}</p><p className="text-[12.5px] text-ink-400">{meta.help}</p></div>
      <div className="space-y-2">
        {meta.kind === "number" && <Input name="value" type="number" defaultValue={String(value)} className="h-10 w-[160px] text-[14px]" />}
        {meta.kind === "text" && <Input name="value" defaultValue={String(value)} className="h-10 w-[160px] text-[14px]" />}
        {meta.kind === "boolean" && <Select name="value" defaultValue={value ? "true" : "false"} className="h-10 w-[160px] text-[14px]"><option value="true">On</option><option value="false">Off</option></Select>}
        {meta.kind === "enum" && <Select name="value" defaultValue={String(value)} className="h-10 w-[220px] text-[14px]">{meta.options?.map((o) => <option key={o} value={o}>{o}</option>)}</Select>}
        {meta.kind === "json" && <Textarea name="value" rows={3} defaultValue={JSON.stringify(value)} className="min-h-0 font-mono text-[12.5px]" />}
        <Input name="reason" placeholder="Reason (audited)" className="h-9 text-[13px]" />
        {state.error && <span className="text-[12px] text-red-600">{state.error}</span>}
        {state.ok && <span className="text-[12px] font-semibold text-brand-700">Saved</span>}
      </div>
      <SubmitButton variant="outline" pendingText="…" className="h-9 text-[13px]">Save</SubmitButton>
    </form>
  );
}
