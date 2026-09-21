"use client";

import { useActionState } from "react";
import { BadgeCheck } from "lucide-react";
import { saveSkillsAction } from "@/app/(app)/actions";
import { idle } from "@/server/http/action-result";
import { SubmitButton, FormAlert, Select, Input } from "@/components/ui/Form";
import { Card } from "@/components/app/ui";
import { SKILL_LEVELS } from "@/lib/options";

type Tax = { id: string; name: string; category: string };

function groupBy(items: Tax[]) {
  const map = new Map<string, Tax[]>();
  for (const i of items) map.set(i.category, [...(map.get(i.category) ?? []), i]);
  return [...map.entries()];
}

export function SkillsForm({ skills, software, selectedSkills, selectedSoftware }: { skills: Tax[]; software: Tax[]; selectedSkills: Record<string, { level: string; yearsUsed: number; verified: boolean }>; selectedSoftware: Record<string, string> }) {
  const [state, action] = useActionState(saveSkillsAction, idle);
  return (
    <form action={action} className="space-y-5" noValidate>
      <Card title="Skills" description="Set a level to add a skill. Leave blank to exclude it.">
        <div className="space-y-6">
          {groupBy(skills).map(([category, items]) => (
            <div key={category}>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">{category}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {items.map((s) => {
                  const sel = selectedSkills[s.id];
                  return (
                    <div key={s.id} className="grid grid-cols-[1fr_130px_70px] items-center gap-2 rounded-xl border border-ink-100 px-3 py-2">
                      <span className="flex items-center gap-1.5 text-[14px] text-ink-800">
                        {s.name}
                        {sel?.verified && <BadgeCheck className="h-3.5 w-3.5 text-brand-600" aria-label="Verified by coach" />}
                      </span>
                      <Select name={`skill:${s.id}`} defaultValue={sel?.level ?? ""} className="h-9 text-[13px]" aria-label={`${s.name} level`}>
                        <option value="">—</option>
                        {SKILL_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                      </Select>
                      <Input name={`skillYears:${s.id}`} type="number" min={0} max={50} defaultValue={sel?.yearsUsed ?? ""} placeholder="yrs" className="h-9 text-[13px]" aria-label={`${s.name} years`} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {state.fieldErrors?.skills && <p className="mt-3 text-[12.5px] font-medium text-red-600">{state.fieldErrors.skills}</p>}
      </Card>

      <Card title="Software" description="Tools you can use on day one.">
        <div className="space-y-6">
          {groupBy(software).map(([category, items]) => (
            <div key={category}>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">{category}</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((s) => (
                  <div key={s.id} className="grid grid-cols-[1fr_130px] items-center gap-2 rounded-xl border border-ink-100 px-3 py-2">
                    <span className="text-[14px] text-ink-800">{s.name}</span>
                    <Select name={`software:${s.id}`} defaultValue={selectedSoftware[s.id] ?? ""} className="h-9 text-[13px]" aria-label={`${s.name} level`}>
                      <option value="">—</option>
                      {SKILL_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Saved.</FormAlert>}
      <SubmitButton pendingText="Saving…">Save skills</SubmitButton>
    </form>
  );
}
