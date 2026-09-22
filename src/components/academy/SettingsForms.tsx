"use client";

import { useActionState } from "react";
import { saveTemplateAction, saveLabelAction, saveRequirementAction } from "@/app/(app)/academy-actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Textarea, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";

type Template = { id?: string; name: string; description: string | null; validityMonths: number | null; requiresCompletion: boolean; minExamScore: number | null; requiresCoachReview: boolean; minResultLabelRank: number | null; isActive: boolean };

export function TemplateForm({ t }: { t?: Template }) {
  const [state, action] = useActionState(saveTemplateAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3" noValidate>
      {t?.id && <input type="hidden" name="id" value={t.id} />}
      <Field label="Name" htmlFor={`name-${t?.id ?? "new"}`} error={fe.name}><Input id={`name-${t?.id ?? "new"}`} name="name" defaultValue={t?.name ?? ""} className="h-10 text-[14px]" /></Field>
      <Field label="Description" htmlFor={`desc-${t?.id ?? "new"}`} error={fe.description}><Textarea id={`desc-${t?.id ?? "new"}`} name="description" rows={2} defaultValue={t?.description ?? ""} className="min-h-[60px] text-[14px]" /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Valid for (months)" htmlFor={`vm-${t?.id ?? "new"}`} error={fe.validityMonths} hint="Blank = no expiry"><Input id={`vm-${t?.id ?? "new"}`} name="validityMonths" type="number" min={1} max={120} defaultValue={t?.validityMonths ?? ""} className="h-10 text-[14px]" /></Field>
        <Field label="Min exam score %" htmlFor={`me-${t?.id ?? "new"}`} error={fe.minExamScore}><Input id={`me-${t?.id ?? "new"}`} name="minExamScore" type="number" min={0} max={100} defaultValue={t?.minExamScore ?? ""} className="h-10 text-[14px]" /></Field>
        <Field label="Min coach result rank" htmlFor={`mr-${t?.id ?? "new"}`} error={fe.minResultLabelRank}><Input id={`mr-${t?.id ?? "new"}`} name="minResultLabelRank" type="number" min={0} max={10} defaultValue={t?.minResultLabelRank ?? ""} className="h-10 text-[14px]" /></Field>
      </div>
      <div className="flex flex-wrap gap-4">
        <Checkbox name="requiresCompletion" defaultChecked={t?.requiresCompletion ?? true} label="Requires course completion" />
        <Checkbox name="requiresCoachReview" defaultChecked={t?.requiresCoachReview ?? false} label="Requires coach recommendation" />
        <Checkbox name="isActive" defaultChecked={t?.isActive ?? true} label="Active" />
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Saved.</FormAlert>}
      <SubmitButton variant="outline" pendingText="Saving…" className="h-9 text-[13px]">{t ? "Save template" : "Create template"}</SubmitButton>
    </form>
  );
}

export function LabelForm({ l }: { l?: { key: string; label: string; rank: number; isActive: boolean } }) {
  const [state, action] = useActionState(saveLabelAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <Input name="key" defaultValue={l?.key ?? ""} placeholder="KEY" readOnly={!!l} className="h-9 w-[150px] text-[13px] uppercase" invalid={!!fe.key} />
      <Input name="label" defaultValue={l?.label ?? ""} placeholder="Label" className="h-9 w-[160px] text-[13px]" invalid={!!fe.label} />
      <Input name="rank" type="number" min={0} max={10} defaultValue={l?.rank ?? 0} className="h-9 w-[80px] text-[13px]" invalid={!!fe.rank} />
      <SubmitButton variant="outline" pendingText="…" className="h-9 px-3 text-[12.5px]">{l ? "Save" : "Add"}</SubmitButton>
      {state.ok && <span className="text-[12px] font-semibold text-brand-700">Saved</span>}
      {(state.error || fe.key) && <span className="w-full text-[12px] text-red-600">{fe.key ?? state.error}</span>}
    </form>
  );
}

export function RequirementForm({ level, rules }: { level: string; rules: { profileApproved?: boolean; videoApproved?: boolean; minApprovedRecordings?: number; minApprovedCertifications?: number; minAssessmentLabelRank?: number; publishedBillingRate?: boolean } }) {
  const [state, action] = useActionState(saveRequirementAction, idle);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[1fr_auto]" noValidate>
      <input type="hidden" name="level" value={level} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
        <Checkbox name="profileApproved" defaultChecked={!!rules.profileApproved} label="Profile approved" />
        <Checkbox name="videoApproved" defaultChecked={!!rules.videoApproved} label="Approved video" />
        <label className="flex items-center gap-1.5 text-ink-700">Recordings ≥ <Input name="minApprovedRecordings" type="number" min={0} defaultValue={rules.minApprovedRecordings ?? ""} className="h-8 w-[60px] text-[13px]" /></label>
        <label className="flex items-center gap-1.5 text-ink-700">Certifications ≥ <Input name="minApprovedCertifications" type="number" min={0} defaultValue={rules.minApprovedCertifications ?? ""} className="h-8 w-[60px] text-[13px]" /></label>
        <label className="flex items-center gap-1.5 text-ink-700">Coach result rank ≥ <Input name="minAssessmentLabelRank" type="number" min={0} defaultValue={rules.minAssessmentLabelRank ?? ""} className="h-8 w-[60px] text-[13px]" /></label>
        <Checkbox name="publishedBillingRate" defaultChecked={!!rules.publishedBillingRate} label="Published billing rate (Phase 4)" />
      </div>
      <div className="flex items-center gap-2">
        <SubmitButton variant="outline" pendingText="…" className="h-8 px-3 text-[12.5px]">Save</SubmitButton>
        {state.ok && <span className="text-[12px] font-semibold text-brand-700">Saved</span>}
        {state.error && <span className="text-[12px] text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
