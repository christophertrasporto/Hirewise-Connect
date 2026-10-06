"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Copy, Loader2, Pencil, Plus, Settings2, Trash2, UploadCloud, X } from "lucide-react";
import { deleteLessonAction, deleteModuleAction, duplicateLessonAction, duplicateModuleAction, moveLessonAction, moveModuleAction, requestLessonUploadAction, saveLessonAction, saveModuleAction } from "@/app/(app)/academy-actions";
import { idle, type ActionResult } from "@/server/http/action-result";
import { Checkbox, Field, FormAlert, Input, Select, SubmitButton, Textarea } from "@/components/ui/Form";
import { cn } from "@/lib/cn";
import { fmtBytes, fmtDuration, LESSON_TYPE_META, type LessonContentType } from "@/components/academy/lesson-meta";

export type LessonValue = {
  id: string;
  title: string;
  contentType: LessonContentType;
  description: string | null;
  body: string | null;
  url: string | null;
  fileName: string | null;
  contentMime: string | null;
  sizeBytes: number | null;
  durationSec: number | null;
  hasFile: boolean;
  isRequired: boolean;
  status: "DRAFT" | "PUBLISHED";
  requiredPercent: number | null;
  passingScore: number | null;
  maxAttempts: number | null;
  timeLimitMin: number | null;
  randomizeCount: number | null;
  shuffleAnswers: boolean;
  showCorrectAnswers: boolean;
  showExplanations: boolean;
  retakeWaitMinutes: number | null;
  scorePolicy: "HIGHEST" | "LATEST";
  reviewMode: "AUTO" | "MANUAL" | "BOTH";
  dueAt: Date | string | null;
  points: number | null;
  submissionType: "TEXT" | "URL" | "DOCUMENT" | "OTHER" | null;
  questionCount: number;
};
export type ModuleValue = { id: string; title: string; description: string | null; isRequired: boolean; status: "DRAFT" | "PUBLISHED"; lessons: LessonValue[] };

const iconBtn = "rounded-full p-1.5 text-ink-400 hover:bg-white hover:text-ink-800 disabled:opacity-40";
const QUESTION_TYPES: LessonContentType[] = ["QUIZ", "ASSESSMENT", "AUDIO"];
const MEDIA_TYPES: LessonContentType[] = ["VIDEO", "AUDIO"];
const UPLOAD_KINDS: Partial<Record<LessonContentType, "VIDEO" | "AUDIO" | "DOCUMENT">> = { VIDEO: "VIDEO", AUDIO: "AUDIO", DOCUMENT: "DOCUMENT" };
const ACCEPT: Record<"VIDEO" | "AUDIO" | "DOCUMENT", string> = {
  VIDEO: "video/mp4,video/webm,video/quicktime",
  AUDIO: "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/webm,audio/ogg",
  DOCUMENT: ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv",
};

type SmallAction = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

/** Small forms (move, duplicate, delete) that post a single hidden-field action. */
function IconAction({ action, fields, label, confirm, children, danger }: { action: SmallAction; fields: Record<string, string>; label: string; confirm?: string; children: ReactNode; danger?: boolean }) {
  const [state, act, pending] = useActionState(action, idle);
  return (
    <form action={act} onSubmit={(e) => confirm && !window.confirm(confirm) && e.preventDefault()} className="inline-flex">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" aria-label={label} title={label} disabled={pending} className={cn(iconBtn, danger && "text-red-400 hover:text-red-600")}>{children}</button>
      {state.error && <span className="ml-2 self-center text-[12px] text-red-600">{state.error}</span>}
    </form>
  );
}

function StateBadge({ status, required }: { status: "DRAFT" | "PUBLISHED"; required: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] ring-1 ring-inset", status === "PUBLISHED" ? "bg-brand-50 text-brand-700 ring-brand-200" : "bg-ink-50 text-ink-500 ring-ink-200")}>{status === "PUBLISHED" ? "Published" : "Draft"}</span>
      <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] ring-1 ring-inset", required ? "bg-gold-50 text-gold-700 ring-gold-200" : "bg-white text-ink-400 ring-ink-200")}>{required ? "Required" : "Optional"}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Module form
