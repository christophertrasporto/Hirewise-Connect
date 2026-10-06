"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, FileText, RotateCcw, Upload } from "lucide-react";
import { requestSubmissionUploadAction, submitAssignmentAction } from "@/app/(app)/lesson-actions";
import { idle, type ActionResult } from "@/server/http/action-result";
import { Field, FormAlert, Input, SubmitButton, Textarea } from "@/components/ui/Form";
import { fmtBytes } from "@/components/academy/lesson-meta";

export type AssignmentSubmissionView = { id: string; status: string; submissionType: string; text: string | null; url: string | null; fileName: string | null; hasFile: boolean; grade: number | null; feedback: string | null; submittedAt: Date | string; reviewedAt: Date | string | null };

type Props = { lessonId: string; courseId: string; submissionType: "TEXT" | "URL" | "DOCUMENT" | "OTHER"; dueAt: Date | string | null; points: number | null; submission: AssignmentSubmissionView | null; lessonStatus: string | undefined };

const fmt = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "");
type FileState = { phase: "idle" | "uploading" | "done" | "error"; progress?: number; message?: string; key?: string; fileName?: string; sizeBytes?: number };

/** Learner side of an assignment: current status, coach feedback, and the submission form by submission type. */
export function AssignmentPanel(p: Props) {
  const router = useRouter();
  const [state, action] = useActionState(submitAssignmentAction, idle as ActionResult<{ late: boolean }>);
  const [file, setFile] = useState<FileState>({ phase: "idle" });
  const [resubmit, setResubmit] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const fe = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  const s = p.submission;
  const overdue = !!p.dueAt && Date.now() > new Date(p.dueAt).getTime();
  const canSubmit = !s || (s.status === "RETURNED" && resubmit);

  async function upload(f: File) {
    setFile({ phase: "uploading", progress: 0 });
    const req = await requestSubmissionUploadAction({ lessonId: p.lessonId, contentType: f.type || "application/octet-stream", sizeBytes: f.size, fileName: f.name });
    if (!req.ok || !req.data) return setFile({ phase: "error", message: req.error ?? "Upload could not start." });
    const ok = await new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open(req.data!.method, req.data!.url);
      for (const [k, v] of Object.entries(req.data!.headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => e.lengthComputable && setFile({ phase: "uploading", progress: Math.round((e.loaded / e.total) * 100) });
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => resolve(false);
      xhr.send(f);
    });
    if (!ok) return setFile({ phase: "error", message: "The upload failed. Check your connection and try again." });
    setFile({ phase: "done", key: req.data.key, fileName: f.name, sizeBytes: f.size });
    if (input.current) input.current.value = "";
  }

  const wantsText = p.submissionType === "TEXT" || p.submissionType === "OTHER";
  const wantsUrl = p.submissionType === "URL" || p.submissionType === "OTHER";
  const wantsFile = p.submissionType === "DOCUMENT" || p.submissionType === "OTHER";

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-ink-500">
        {p.dueAt ? <span className={overdue ? "font-semibold text-gold-700" : ""}><Clock className="mr-1 inline h-3.5 w-3.5" />Due {fmt(p.dueAt)}{overdue ? " · past due" : ""}</span> : "No due date"}
        {p.points ? ` · ${p.points} points` : ""}
        {" · "}
        {p.submissionType === "TEXT" ? "Written answer" : p.submissionType === "URL" ? "Submit a link" : p.submissionType === "DOCUMENT" ? "Upload a file" : "Note, link, or file"}
      </p>

      {s && (
        <div className={`rounded-2xl border p-4 ${s.status === "GRADED" ? "border-brand-200 bg-brand-50/50" : s.status === "RETURNED" ? "border-gold-200 bg-gold-50/50" : "border-ink-100 bg-ink-50/60"}`}>
          <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-ink-900">
            {s.status === "GRADED" ? <><CheckCircle2 className="h-4 w-4 text-brand-600" /> Graded{s.grade !== null ? ` · ${s.grade}${p.points ? ` / ${p.points}` : ""} points` : ""}</> : s.status === "RETURNED" ? <><RotateCcw className="h-4 w-4 text-gold-600" /> Returned for changes</> : <><Clock className="h-4 w-4 text-ink-400" /> Submitted · awaiting your coach&apos;s review</>}
            <span className="font-normal text-ink-400">· {fmt(s.submittedAt)}</span>
          </p>
          {s.feedback && <p className="mt-2 whitespace-pre-line text-[14px] text-ink-700"><span className="font-semibold text-ink-800">Coach feedback:</span> {s.feedback}</p>}
          <div className="mt-2 space-y-1 text-[13px] text-ink-600">
            {s.text && <p className="whitespace-pre-line">{s.text}</p>}
            {s.url && <a href={s.url} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-brand-600">{s.url}</a>}
            {s.hasFile && <a href={`/api/academy/submissions/${s.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-brand-600"><FileText className="h-3.5 w-3.5" /> {s.fileName ?? "Your file"}</a>}
          </div>
          {s.status === "RETURNED" && !resubmit && <button type="button" onClick={() => setResubmit(true)} className="mt-3 inline-flex h-10 items-center rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white hover:bg-ink-800">Submit a new version</button>}
        </div>
      )}

      {canSubmit && (
        <form action={action} className="space-y-3 rounded-2xl border border-brand-100 bg-brand-50/40 p-4" noValidate>
          <input type="hidden" name="lessonId" value={p.lessonId} />
          <input type="hidden" name="courseId" value={p.courseId} />
          <input type="hidden" name="storageKey" value={file.key ?? ""} />
          <input type="hidden" name="fileName" value={file.fileName ?? ""} />
          {wantsText && (
            <Field label={p.submissionType === "OTHER" ? "Notes" : "Your answer"} htmlFor={`as-text-${p.lessonId}`} error={fe.text}>
              <Textarea id={`as-text-${p.lessonId}`} name="text" rows={p.submissionType === "TEXT" ? 8 : 3} invalid={!!fe.text} placeholder={p.submissionType === "TEXT" ? "Write your answer here" : "Anything your coach should know"} />
            </Field>
          )}
          {wantsUrl && (
            <Field label="Link to your work" htmlFor={`as-url-${p.lessonId}`} error={fe.url} hint="Google Docs, Drive, Loom, a website…">
              <Input id={`as-url-${p.lessonId}`} name="url" type="url" placeholder="https://" invalid={!!fe.url} />
            </Field>
          )}
          {wantsFile && (
            <div>
              <p className="mb-2 text-[13px] font-semibold text-ink-700">{p.submissionType === "DOCUMENT" ? "Your file" : "Attach a file (optional)"}</p>
              <label className={`flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed px-4 py-3 text-[13.5px] ${fe.storageKey ? "border-red-300 bg-red-50/40" : "border-ink-300 bg-white hover:border-brand-400"}`}>
                <Upload className="h-4 w-4 text-brand-600" />
                <span className="min-w-0 flex-1 truncate">
                  {file.phase === "uploading" ? <span className="font-semibold text-ink-800">Uploading… {file.progress ?? 0}%</span> : file.phase === "done" ? <span className="font-semibold text-ink-800">{file.fileName} <span className="font-normal text-ink-400">{fmtBytes(file.sizeBytes)}</span> · <span className="text-brand-700">replace</span></span> : <span className="font-semibold text-ink-700">Choose a file</span>}
                  <span className="block text-[12px] font-normal text-ink-400">PDF, Word, PowerPoint, Excel, text, image, or zip · up to 50 MB</span>
                </span>
                <input ref={input} type="file" className="sr-only" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.jpg,.jpeg,.png,.webp,.zip" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} disabled={file.phase === "uploading"} />
              </label>
              {file.phase === "error" && <p className="mt-1 text-[12.5px] text-red-600">{file.message}</p>}
              {fe.storageKey && <p className="mt-1 text-[12.5px] text-red-600">{fe.storageKey}</p>}
            </div>
          )}
          {state.error && !state.fieldErrors && <FormAlert>{state.error}</FormAlert>}
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pendingText="Sending…" disabled={file.phase === "uploading"}>{s ? "Send new version" : "Submit assignment"}</SubmitButton>
            {overdue && <span className="text-[12.5px] text-gold-700">This is past the due date; your coach will see that it is late.</span>}
          </div>
        </form>
      )}
      {!s && p.lessonStatus === "COMPLETED" && <p className="text-[13px] font-semibold text-brand-700">Completed.</p>}
    </div>
  );
}
