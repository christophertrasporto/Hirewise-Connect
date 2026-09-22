"use client";

import { useActionState } from "react";
import { courseWorkflowAction, recordAssessmentAction, recordCoursePaymentAction, certificationReviewAction, issueCertificationAction, setVerificationAction } from "@/app/(app)/academy-actions";
import { idle } from "@/server/http/action-result";
import { Field, Input, Select, Textarea, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";

export function CourseWorkflowButton({ courseId, op, label, variant = "dark", confirm, templates }: { courseId: string; op: "SUBMIT" | "PUBLISH" | "ARCHIVE"; label: string; variant?: "dark" | "primary" | "outline" | "danger"; confirm?: string; templates?: Array<{ id: string; name: string }>; }) {
  const [state, action] = useActionState(courseWorkflowAction, idle);
  return (
    <form action={action} className="space-y-2" onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="op" value={op} />
      {templates && (
        <Select name="certificationTemplateId" defaultValue="" className="h-10 text-[13.5px]" aria-label="Certification template">
          <option value="">No certification on completion</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      )}
      <SubmitButton variant={variant} pendingText="Working…" className="h-10 text-[13.5px]">{label}</SubmitButton>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Done.</FormAlert>}
    </form>
  );
}

export function AssessmentForm({ courseId, agentProfileId, displayName, labels, examScore }: { courseId: string; agentProfileId: string; displayName: string; labels: Array<{ id: string; label: string; rank: number }>; examScore: number | null }) {
  const [state, action] = useActionState(recordAssessmentAction, idle);
  const fe = state.fieldErrors ?? {};
  if (state.ok) return <FormAlert tone="success">Assessment recorded for {displayName}. The certification pipeline and verification level were updated.</FormAlert>;
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="agentProfileId" value={agentProfileId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Assessment type" htmlFor="type" error={fe.type}>
          <Select id="type" name="type" defaultValue="ROLEPLAY">
            <option value="EXAM">Exam review</option>
            <option value="PRACTICAL">Practical task</option>
            <option value="ROLEPLAY">Role-play</option>
            <option value="MOCK_CALL">Mock call</option>
            <option value="SKILL">Skill check</option>
          </Select>
        </Field>
        <Field label="Result" htmlFor="resultLabelId" error={fe.resultLabelId}>
          <Select id="resultLabelId" name="resultLabelId" defaultValue="" invalid={!!fe.resultLabelId}>
            <option value="" disabled>Choose…</option>
            {labels.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Exam %" htmlFor="examScore" error={fe.examScore}><Input id="examScore" name="examScore" type="number" min={0} max={100} defaultValue={examScore ?? ""} /></Field>
        <Field label="Practical %" htmlFor="practicalScore" error={fe.practicalScore}><Input id="practicalScore" name="practicalScore" type="number" min={0} max={100} /></Field>
        <Field label="Role-play %" htmlFor="roleplayScore" error={fe.roleplayScore}><Input id="roleplayScore" name="roleplayScore" type="number" min={0} max={100} /></Field>
        <Field label="Communication %" htmlFor="communicationScore" error={fe.communicationScore}><Input id="communicationScore" name="communicationScore" type="number" min={0} max={100} /></Field>
      </div>
      <Field label="Strengths" htmlFor="strengths" error={fe.strengths} hint="Shared with the student."><Textarea id="strengths" name="strengths" rows={2} /></Field>
      <Field label="Areas for improvement" htmlFor="areasForImprovement" error={fe.areasForImprovement} hint="Shared with the student, never with clients."><Textarea id="areasForImprovement" name="areasForImprovement" rows={2} /></Field>
      <Field label="Internal comments" htmlFor="comments" error={fe.comments} hint="Hirewise staff only."><Textarea id="comments" name="comments" rows={2} /></Field>
      <Checkbox name="certificationRecommended" label="Recommend certification" />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant="primary" pendingText="Saving…">Finalise assessment</SubmitButton>
    </form>
  );
}

export function PaymentForm({ enrollmentId, priceLabel }: { enrollmentId: string; priceLabel: string }) {
  const [state, action] = useActionState(recordCoursePaymentAction, idle);
  if (state.ok) return <FormAlert tone="success">Recorded. The course is unlocked for the student.</FormAlert>;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <Input name="paidUsd" inputMode="decimal" placeholder={`Amount (${priceLabel})`} className="h-9 w-[150px] text-[13px]" />
      <Input name="reference" placeholder="Reference (GCash, bank)" className="h-9 w-[190px] text-[13px]" />
      <Input name="reason" placeholder="Reason (if waiving)" className="h-9 w-[170px] text-[13px]" />
      <Checkbox name="waived" label={<span className="text-[13px]">Waive</span>} />
      <SubmitButton variant="outline" pendingText="…" className="h-9 px-3 text-[12.5px]">Record</SubmitButton>
      {state.error && <span className="w-full text-[12px] text-red-600">{state.error}</span>}
    </form>
  );
}

