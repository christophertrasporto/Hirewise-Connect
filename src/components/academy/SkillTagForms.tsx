"use client";

import { useActionState, useState } from "react";
import { saveSkillTagAction, savePathwayAction, decideTagRequestAction, setCourseSkillTagsAction } from "@/app/(app)/skills-actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Textarea, Select, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";
import { labelFor, SKILL_VERIFICATION_MODES } from "@/lib/options";

type CourseOpt = { id: string; title: string; status: string };
type PathwayOpt = { id: string; title: string };
type TagOpt = { id: string; name: string; hashtag: string };

export type SkillTagFormValue = { id?: string; name: string; category: string; description: string | null; isActive: boolean; verificationMode: "NONE" | "ANY_COURSE" | "REQUIRED_COURSE" | "PATHWAY"; requiredCourse: { id: string } | null; requiredPathway: { id: string } | null; minAssessmentScore: number; courses: Array<{ id: string; title: string }> };

/** Skills system: Hirewise curates tags and configures how each one is verified. */
export function SkillTagForm({ t, courses, pathways, categories }: { t?: SkillTagFormValue; courses: CourseOpt[]; pathways: PathwayOpt[]; categories: string[] }) {
  const [state, action] = useActionState(saveSkillTagAction, idle);
  const [mode, setMode] = useState<SkillTagFormValue["verificationMode"]>(t?.verificationMode ?? "NONE");
  const fe = state.fieldErrors ?? {};
  const k = t?.id ?? "new";
  return (
    <form action={action} className="space-y-3" noValidate>
      {t?.id && <input type="hidden" name="id" value={t.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor={`name-${k}`} error={fe.name} hint="The hashtag is derived from the name."><Input id={`name-${k}`} name="name" defaultValue={t?.name ?? ""} className="h-10 text-[14px]" /></Field>
        <Field label="Category" htmlFor={`cat-${k}`} error={fe.category}><Input id={`cat-${k}`} name="category" list="skill-categories" defaultValue={t?.category ?? ""} className="h-10 text-[14px]" /></Field>
      </div>
      <datalist id="skill-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <Field label="Description" htmlFor={`desc-${k}`} error={fe.description}><Textarea id={`desc-${k}`} name="description" rows={2} defaultValue={t?.description ?? ""} className="min-h-[56px] text-[14px]" /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Verification" htmlFor={`vm-${k}`} hint="How talent earns Verified by Hirewise for this tag.">
          <Select id={`vm-${k}`} name="verificationMode" value={mode} onChange={(e) => setMode(e.target.value as SkillTagFormValue["verificationMode"])} className="h-10 text-[14px]">
            {SKILL_VERIFICATION_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </Field>
        {mode === "REQUIRED_COURSE" && (
          <Field label="Required course" htmlFor={`rc-${k}`}>
            <Select id={`rc-${k}`} name="requiredCourseId" defaultValue={t?.requiredCourse?.id ?? ""} className="h-10 text-[14px]">
              <option value="">Choose a course</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.title}{c.status !== "PUBLISHED" ? ` (${labelFor(c.status)})` : ""}</option>)}
            </Select>
          </Field>
        )}
        {mode === "PATHWAY" && (
          <Field label="Pathway" htmlFor={`rp-${k}`}>
            <Select id={`rp-${k}`} name="requiredPathwayId" defaultValue={t?.requiredPathway?.id ?? ""} className="h-10 text-[14px]">
              <option value="">Choose a pathway</option>
              {pathways.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </Select>
          </Field>
        )}
        {mode !== "NONE" && <Field label="Min exam score %" htmlFor={`ms-${k}`} error={fe.minAssessmentScore} hint="Applies only to courses with a final exam."><Input id={`ms-${k}`} name="minAssessmentScore" type="number" min={0} max={100} defaultValue={t?.minAssessmentScore ?? 80} className="h-10 text-[14px]" /></Field>}
      </div>
      {mode === "ANY_COURSE" && <p className="text-[12.5px] text-ink-500">Mapped courses: {t?.courses.length ? t.courses.map((c) => c.title).join(", ") : "none yet. Coaches map tags from the course builder (Certification tab)."}</p>}
      <Checkbox name="isActive" defaultChecked={t?.isActive ?? true} label="Active (talent can pick it)" />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Saved. Verification was recomputed for every holder.</FormAlert>}
      <SubmitButton variant="outline" pendingText="Saving…" className="h-9 text-[13px]">{t ? "Save tag" : "Create tag"}</SubmitButton>
    </form>
  );
}

