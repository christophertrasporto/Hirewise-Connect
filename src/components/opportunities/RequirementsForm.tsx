"use client";

import { useActionState, useState } from "react";
import { setOpportunityRequirementsAction } from "@/app/(app)/skills-actions";
import { idle } from "@/server/http/action-result";
import { Input, Select, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";

type Tag = { id: string; name: string; hashtag: string; category: string };
type Template = { id: string; name: string };
type Current = Array<{ requiredLevel: string; skill: { id: string } | null; certification: { id: string } | null }>;

/** Skills system: hard requirements for an opportunity. Declared is the default; staff raise to Verified or add a certification. */
export function RequirementsForm({ opportunityId, tags, templates, current }: { opportunityId: string; tags: Tag[]; templates: Template[]; current: Current }) {
  const [state, action] = useActionState(setOpportunityRequirementsAction, idle);
  const [q, setQ] = useState("");
  const levelFor = new Map(current.filter((r) => r.skill).map((r) => [r.skill!.id, r.requiredLevel]));
  const certs = new Set(current.filter((r) => r.certification).map((r) => r.certification!.id));
  const [chosen, setChosen] = useState<Set<string>>(new Set(levelFor.keys()));
  const shown = tags.filter((t) => chosen.has(t.id) || !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.hashtag.toLowerCase().includes(q.toLowerCase()));
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter tags" className="h-9 max-w-xs text-[13px]" aria-label="Filter tags" />
      <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-ink-100 p-3">
        {shown.map((t) => {
          const on = chosen.has(t.id);
          return (
            <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
              <Checkbox name="skillIds" value={t.id} checked={on} onChange={() => setChosen((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} label={<span>{t.hashtag} <span className="text-ink-400">· {t.category}</span></span>} />
              {on && (
                <Select name={`level:${t.id}`} defaultValue={levelFor.get(t.id) ?? "DECLARED"} className="h-8 w-[150px] text-[12.5px]" aria-label={`${t.name} level`}>
                  <option value="DECLARED">Declared is enough</option>
                  <option value="VERIFIED">Verified by Hirewise</option>
                </Select>
              )}
            </div>
          );
        })}
        {shown.length === 0 && <p className="text-[13px] text-ink-400">No tags match.</p>}
      </div>
      {templates.length > 0 && (
        <div>
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Required certifications</p>
          <div className="space-y-1">{templates.map((t) => <Checkbox key={t.id} name="certificationTemplateIds" value={t.id} defaultChecked={certs.has(t.id)} label={t.name} className="text-[13.5px]" />)}</div>
        </div>
      )}
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Saved. Agencies now see which members are blocked.</FormAlert>}
      <SubmitButton variant="outline" pendingText="Saving…" className="h-9 text-[13px]">Save requirements</SubmitButton>
    </form>
  );
}