export function CertificationReviewActions({ certificationId, mode }: { certificationId: string; mode: "PENDING" | "APPROVED" }) {
  const [state, action] = useActionState(certificationReviewAction, idle);
  if (state.ok) return <span className="text-[12.5px] font-semibold text-brand-700">Updated.</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {mode === "PENDING" && (
        <form action={action}>
          <input type="hidden" name="certificationId" value={certificationId} />
          <input type="hidden" name="op" value="APPROVE" />
          <SubmitButton variant="primary" pendingText="…" className="h-8 px-3 text-[12.5px]">Approve</SubmitButton>
        </form>
      )}
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="certificationId" value={certificationId} />
        <input type="hidden" name="op" value={mode === "PENDING" ? "REJECT" : "REVOKE"} />
        <Input name="reason" placeholder="Reason" className="h-8 w-[160px] text-[12.5px]" required />
        <SubmitButton variant="danger" pendingText="…" className="h-8 px-3 text-[12.5px]">{mode === "PENDING" ? "Reject" : "Revoke"}</SubmitButton>
      </form>
      {state.error && <span className="text-[12px] text-red-600">{state.error}</span>}
    </div>
  );
}

export function IssueCertificationForm({ agentProfileId, templates }: { agentProfileId: string; templates: Array<{ id: string; name: string }> }) {
  const [state, action] = useActionState(issueCertificationAction, idle);
  if (state.ok) return <FormAlert tone="success">Certification issued.</FormAlert>;
  return (
    <form action={action} className="space-y-2.5" noValidate>
      <input type="hidden" name="agentProfileId" value={agentProfileId} />
      <Select name="templateId" defaultValue="" className="h-10 text-[13.5px]" aria-label="Certification">
        <option value="" disabled>Choose certification…</option>
        {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </Select>
      <Input name="reason" placeholder="Reason (required, audited)" className="h-10 text-[13.5px]" required />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant="outline" pendingText="Issuing…" className="h-9 text-[13px]">Issue directly</SubmitButton>
    </form>
  );
}

export function VerificationForm({ agentProfileId, current, levels }: { agentProfileId: string; current: string; levels: readonly string[] }) {
  const [state, action] = useActionState(setVerificationAction, idle);
  if (state.ok) return <FormAlert tone="success">Verification level set manually. The next recompute will clear the manual flag.</FormAlert>;
  return (
    <form action={action} className="space-y-2.5" noValidate>
      <input type="hidden" name="agentProfileId" value={agentProfileId} />
      <Select name="level" defaultValue={current} className="h-10 text-[13.5px]" aria-label="Verification level">
        {levels.map((l) => <option key={l} value={l}>{l.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</option>)}
      </Select>
      <Input name="reason" placeholder="Reason (required, audited)" className="h-10 text-[13.5px]" required />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant="outline" pendingText="Saving…" className="h-9 text-[13px]">Set manually</SubmitButton>
    </form>
  );
}