export function PathwayForm({ p, courses }: { p?: { id: string; title: string; description: string | null; isActive: boolean; courses: Array<{ id: string; isRequired: boolean }> }; courses: CourseOpt[] }) {
  const [state, action] = useActionState(savePathwayAction, idle);
  const fe = state.fieldErrors ?? {};
  const k = p?.id ?? "new";
  const chosen = new Map(p?.courses.map((c) => [c.id, c.isRequired]) ?? []);
  return (
    <form action={action} className="space-y-3" noValidate>
      {p?.id && <input type="hidden" name="id" value={p.id} />}
      <Field label="Title" htmlFor={`pt-${k}`} error={fe.title}><Input id={`pt-${k}`} name="title" defaultValue={p?.title ?? ""} className="h-10 text-[14px]" /></Field>
      <Field label="Description" htmlFor={`pd-${k}`} error={fe.description}><Textarea id={`pd-${k}`} name="description" rows={2} defaultValue={p?.description ?? ""} className="min-h-[56px] text-[14px]" /></Field>
      <div>
        <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Courses (checked = in the pathway; required ones must all be passed)</p>
        <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-ink-100 p-3">
          {courses.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px]">
              <Checkbox name="courseIds" value={c.id} defaultChecked={chosen.has(c.id)} label={`${c.title}${c.status !== "PUBLISHED" ? ` (${labelFor(c.status)})` : ""}`} />
              <Checkbox name={`required:${c.id}`} defaultChecked={chosen.get(c.id) ?? true} label={<span className="text-ink-500">required</span>} className="text-[12.5px]" />
            </div>
          ))}
          {courses.length === 0 && <p className="text-[13px] text-ink-400">No courses yet.</p>}
        </div>
      </div>
      <Checkbox name="isActive" defaultChecked={p?.isActive ?? true} label="Active" />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Saved.</FormAlert>}
      <SubmitButton variant="outline" pendingText="Saving…" className="h-9 text-[13px]">{p ? "Save pathway" : "Create pathway"}</SubmitButton>
    </form>
  );
}

export function TagRequestDecisionForm({ requestId, tags, categories }: { requestId: string; tags: TagOpt[]; categories: string[] }) {
  const [state, action] = useActionState(decideTagRequestAction, idle);
  const [decision, setDecision] = useState<"APPROVE" | "MERGE" | "REJECT">("APPROVE");
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="requestId" value={requestId} />
      <Select name="decision" value={decision} onChange={(e) => setDecision(e.target.value as "APPROVE" | "MERGE" | "REJECT")} className="h-9 w-[150px] text-[13px]" aria-label="Decision">
        <option value="APPROVE">Approve as new tag</option>
        <option value="MERGE">Merge into existing</option>
        <option value="REJECT">Reject</option>
      </Select>
      {decision === "APPROVE" && <Input name="category" list="skill-categories-req" placeholder="Category" className="h-9 w-[160px] text-[13px]" aria-label="Category" />}
      <datalist id="skill-categories-req">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      {decision === "MERGE" && (
        <Select name="mergeIntoSkillId" defaultValue="" className="h-9 w-[220px] text-[13px]" aria-label="Merge into">
          <option value="">Choose a tag</option>
          {tags.map((t) => <option key={t.id} value={t.id}>{t.hashtag}</option>)}
        </Select>
      )}
      <Input name="note" placeholder={decision === "REJECT" ? "Reason (sent to the requester)" : "Note (optional)"} className="h-9 w-[240px] text-[13px]" aria-label="Note" />
      <SubmitButton variant="outline" pendingText="…" className="h-9 px-3 text-[12.5px]">Decide</SubmitButton>
      {state.ok && <span className="text-[12px] font-semibold text-brand-700">Done</span>}
      {state.error && <span className="w-full text-[12px] text-red-600">{state.error}</span>}
    </form>
  );
}

/** Course builder → Certification: the tags this course verifies (ANY_COURSE mode). */
export function CourseSkillTagsForm({ courseId, tags, selected }: { courseId: string; tags: Array<TagOpt & { category: string; verifiable: boolean }>; selected: string[] }) {
  const [state, action] = useActionState(setCourseSkillTagsAction, idle);
  const [q, setQ] = useState("");
  const on = new Set(selected);
  const shown = tags.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.hashtag.toLowerCase().includes(q.toLowerCase()));
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="courseId" value={courseId} />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter tags" className="h-9 max-w-xs text-[13px]" aria-label="Filter tags" />
      <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-ink-100 p-3">
        {shown.map((t) => <Checkbox key={t.id} name="skillIds" value={t.id} defaultChecked={on.has(t.id)} label={<span>{t.hashtag} <span className="text-ink-400">· {t.category}{t.verifiable ? "" : " · tag not verifiable yet"}</span></span>} className="text-[13.5px]" />)}
        {shown.length === 0 && <p className="text-[13px] text-ink-400">No tags match.</p>}
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Saved. Learners who already passed this course were re-evaluated.</FormAlert>}
      <SubmitButton variant="outline" pendingText="Saving…" className="h-9 text-[13px]">Save course tags</SubmitButton>
    </form>
  );
}
