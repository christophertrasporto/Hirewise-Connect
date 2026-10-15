"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileText, Trash2, Upload } from "lucide-react";
import { submitApplicationAction, updateApplicationAction, withdrawApplicationAction, requestApplicationUploadAction, attachApplicationDocumentAction, removeApplicationDocumentAction } from "@/app/(app)/agency-actions";
import { idle, type ActionResult } from "@/server/http/action-result";
import { Checkbox, Field, FormAlert, Input, Select, SubmitButton, Textarea } from "@/components/ui/Form";
import { COUNTRIES } from "@/lib/options";
import { TermsCheckbox, type TermsBundleProp } from "@/components/terms/TermsDrawer";
import { fmtBytes } from "@/components/academy/lesson-meta";

export const AGENCY_SERVICES = ["Cold Calling", "Appointment Setting", "Sales", "Customer Service", "Virtual Assistance", "Lead Generation", "Technical Support", "Back Office", "Recruitment", "Other"] as const;

export type ApplyFormValues = { id?: string; status?: string; applicantFullName: string; applicantPhone: string | null; proposedAgencyName: string; businessRegistration: string | null; country: string; city: string | null; website: string | null; socialLinks: string[]; teamSize: number; yearsExperience: number; services: string[]; description: string; applicantVisibleMessage?: string | null; documents?: Array<{ id: string; name: string }>; preferredPlanKey?: string | null };