// ---------------------------------------------------------------------------

function ModuleForm({ courseId, module, onDone }: { courseId: string; module?: ModuleValue; onDone?: () => void }) {
  const [state, action] = useActionState(saveModuleAction, idle);
  const fe = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.ok) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);
  const uid = module?.id ?? "new";
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="courseId" value={courseId} />
      {module && <input type="hidden" name="id" value={module.id} />}
      <input type="hidden" name="isRequired" value="off" />
      <Field label="Module title" htmlFor={`m-title-${uid}`} error={fe.title}>
        <Input id={`m-title-${uid}`} name="title" defaultValue={module?.title ?? ""} placeholder="e.g. Module 1: The first ten seconds" invalid={!!fe.title} />
      </Field>
      <Field label="What this module covers (optional)" htmlFor={`m-desc-${uid}`} error={fe.description}>
        <Textarea id={`m-desc-${uid}`} name="description" rows={2} defaultValue={module?.description ?? ""} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Visibility" htmlFor={`m-status-${uid}`}>
          <Select id={`m-status-${uid}`} name="status" defaultValue={module?.status ?? "PUBLISHED"}>
            <option value="PUBLISHED">Published: learners can see it</option>
            <option value="DRAFT">Draft: hidden from learners</option>
          </Select>
        </Field>
        <div className="pt-7"><Checkbox name="isRequired" defaultChecked={module?.isRequired ?? true} label={<span><span className="font-semibold">Required</span> <span className="text-ink-500">counts toward course completion</span></span>} /></div>
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <div className="flex items-center gap-3">
        <SubmitButton pendingText="Saving…">{module ? "Save module" : "Add module"}</SubmitButton>
        {onDone && <button type="button" onClick={onDone} className="text-[13.5px] font-semibold text-ink-500 hover:text-ink-800">Cancel</button>}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Lesson form: the lesson type drives which fields appear
// ---------------------------------------------------------------------------

type FileState = { phase: "idle" | "uploading" | "done" | "error"; progress?: number; message?: string; key?: string; fileName?: string; contentMime?: string; sizeBytes?: number; durationSec?: number | null };

function readDuration(file: File): Promise<number | null> {
  if (!/^(video|audio)\//.test(file.type)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const el = document.createElement(file.type.startsWith("video") ? "video" : "audio");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(el.src);
      resolve(Number.isFinite(el.duration) ? Math.round(el.duration) : null);
    };
    el.onerror = () => resolve(null);
    el.src = URL.createObjectURL(file);
  });
}

