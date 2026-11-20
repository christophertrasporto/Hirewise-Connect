"use client";

import { useActionState } from "react";
import Link from "next/link";
import { BadgeCheck, GraduationCap } from "lucide-react";
import { saveSoftwareAction } from "@/app/(app)/actions";
import { idle } from "@/server/http/action-result";
import { SubmitButton, FormAlert, Select } from "@/components/ui/Form";
import { Card } from "@/components/app/ui";
import { SKILL_LEVELS } from "@/lib/options";

type Tax = { id: string; name: string; category: string };
type Mine = { skillId: string; verified: boolean; hashtag: string; name: string; courses: Array<{ id: string; title: string }> };

function groupBy<T extends { category: string }>(items: T[]) {
  const map = new Map<string, T[]>();
  for (const i of items) map.set(i.category, [...(map.get(i.category) ?? []), i]);
  return [...map.entries()];
}

/**
 * Skills are never typed or picked here: a skill appears because a course the talent has access to carries it, and the
 * check mark means they also passed it. Only the software list is edited on this page.
 */
export function SkillsForm({ software, mine, selectedSoftware }: { software: Tax[]; mine: Mine[]; selectedSoftware: Record<string, string> }) {
  const [state, action] = useActionState(saveSoftwareAction, idle);
  return (
    <div className="space-y-5">
      <Card title={<span className="inline-flex items-center gap-2"><GraduationCap className="h-4 w-4 text-brand-600" /> Skills from your courses</span>} description="Your skills come from the Hirewise courses you have taken, so they are proof, not claims. Buy or finish more courses to add more.">
        {mine.length === 0 ? (
          <p className="text-[13.5px] text-ink-500">No skills yet. <Link href="/courses" className="font-semibold text-brand-600 hover:text-brand-700">Browse courses</Link> to build your skills.</p>
        ) : (
          <ul className="space-y-2.5">
            {mine.map((m) => (
              <li key={m.skillId} className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 font-semibold text-brand-700">
                  {m.verified && <BadgeCheck className="h-3.5 w-3.5" aria-label="Passed the course" />}
                  {m.hashtag}
                </span>
                <span className="text-[12.5px] text-ink-400">
                  {m.courses.map((c, i) => (
                    <span key={c.id}>{i > 0 && ", "}<Link href={`/courses/${c.id}`} className="hover:text-brand-700">{c.title}</Link></span>
                  ))}
                  {m.verified ? " · passed" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <form action={action} className="space-y-5" noValidate>
        <Card title="Software" description="Tools you can use on day one. This part is optional and is your own description.">
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
        <SubmitButton pendingText="Saving…">Save software</SubmitButton>
      </form>
    </div>
  );
}