/** The application form: creates a new application, or edits one that is SUBMITTED or NEEDS_MORE_INFO. */
export function ApplyForm({ values, agreement, defaultEmail, plans = [] }: { values?: ApplyFormValues; plans?: Array<{ key: string; name: string; baseAgentSeats: number | null; priceLabel: string }>; agreement: { id: string; title: string; version: number; bodyMarkdown: string; bundle: TermsBundleProp }; defaultEmail: string }) {
  const router = useRouter();
  const editing = !!values?.id;
  const [createState, createAction] = useActionState(submitApplicationAction, idle as ActionResult<{ id: string }>);
  const [updateState, updateAction] = useActionState(updateApplicationAction, idle);
  const state = editing ? updateState : createState;
  const fe = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  if (!editing && createState.ok) return <FormAlert tone="success">Application submitted. Hirewise will review it and you will be notified by email and here.</FormAlert>;
  const needsInfo = values?.status === "NEEDS_MORE_INFO";

  return (
    <form action={editing ? updateAction : createAction} className="space-y-6" noValidate>
      {editing && <input type="hidden" name="applicationId" value={values!.id} />}
      {needsInfo && values?.applicantVisibleMessage && <FormAlert tone="info"><span className="font-semibold">Hirewise asked:</span> {values.applicantVisibleMessage}</FormAlert>}

      <section className="space-y-4">
        <h3 className="text-[15px] font-bold text-ink-900">About you</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="ap-name" error={fe.applicantFullName}><Input id="ap-name" name="applicantFullName" defaultValue={values?.applicantFullName ?? ""} required invalid={!!fe.applicantFullName} /></Field>
          <Field label="Email" htmlFor="ap-email" hint="Your account email; Hirewise replies here."><Input id="ap-email" value={defaultEmail} readOnly className="bg-ink-50" /></Field>
          <Field label="Phone (optional)" htmlFor="ap-phone" error={fe.applicantPhone}><Input id="ap-phone" name="applicantPhone" type="tel" defaultValue={values?.applicantPhone ?? ""} /></Field>
          <Field label="Years of experience running or leading a team" htmlFor="ap-years" error={fe.yearsExperience}><Input id="ap-years" name="yearsExperience" type="number" min={0} max={60} defaultValue={values?.yearsExperience ?? 0} /></Field>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-[15px] font-bold text-ink-900">Your agency</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proposed agency name" htmlFor="ap-agency" error={fe.proposedAgencyName} className="sm:col-span-2"><Input id="ap-agency" name="proposedAgencyName" defaultValue={values?.proposedAgencyName ?? ""} required invalid={!!fe.proposedAgencyName} placeholder="e.g. ABC Virtual Assistants" /></Field>
          <Field label="Business registration (optional)" htmlFor="ap-reg" error={fe.businessRegistration} hint="Registration or tax number if you have one."><Input id="ap-reg" name="businessRegistration" defaultValue={values?.businessRegistration ?? ""} /></Field>
          <Field label="Current team size" htmlFor="ap-team" error={fe.teamSize}><Input id="ap-team" name="teamSize" type="number" min={0} max={10000} defaultValue={values?.teamSize ?? 0} /></Field>
          {plans.length > 0 && (
            <Field label="Preferred membership plan (optional)" htmlFor="ap-plan" hint="Plans set how many agent seats your agency starts with. Hirewise confirms the plan at approval." error={fe.preferredPlanKey}>
              <Select id="ap-plan" name="preferredPlanKey" defaultValue={values?.preferredPlanKey ?? ""}><option value="">Decide later with Hirewise</option>{plans.map((p) => <option key={p.key} value={p.key}>{p.name} · {p.baseAgentSeats === null ? "custom seats" : `${p.baseAgentSeats} agent seats`} · {p.priceLabel}</option>)}</Select>
            </Field>
          )}
          <Field label="Country" htmlFor="ap-country" error={fe.country}>
            <Select id="ap-country" name="country" defaultValue={values?.country ?? "Philippines"} invalid={!!fe.country}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
          <Field label="City (optional)" htmlFor="ap-city" error={fe.city}><Input id="ap-city" name="city" defaultValue={values?.city ?? ""} /></Field>
          <Field label="Website (optional)" htmlFor="ap-web" error={fe.website}><Input id="ap-web" name="website" type="url" placeholder="https://" defaultValue={values?.website ?? ""} invalid={!!fe.website} /></Field>
          <Field label="Social links (optional)" htmlFor="ap-social" error={fe.socialLinks} hint="One per line. LinkedIn, Facebook page, and similar."><Textarea id="ap-social" name="socialLinks" rows={2} defaultValue={values?.socialLinks.join("\n") ?? ""} /></Field>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-semibold text-ink-700">Services and specialisations</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {AGENCY_SERVICES.map((s) => <Checkbox key={s} name="services" value={s} defaultChecked={values?.services.includes(s) ?? false} label={s} />)}
          </div>
          {fe.services && <p className="mt-1 text-[12.5px] text-red-600">{fe.services}</p>}
        </div>
        <Field label="Tell us about your team and why you want to join Hirewise Connect" htmlFor="ap-desc" error={fe.description} hint="How your team works today, the campaigns you have run, what you expect from Hirewise. At least 40 characters.">
          <Textarea id="ap-desc" name="description" rows={7} defaultValue={values?.description ?? ""} invalid={!!fe.description} />
        </Field>
      </section>

      {!editing && (
        <section className="space-y-2">
          <p className="text-[14px] font-semibold text-ink-900">{agreement.title} <span className="font-normal text-ink-400">· version {agreement.version}</span></p>
          <p className="text-[13px] text-ink-500">Applying records your acceptance again in the application context. Clients and opportunities introduced through Hirewise Connect are engaged only through Hirewise.</p>
          <TermsCheckbox bundle={agreement.bundle} name="agreementAccepted" error={fe.agreementAccepted} />
        </section>
      )}

      {state.error && !Object.keys(fe).length && <FormAlert>{state.error}</FormAlert>}
      {state.error && Object.keys(fe).length > 0 && <FormAlert>{state.error}</FormAlert>}
      <div className="flex flex-wrap items-center gap-3">
        {editing ? (
          <>
            <SubmitButton name="intent" value="save" pendingText="Saving…" variant="outline">Save changes</SubmitButton>
            {needsInfo && <SubmitButton name="intent" value="resubmit" pendingText="Sending…">Save and resubmit</SubmitButton>}
            {updateState.ok && <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-700"><CheckCircle2 className="h-4 w-4" /> Saved</span>}
          </>
        ) : (
          <SubmitButton pendingText="Submitting…">Submit application</SubmitButton>
        )}
      </div>
    </form>
  );
}

/** Supporting documents: upload straight to storage, then attach. Only while the application is editable. */
export function ApplicationDocuments({ applicationId, documents, editable, maxDocuments }: { applicationId: string; documents: Array<{ id: string; name: string }>; editable: boolean; maxDocuments: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ phase: "idle" | "uploading" | "error"; progress?: number; message?: string }>({ phase: "idle" });
  const [removeState, removeAction] = useActionState(removeApplicationDocumentAction, idle);
  useEffect(() => {
    if (removeState.ok) router.refresh();
  }, [removeState.ok, router]);

  async function upload(f: File) {
    setState({ phase: "uploading", progress: 0 });
    const req = await requestApplicationUploadAction({ applicationId, contentType: f.type || "application/octet-stream", sizeBytes: f.size, fileName: f.name });
    if (!req.ok || !req.data) return setState({ phase: "error", message: req.error ?? "Upload could not start." });
    const ok = await new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open(req.data!.method, req.data!.url);
      for (const [k, v] of Object.entries(req.data!.headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => e.lengthComputable && setState({ phase: "uploading", progress: Math.round((e.loaded / e.total) * 100) });
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => resolve(false);
      xhr.send(f);
    });
    if (!ok) return setState({ phase: "error", message: "The upload failed. Check your connection and try again." });
    const att = await attachApplicationDocumentAction({ applicationId, storageKey: req.data.key });
    if (!att.ok) return setState({ phase: "error", message: att.error ?? "Could not attach the file." });
    setState({ phase: "idle" });
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {documents.length === 0 ? <p className="text-[13.5px] text-ink-500">No documents yet. Business registration, portfolio, client references, or team structure help the review.</p> : (
        <ul className="divide-y divide-ink-100">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-[13.5px]">
              <a href={`/api/agency/documents/${d.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-semibold text-brand-600 hover:text-brand-700"><FileText className="h-4 w-4" /> {d.name}</a>
              {editable && (
                <form action={removeAction}><input type="hidden" name="applicationId" value={applicationId} /><input type="hidden" name="documentId" value={d.id} /><button type="submit" aria-label={`Remove ${d.name}`} className="rounded-full p-1.5 text-ink-400 hover:bg-ink-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></form>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && documents.length < maxDocuments && (
        <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-ink-300 bg-white px-4 py-3 text-[13.5px] hover:border-brand-400">
          <Upload className="h-4 w-4 text-brand-600" />
          <span className="min-w-0 flex-1">{state.phase === "uploading" ? <span className="font-semibold text-ink-800">Uploading… {state.progress ?? 0}%</span> : <span className="font-semibold text-ink-700">Add a document</span>}<span className="block text-[12px] font-normal text-ink-400">PDF, Word, or image · {documents.length} of {maxDocuments} used</span></span>
          <input ref={input} type="file" className="sr-only" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} disabled={state.phase === "uploading"} />
        </label>
      )}
      {state.phase === "error" && <p className="text-[12.5px] text-red-600">{state.message}</p>}
      {removeState.error && <p className="text-[12.5px] text-red-600">{removeState.error}</p>}
      <p className="text-[12px] text-ink-400">{fmtBytes(0) ? "" : ""}Documents are visible only to you and Hirewise reviewers.</p>
    </div>
  );
}

export function WithdrawButton({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [state, action] = useActionState(withdrawApplicationAction, idle);
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);
  return (
    <form action={action} onSubmit={(e) => !window.confirm("Withdraw this application? You can apply again later.") && e.preventDefault()}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <SubmitButton variant="outline" pendingText="Withdrawing…" className="h-10 text-[13.5px]">Withdraw application</SubmitButton>
      {state.error && <p className="mt-1 text-[12.5px] text-red-600">{state.error}</p>}
    </form>
  );
}
