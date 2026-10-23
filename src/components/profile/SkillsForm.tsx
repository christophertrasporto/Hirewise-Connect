"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Hash, GraduationCap } from "lucide-react";
import { saveSkillsAction } from "@/app/(app)/actions";
import { requestSkillTagAction } from "@/app/(app)/skills-actions";
import { idle } from "@/server/http/action-result";
import { SubmitButton, FormAlert, Select, Input, Checkbox } from "@/components/ui/Form";
import { Card } from "@/components/app/ui";
import { SKILL_LEVELS } from "@/lib/options";
import { cn } from "@/lib/cn";

type Tag = { id: string; name: string; hashtag: string; category: string; verifiable: boolean; courses: Array<{ id: string; title: string }> };
type Tax = { id: string; name: string; category: string };
type Mine = { skillId: string; verified: boolean; verifiedAt: Date | null; hashtag: string; name: string; verifiable: boolean };

function groupBy<T extends { category: string }>(items: T[]) {
  const map = new Map<string, T[]>();
  for (const i of items) map.set(i.category, [...(map.get(i.category) ?? []), i]);
  return [...map.entries()];
}

/**
 * Skills system: two tiers. Skill tags are self-declared hashtags; the "Verified by Hirewise" badge is derived from
 * completed training and cannot be set here. The form only adds and removes declared tags.
 */
export function SkillsForm({ tags, software, mine, selectedSoftware }: { tags: Tag[]; software: Tax[]; mine: Mine[]; selectedSoftware: Record<string, string> }) {
  const [state, action] = useActionState(saveSkillsAction, idle);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set(mine.map((m) => m.skillId)));
  const filtered = useMemo(() => tags.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.hashtag.toLowerCase().includes(q.toLowerCase())), [tags, q]);
  const verified = mine.filter((m) => m.verified);
  const unverified = mine.filter((m) => !m.verified);
  const byId = new Map(tags.map((t) => [t.id, t]));
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={<span className="inline-flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-brand-600" /> Verified by Hirewise</span>} description="Earned through Hirewise courses, assessments, or pathways. You cannot set these yourself; they are computed from what you have completed.">
          {verified.length === 0 ? <p className="text-[13.5px] text-ink-400">No verified skills yet. Complete the mapped course for a tag below to earn the badge.</p> : (
            <div className="flex flex-wrap gap-1.5">{verified.map((m) => <span key={m.skillId} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[12.5px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200"><BadgeCheck className="h-3.5 w-3.5" /> {m.hashtag}</span>)}</div>
          )}
        </Card>
        <Card title={<span className="inline-flex items-center gap-2"><Hash className="h-4 w-4 text-ink-500" /> Your skill tags</span>} description="Self-declared. Searchable by clients, but not proof of anything until verified.">
          {unverified.length === 0 ? <p className="text-[13.5px] text-ink-400">Pick tags below.</p> : (
            <ul className="space-y-1.5">
              {unverified.map((m) => {
                const t = byId.get(m.skillId);
                return (
                  <li key={m.skillId} className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
                    <span className="rounded-full bg-ink-100 px-2.5 py-1 font-medium text-ink-700">{m.hashtag}</span>
                    {t?.verifiable && t.courses.length > 0 ? <span className="inline-flex items-center gap-1 text-[12.5px] text-brand-700"><GraduationCap className="h-3.5 w-3.5" /> Want to verify this skill? <Link href={`/courses/${t.courses[0].id}`} className="font-semibold underline">{t.courses[0].title}</Link></span> : <span className="text-[12px] text-ink-400">{t?.verifiable ? "Verification configured by Hirewise" : "Not verifiable yet"}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <form action={action} className="space-y-5" noValidate>
        <Card title="Choose your skill tags" description="Pick from the Hirewise list; at least three. Is something missing? Request a tag below.">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tags" className="mb-4 max-w-sm" aria-label="Search tags" />
          <div className="space-y-5">
            {groupBy(filtered).map(([category, items]) => (
              <div key={category}>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">{category}</p>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((t) => {
                    const on = selected.has(t.id);
                    return (
                      <label key={t.id} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium ring-1 ring-inset", on ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-ink-700 ring-ink-200 hover:bg-ink-50")}>
                        <input type="checkbox" name="skills" value={t.id} checked={on} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} className="sr-only" />
                        {t.hashtag}
                        {t.verifiable && <BadgeCheck className={cn("h-3.5 w-3.5", on ? "text-brand-300" : "text-brand-600")} aria-label="Can be verified through Hirewise training" />}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[12px] text-ink-400">Legend: <BadgeCheck className="inline h-3.5 w-3.5 text-brand-600" /> can be verified by completing Hirewise training. Verified badges are platform-generated and never self-assigned.</p>
          {state.fieldErrors?.skills && <p className="mt-2 text-[12.5px] font-medium text-red-600">{state.fieldErrors.skills}</p>}
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
        <p className="text-[12px] text-ink-400">Disclaimer: skill tags are self-declared by talent. Only skills marked Verified by Hirewise, and certifications, were confirmed through Hirewise training or assessment.</p>
      </form>

      <RequestTagForm />
    </div>
  );
}

function RequestTagForm() {
  const [state, action] = useActionState(requestSkillTagAction, idle);
  return (
    <Card title="Request a tag" description="Hirewise reviews requests and either adds the tag, merges it into an existing one, or declines.">
      {state.ok ? <FormAlert tone="success">Request sent. You will be notified when Hirewise decides.</FormAlert> : (
        <form action={action} className="flex flex-wrap items-center gap-2" noValidate>
          <Input name="text" placeholder="e.g. Medical billing" className="max-w-xs" />
          <SubmitButton variant="outline" pendingText="Sending…" className="h-10 text-[13.5px]"><Hash className="h-4 w-4" /> Request tag</SubmitButton>
          {state.error && <FormAlert>{state.error}</FormAlert>}
        </form>
      )}
      <Checkbox name="noop" className="hidden" label="" />
    </Card>
  );
}