const dateInput = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export function LessonForm({ courseId, modules, moduleId, lesson, onDone, section = "all" }: { courseId: string; modules: Array<{ id: string; title: string }>; moduleId: string; lesson?: LessonValue; onDone?: () => void; section?: "all" | "content" | "settings" }) {
  const [state, action] = useActionState(saveLessonAction, idle);
  const [type, setType] = useState<LessonContentType>(lesson?.contentType ?? "VIDEO");
  const [file, setFile] = useState<FileState>(lesson?.hasFile ? { phase: "done", fileName: lesson.fileName ?? undefined, contentMime: lesson.contentMime ?? undefined, sizeBytes: lesson.sizeBytes ?? undefined, durationSec: lesson.durationSec ?? null } : { phase: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const fe = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.ok) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);
  const uploadKind = UPLOAD_KINDS[type] ?? null;
  const needsFile = type === "AUDIO" || type === "DOCUMENT";
  const isQuiz = QUESTION_TYPES.includes(type);
  const isMedia = MEDIA_TYPES.includes(type);
  const uid = lesson?.id ?? `new-${moduleId}`;
  const showContent = section !== "settings";
  const showSettings = section !== "content";

  async function upload(f: File) {
    if (!uploadKind) return;
    setFile({ phase: "uploading", progress: 0 });
    const req = await requestLessonUploadAction({ courseId, kind: uploadKind, contentType: f.type || "application/octet-stream", sizeBytes: f.size, fileName: f.name });
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
    const durationSec = await readDuration(f);
    setFile({ phase: "done", key: req.data.key, fileName: f.name, contentMime: f.type, sizeBytes: f.size, durationSec });
    if (input.current) input.current.value = "";
  }

  const busy = file.phase === "uploading";
  const Icon = LESSON_TYPE_META[type].icon;

  return (
    <form action={action} className="space-y-4 rounded-2xl border border-brand-100 bg-brand-50/40 p-4" noValidate>
      <input type="hidden" name="courseId" value={courseId} />
      {lesson && <input type="hidden" name="id" value={lesson.id} />}
      <input type="hidden" name="contentType" value={type} />
      <input type="hidden" name="storageKey" value={file.key ?? (lesson?.hasFile && file.phase === "done" ? "__keep__" : "")} />
      <input type="hidden" name="fileName" value={file.fileName ?? ""} />
      <input type="hidden" name="contentMime" value={file.contentMime ?? ""} />
      <input type="hidden" name="sizeBytes" value={file.sizeBytes ?? ""} />
      <input type="hidden" name="durationSec" value={file.durationSec ?? ""} />
      {/* checkbox fallbacks so unticked boxes post an explicit value */}
      <input type="hidden" name="isRequired" value="off" />
      <input type="hidden" name="showCorrectAnswers" value="off" />
      <input type="hidden" name="showExplanations" value="off" />
      {!showContent && <input type="hidden" name="url" value={lesson?.url ?? ""} />}
      {!showContent && <input type="hidden" name="body" value={lesson?.body ?? ""} />}
      {!showSettings && <input type="hidden" name="status" value={lesson?.status ?? "PUBLISHED"} />}
      {!showSettings && lesson?.isRequired && <input type="hidden" name="isRequired" value="on" />}

      <div className="grid gap-4 md:grid-cols-[1fr_200px]">
        <Field label="Lesson title" htmlFor={`l-title-${uid}`} error={fe.title}>
          <Input id={`l-title-${uid}`} name="title" defaultValue={lesson?.title ?? ""} placeholder="e.g. Openers that earn attention" invalid={!!fe.title} />
        </Field>
        <Field label="Module" htmlFor={`l-module-${uid}`} error={fe.moduleId}>
          <Select id={`l-module-${uid}`} name="moduleId" defaultValue={moduleId}>
            {modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </Select>
        </Field>
      </div>

      {showContent && (
        <>
          <div>
            <p className="mb-2 text-[13px] font-semibold text-ink-700">Lesson type</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(LESSON_TYPE_META) as LessonContentType[]).map((t) => {
                const I = LESSON_TYPE_META[t].icon;
                return (
                  <button key={t} type="button" onClick={() => setType(t)} className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition", type === t ? "border-brand-500 bg-brand-500 text-white" : "border-ink-200 bg-white text-ink-600 hover:border-brand-300")}>
                    <I className="h-3.5 w-3.5" /> {LESSON_TYPE_META[t].label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[12.5px] text-ink-500">{LESSON_TYPE_META[type].hint}</p>
          </div>

          <Field label="Short description (optional)" htmlFor={`l-desc-${uid}`} error={fe.description}>
            <Input id={`l-desc-${uid}`} name="description" defaultValue={lesson?.description ?? ""} placeholder="One line shown in the lesson list" />
          </Field>

          {(type === "LINK" || type === "VIDEO") && (
            <Field label={type === "LINK" ? "Link" : "Video URL (YouTube, Vimeo, Loom, or any hosted video)"} htmlFor={`l-url-${uid}`} error={fe.url} hint={type === "VIDEO" ? "External hosting is preferred. Leave empty only if you upload a file below." : "Opens safely in a new tab."}>
              <Input id={`l-url-${uid}`} name="url" type="url" defaultValue={lesson?.url ?? ""} placeholder="https://" invalid={!!fe.url} />
            </Field>
          )}

          {uploadKind && (
            <div>
              <p className="mb-2 text-[13px] font-semibold text-ink-700">{needsFile ? (type === "AUDIO" ? "Audio file (MP3 preferred; M4A, WAV, OGG also work)" : "File") : "Or upload a video file"}</p>
              <label className={cn("flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-4 transition", busy ? "border-ink-200 bg-ink-50" : "border-ink-200 bg-white hover:border-brand-300")}>
                <input ref={input} type="file" accept={ACCEPT[uploadKind]} className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                {busy ? <Loader2 className="h-5 w-5 animate-spin text-brand-600" /> : <UploadCloud className="h-5 w-5 text-ink-400" />}
                <span className="min-w-0 flex-1 text-[13.5px]">
                  {busy ? <span className="font-semibold text-ink-800">Uploading… {file.progress ?? 0}%</span> : file.phase === "done" ? <span className="font-semibold text-ink-800"><Icon className="mr-1 inline h-3.5 w-3.5 text-brand-600" />{file.fileName ?? "Uploaded file"} <span className="font-normal text-ink-400">{[fmtBytes(file.sizeBytes), fmtDuration(file.durationSec)].filter(Boolean).join(" · ")}</span> · <span className="text-brand-700">replace</span></span> : <span className="font-semibold text-ink-700">Choose a file</span>}
                </span>
                {file.phase === "done" && !busy && <button type="button" onClick={(e) => { e.preventDefault(); setFile({ phase: "idle" }); }} aria-label="Remove file" className={iconBtn}><X className="h-4 w-4" /></button>}
              </label>
              {file.phase === "error" && <p className="mt-2 text-[12.5px] font-medium text-red-600">{file.message}</p>}
              {fe.storageKey && <p className="mt-2 text-[12.5px] font-medium text-red-600">{fe.storageKey}</p>}
            </div>
          )}

          {type !== "QUIZ" && type !== "ASSESSMENT" && (
            <Field label={type === "TEXT" ? "Lesson content (Markdown)" : type === "ASSIGNMENT" ? "Instructions (Markdown)" : "Notes for learners (optional)"} htmlFor={`l-body-${uid}`} error={fe.body}>
              <Textarea id={`l-body-${uid}`} name="body" rows={type === "TEXT" || type === "ASSIGNMENT" ? 10 : 3} defaultValue={lesson?.body ?? ""} placeholder={type === "TEXT" ? "## Heading\n\nParagraphs, **bold**, lists, and [links](https://...)" : type === "ASSIGNMENT" ? "What to produce, how it is graded, where to submit…" : "What to focus on, what to do afterwards…"} invalid={!!fe.body} />
            </Field>
          )}
          {(type === "QUIZ" || type === "ASSESSMENT") && (
            <Field label="Description shown before starting (optional)" htmlFor={`l-body-${uid}`} error={fe.body}>
              <Textarea id={`l-body-${uid}`} name="body" rows={3} defaultValue={lesson?.body ?? ""} />
            </Field>
          )}
        </>
      )}

      {showSettings && (
        <div className="space-y-4 rounded-2xl border border-ink-100 bg-white p-4">
          <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400"><Settings2 className="h-3.5 w-3.5" /> Settings</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Visibility" htmlFor={`l-status-${uid}`}>
              <Select id={`l-status-${uid}`} name="status" defaultValue={lesson?.status ?? "PUBLISHED"}>
                <option value="PUBLISHED">Published: learners can open it</option>
                <option value="DRAFT">Draft: hidden from learners</option>
              </Select>
            </Field>
            <div className="pt-7"><Checkbox name="isRequired" defaultChecked={lesson?.isRequired ?? true} label={<span><span className="font-semibold">Required</span> <span className="text-ink-500">counts toward course completion</span></span>} /></div>
          </div>
          {isMedia && (
            <Field label={`Required ${type === "AUDIO" ? "listening" : "watching"} (%)`} htmlFor={`l-pct-${uid}`} error={fe.requiredPercent} hint="Only time actually played counts; seeking to the end does not complete the lesson.">
              <Input id={`l-pct-${uid}`} name="requiredPercent" type="number" min={1} max={100} defaultValue={lesson?.requiredPercent ?? 90} className="w-[140px]" />
            </Field>
          )}
          {isQuiz && (
            <>
              <p className="text-[13px] text-ink-500">{type === "AUDIO" ? "Quiz after listening. Questions are built on the lesson page." : "Questions are built on the lesson page."}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Passing score (%)" htmlFor={`l-pass-${uid}`} error={fe.passingScore}><Input id={`l-pass-${uid}`} name="passingScore" type="number" min={1} max={100} defaultValue={lesson?.passingScore ?? 70} invalid={!!fe.passingScore} /></Field>
                <Field label="Attempts (blank = unlimited)" htmlFor={`l-att-${uid}`} error={fe.maxAttempts}><Input id={`l-att-${uid}`} name="maxAttempts" type="number" min={1} max={100} defaultValue={lesson?.maxAttempts ?? ""} /></Field>
                <Field label="Time limit (min, optional)" htmlFor={`l-time-${uid}`} error={fe.timeLimitMin}><Input id={`l-time-${uid}`} name="timeLimitMin" type="number" min={1} max={600} defaultValue={lesson?.timeLimitMin ?? ""} /></Field>
                <Field label="Draw N random questions (optional)" htmlFor={`l-rand-${uid}`} error={fe.randomizeCount} hint="e.g. 10 from a pool of 20"><Input id={`l-rand-${uid}`} name="randomizeCount" type="number" min={1} max={500} defaultValue={lesson?.randomizeCount ?? ""} /></Field>
                <Field label="Wait between retakes (min, optional)" htmlFor={`l-wait-${uid}`} error={fe.retakeWaitMinutes}><Input id={`l-wait-${uid}`} name="retakeWaitMinutes" type="number" min={0} defaultValue={lesson?.retakeWaitMinutes ?? ""} /></Field>
                <Field label="Score that counts" htmlFor={`l-policy-${uid}`}>
                  <Select id={`l-policy-${uid}`} name="scorePolicy" defaultValue={lesson?.scorePolicy ?? "HIGHEST"}>
                    <option value="HIGHEST">Highest attempt</option>
                    <option value="LATEST">Latest attempt</option>
                  </Select>
                </Field>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Checkbox name="shuffleAnswers" defaultChecked={lesson?.shuffleAnswers ?? false} label="Shuffle answer choices" />
                <Checkbox name="showCorrectAnswers" defaultChecked={lesson?.showCorrectAnswers ?? true} label="Show correct answers after submitting" />
                <Checkbox name="showExplanations" defaultChecked={lesson?.showExplanations ?? true} label="Show explanations" />
              </div>
              {type === "ASSESSMENT" && (
                <Field label="Scoring" htmlFor={`l-review-${uid}`}>
                  <Select id={`l-review-${uid}`} name="reviewMode" defaultValue={lesson?.reviewMode ?? "AUTO"}>
                    <option value="AUTO">Automatic</option>
                    <option value="MANUAL">Manual review by a coach</option>
                    <option value="BOTH">Automatic, then coach review</option>
                  </Select>
                </Field>
              )}
            </>
          )}
          {type === "ASSIGNMENT" && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Submission type" htmlFor={`l-sub-${uid}`} error={fe.submissionType}>
                <Select id={`l-sub-${uid}`} name="submissionType" defaultValue={lesson?.submissionType ?? ""} invalid={!!fe.submissionType}>
                  <option value="">Choose</option>
                  <option value="TEXT">Text answer</option>
                  <option value="URL">Link</option>
                  <option value="DOCUMENT">Document upload</option>
                  <option value="OTHER">Other</option>
                </Select>
              </Field>
              <Field label="Due date (optional)" htmlFor={`l-due-${uid}`} error={fe.dueAt}><Input id={`l-due-${uid}`} name="dueAt" type="date" defaultValue={dateInput(lesson?.dueAt ?? null)} /></Field>
              <Field label="Points (optional)" htmlFor={`l-pts-${uid}`} error={fe.points}><Input id={`l-pts-${uid}`} name="points" type="number" min={0} defaultValue={lesson?.points ?? ""} /></Field>
            </div>
          )}
        </div>
      )}

      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && !onDone && <FormAlert tone="success">Lesson saved.</FormAlert>}
      <div className="flex items-center gap-3">
        <SubmitButton pendingText="Saving…" disabled={busy}>{lesson ? "Save lesson" : "Add lesson"}</SubmitButton>
        {onDone && <button type="button" onClick={onDone} className="text-[13.5px] font-semibold text-ink-500 hover:text-ink-800">Cancel</button>}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function LessonRow({ courseId, modules, module, lesson, index, count }: { courseId: string; modules: ModuleValue[]; module: ModuleValue; lesson: LessonValue; index: number; count: number }) {
  const [editing, setEditing] = useState(false);
  const meta = LESSON_TYPE_META[lesson.contentType];
  const Icon = meta.icon;
  if (editing) return <li className="py-3"><LessonForm courseId={courseId} modules={modules} moduleId={module.id} lesson={lesson} onDone={() => setEditing(false)} /></li>;
  const needsQuestions = QUESTION_TYPES.includes(lesson.contentType);
  const detail = [
    lesson.contentType === "TEXT" ? `${(lesson.body ?? "").split(/\s+/).filter(Boolean).length} words` : null,
    lesson.hasFile ? [lesson.fileName, fmtBytes(lesson.sizeBytes), fmtDuration(lesson.durationSec)].filter(Boolean).join(" · ") : null,
    !lesson.hasFile && lesson.url ? lesson.url.replace(/^https?:\/\//, "").slice(0, 50) : null,
    needsQuestions ? `${lesson.questionCount} question${lesson.questionCount === 1 ? "" : "s"}` : null,
    lesson.passingScore && needsQuestions ? `pass ${lesson.passingScore}%` : null,
  ].filter(Boolean).join(" · ");
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-ink-500 ring-1 ring-inset ring-ink-100"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold text-ink-800">
          <Link href={`/courses/manage/${courseId}/lessons/${lesson.id}`} className="hover:text-brand-700">{index + 1}. {lesson.title}</Link>
          {needsQuestions && lesson.questionCount === 0 && <span className="ml-2 rounded-full bg-gold-50 px-2 py-0.5 text-[10.5px] font-semibold text-gold-700 ring-1 ring-inset ring-gold-200">No questions yet</span>}
        </p>
        <p className="truncate text-[12.5px] text-ink-400">{meta.label}{detail ? ` · ${detail}` : ""}</p>
      </div>
      <div className="hidden sm:block"><StateBadge status={lesson.status} required={lesson.isRequired} /></div>
      <div className="flex items-center gap-0.5">
        <IconAction action={moveLessonAction} fields={{ courseId, lessonId: lesson.id, direction: "up" }} label="Move up"><ArrowUp className={cn("h-4 w-4", index === 0 && "opacity-30")} /></IconAction>
        <IconAction action={moveLessonAction} fields={{ courseId, lessonId: lesson.id, direction: "down" }} label="Move down"><ArrowDown className={cn("h-4 w-4", index === count - 1 && "opacity-30")} /></IconAction>
        <button type="button" onClick={() => setEditing(true)} aria-label="Edit lesson" title="Edit lesson" className={iconBtn}><Pencil className="h-4 w-4" /></button>
        <IconAction action={duplicateLessonAction} fields={{ courseId, lessonId: lesson.id }} label="Duplicate lesson"><Copy className="h-4 w-4" /></IconAction>
        <IconAction action={deleteLessonAction} fields={{ courseId, lessonId: lesson.id }} label="Delete lesson" confirm={`Delete "${lesson.title}"? Learners lose access to it immediately; their past attempts and progress are kept.`} danger><Trash2 className="h-4 w-4" /></IconAction>
      </div>
    </li>
  );
}

function ModuleCard({ courseId, modules, module, index }: { courseId: string; modules: ModuleValue[]; module: ModuleValue; index: number }) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  return (
    <li className="rounded-2xl border border-ink-100 bg-ink-50/50 p-4">
      {editing ? (
        <ModuleForm courseId={courseId} module={module} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Module {index + 1}</p>
            <p className="text-[15.5px] font-bold text-ink-900">{module.title}</p>
            {module.description && <p className="mt-0.5 text-[13.5px] text-ink-500">{module.description}</p>}
            <div className="mt-1.5"><StateBadge status={module.status} required={module.isRequired} /></div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconAction action={moveModuleAction} fields={{ courseId, moduleId: module.id, direction: "up" }} label="Move module up"><ArrowUp className={cn("h-4 w-4", index === 0 && "opacity-30")} /></IconAction>
            <IconAction action={moveModuleAction} fields={{ courseId, moduleId: module.id, direction: "down" }} label="Move module down"><ArrowDown className={cn("h-4 w-4", index === modules.length - 1 && "opacity-30")} /></IconAction>
            <button type="button" onClick={() => setEditing(true)} aria-label="Edit module" title="Edit module" className={iconBtn}><Pencil className="h-4 w-4" /></button>
            <IconAction action={duplicateModuleAction} fields={{ courseId, moduleId: module.id }} label="Duplicate module"><Copy className="h-4 w-4" /></IconAction>
            <IconAction action={deleteModuleAction} fields={{ courseId, moduleId: module.id }} label="Delete module" confirm={`Delete "${module.title}" and its ${module.lessons.length} lesson${module.lessons.length === 1 ? "" : "s"}? Learners lose access immediately; their history is kept.`} danger><Trash2 className="h-4 w-4" /></IconAction>
          </div>
        </div>
      )}
      <ul className="mt-3 divide-y divide-ink-100 border-t border-ink-100">
        {module.lessons.length === 0 && !adding && <li className="py-3 text-[13px] text-ink-400">No lessons yet.</li>}
        {module.lessons.map((l, i) => <LessonRow key={l.id} courseId={courseId} modules={modules} module={module} lesson={l} index={i} count={module.lessons.length} />)}
        {adding && <li className="py-3"><LessonForm courseId={courseId} modules={modules} moduleId={module.id} onDone={() => setAdding(false)} /></li>}
      </ul>
      {!adding && <button type="button" onClick={() => setAdding(true)} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3.5 text-[13px] font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"><Plus className="h-4 w-4" /> Add lesson</button>}
    </li>
  );
}

/**
 * Modules & Lessons tab. Every change saves immediately and applies at any course status, including
 * PUBLISHED. Learner history is never touched by edits here.
 */
export function CurriculumEditor({ courseId, modules }: { courseId: string; modules: ModuleValue[] }) {
  const [addingModule, setAddingModule] = useState(modules.length === 0);
  return (
    <div className="space-y-4">
      {modules.length === 0 && !addingModule && <p className="text-[13.5px] text-ink-500">No modules yet. Add a module, then add lessons to it.</p>}
      <ol className="space-y-4">
        {modules.map((m, i) => <ModuleCard key={m.id} courseId={courseId} modules={modules} module={m} index={i} />)}
      </ol>
      {addingModule ? (
        <div className="rounded-2xl border border-brand-100 bg-brand-50/40 p-4"><ModuleForm courseId={courseId} onDone={modules.length ? () => setAddingModule(false) : undefined} /></div>
      ) : (
        <button type="button" onClick={() => setAddingModule(true)} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-ink-200 bg-white px-4 text-[13.5px] font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"><Plus className="h-4 w-4" /> Add module</button>
      )}
    </div>
  );
}
