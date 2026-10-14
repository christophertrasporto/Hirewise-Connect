"use client";

import { useActionState, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { publishTermsAction } from "@/app/(app)/identity-actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Select, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";

type Section = { key: string; title: string; audiences: string[]; bodyMarkdown: string };
const AUDIENCES: Array<{ key: string; label: string }> = [
  { key: "ALL", label: "Everyone" },
  { key: "AGENT", label: "Freelancer / Agent" },
  { key: "AGENCY_OWNER", label: "Agency Owner" },
  { key: "CLIENT", label: "Client" },
  { key: "TRAINING", label: "Training" },
];

/**
 * Section editor for the unified terms and the privacy policy. Publishing creates a new version; material changes
 * with re-acceptance re-gate everyone in the required roles on their next sign-in.
 */
export function TermsVersionForm({ type, title, sections, nextVersion, mode }: { type: "PLATFORM_TERMS" | "PRIVACY_POLICY"; title: string; sections: Section[]; nextVersion: number; mode: "COMBINED" | "SEPARATE" }) {
  const [state, action] = useActionState(publishTermsAction, idle);
  const [rows, setRows] = useState<Section[]>(sections.length ? sections : [{ key: "section-1", title: "", audiences: ["ALL"], bodyMarkdown: "" }]);
  const fe = state.fieldErrors ?? {};
  const placeholderCount = rows.filter((r) => r.bodyMarkdown.includes("LEGAL_PLACEHOLDER")).length;
  const update = (i: number, patch: Partial<Section>) => setRows((r) => r.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => setRows((r) => { const n = [...r]; const j = i + d; if (j < 0 || j >= n.length) return r; [n[i], n[j]] = [n[j], n[i]]; return n; });
  if (state.ok && state.data) return <FormAlert tone="success">Version {state.data.version} published.{state.data.placeholder ? " It still contains LEGAL_PLACEHOLDER; the readiness check keeps failing until counsel text replaces it." : ""}</FormAlert>;
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="sectionCount" value={rows.length} />
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <Field label="Document title" htmlFor={`tt-${type}`} error={fe.title}><Input id={`tt-${type}`} name="title" defaultValue={title} className="h-10 text-[14px]" /></Field>
        <Field label="Effective from" htmlFor={`te-${type}`} error={fe.effectiveFrom}><Input id={`te-${type}`} name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="h-10 text-[14px]" /></Field>
      </div>
      <div className="space-y-3">
        {rows.map((s, i) => (
          <div key={`${s.key}-${i}`} className="rounded-2xl border border-ink-100 bg-ink-50/50 p-3">
            <input type="hidden" name={`section.${i}.key`} value={s.key} />
            <div className="flex items-center gap-2">
              <span className="w-6 text-[12px] font-bold text-ink-400">{i + 1}.</span>
              <input name={`section.${i}.title`} value={s.title} onChange={(e) => update(i, { title: e.target.value })} placeholder="Section title" className="h-9 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-[13.5px] outline-none focus:border-brand-500" />
              <button type="button" onClick={() => move(i, -1)} aria-label="Move up" className="rounded-lg p-1.5 text-ink-400 hover:bg-white hover:text-ink-900"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" onClick={() => move(i, 1)} aria-label="Move down" className="rounded-lg p-1.5 text-ink-400 hover:bg-white hover:text-ink-900"><ArrowDown className="h-4 w-4" /></button>
              <button type="button" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label="Remove section" className="rounded-lg p-1.5 text-red-500 hover:bg-white"><Trash2 className="h-4 w-4" /></button>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-8 text-[12.5px]">
              {AUDIENCES.map((a) => (
                <label key={a.key} className="inline-flex items-center gap-1.5 text-ink-600">
                  <input type="checkbox" name={`section.${i}.audiences`} value={a.key} checked={s.audiences.includes(a.key)} onChange={(e) => update(i, { audiences: e.target.checked ? [...s.audiences, a.key] : s.audiences.filter((x) => x !== a.key) })} className="h-3.5 w-3.5 rounded border-ink-300" />
                  {a.label}
                </label>
              ))}
            </div>
            <textarea name={`section.${i}.body`} value={s.bodyMarkdown} onChange={(e) => update(i, { bodyMarkdown: e.target.value })} rows={4} className="mt-2 w-full rounded-lg border border-ink-200 bg-white p-3 font-mono text-[12.5px] outline-none focus:border-brand-500" placeholder="Section text (Markdown)" />
          </div>
        ))}
        <button type="button" onClick={() => setRows((r) => [...r, { key: `section-${r.length + 1}-${Date.now().toString(36)}`, title: "", audiences: ["ALL"], bodyMarkdown: "" }])} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-700 hover:text-brand-800"><Plus className="h-4 w-4" /> Add a section</button>
        {fe.sections && <p className="text-[12.5px] text-red-600">{fe.sections}</p>}
      </div>
      <div className="grid gap-3 rounded-2xl border border-ink-100 p-4 sm:grid-cols-2">
        <Checkbox name="isMaterialChange" label="Material change" />
        <Checkbox name="requiresReacceptance" defaultChecked label="Everyone must accept this version on next sign-in" />
        {type === "PLATFORM_TERMS" && (
          <Field label="Privacy Policy acceptance" htmlFor={`pm-${type}`} className="sm:col-span-2">
            <Select id={`pm-${type}`} name="privacyPolicyMode" defaultValue={mode}>
              <option value="COMBINED">Combined: one checkbox accepts the Terms and the Privacy Policy</option>
              <option value="SEPARATE">Separate acknowledgement: the checkbox accepts the Terms and acknowledges the Privacy Policy</option>
            </Select>
          </Field>
        )}
        <Field label="Change note (audited, shown to users on re-acceptance)" htmlFor={`cn-${type}`} error={fe.changeNote} className="sm:col-span-2"><Input id={`cn-${type}`} name="changeNote" placeholder="e.g. Counsel review 2026-11, seat usage clause added" className="h-10 text-[14px]" /></Field>
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant={placeholderCount ? "outline" : "primary"} pendingText="Publishing…" className="h-10 text-[13.5px]">Publish version {nextVersion}{placeholderCount ? ` (${placeholderCount} placeholder section${placeholderCount === 1 ? "" : "s"})` : ""}</SubmitButton>
    </form>
  );
}
