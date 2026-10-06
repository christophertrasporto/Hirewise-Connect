"use client";

import { useActionState } from "react";
import { setCertificationTemplateAction } from "@/app/(app)/academy-actions";
import { idle } from "@/server/http/action-result";
import { Field, FormAlert, Select, SubmitButton } from "@/components/ui/Form";

export function CertificationTemplateForm({ courseId, current, templates }: { courseId: string; current: string | null; templates: Array<{ id: string; name: string }> }) {
  const [state, action] = useActionState(setCertificationTemplateAction, idle);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3" noValidate>
      <input type="hidden" name="courseId" value={courseId} />
      <Field label="Template" htmlFor="certificationTemplateId" className="min-w-[260px] flex-1">
        <Select id="certificationTemplateId" name="certificationTemplateId" defaultValue={current ?? ""}>
          <option value="">No certification</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </Field>
      <SubmitButton pendingText="Saving…" className="h-10 text-[13.5px]">Save</SubmitButton>
      {state.error && <div className="w-full"><FormAlert>{state.error}</FormAlert></div>}
      {state.ok && <div className="w-full"><FormAlert tone="success">Saved.</FormAlert></div>}
    </form>
  );
}
