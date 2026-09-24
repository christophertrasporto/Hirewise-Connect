"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2, UploadCloud, X } from "lucide-react";
import { deleteLessonAction, deleteModuleAction, moveLessonAction, moveModuleAction, requestLessonUploadAction, saveLessonAction, saveModuleAction } from "@/app/(app)/academy-actions";
import { idle } from "@/server/http/action-result";
import { Field, FormAlert, Input, Select, SubmitButton, Textarea } from "@/components/ui/Form";
import { cn } from "@/lib/cn";
import { fmtBytes, fmtDuration, LESSON_TYPE_META, type LessonContentType } from "@/components/academy/lesson-meta";

export type LessonValue = { id: string; title: string; contentType: LessonContentType; body: string | null; url: string | null; fileName: string | null; contentMime: string | null; sizeBytes: number | null; durationSec: number | null; hasFile: boolean };
export type ModuleValue = { id: string; title: string; description: string | null; lessons: LessonValue[] };

const iconBtn = "rounded-full p-1.5 text-ink-400 hover:bg-white hover:text-ink-800 disabled:opacity-40";

/** Small forms (move, delete) that post a single hidden-field action. */
function IconAction({ action, fields, label, confirm, children, danger }: { action: (prev: import("@/server/http/action-result").ActionResult, fd: FormData) => Promise<import("@/server/http/action-result").ActionResult>; fields: Record<string, string>; label: string; confirm?: string; children: ReactNode; danger?: boolean }) {
  const [state, act, pending] = useActionState(action, idle);
  return (
    <form action={act} onSubmit={(e) => confirm && !window.confirm(confirm) && e.preventDefault()} className="inline-flex">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" aria-label={label} title={label} disabled={pending} className={cn(iconBtn, danger && "text-red-400 hover:text-red-600")}>{children}</button>
      {state.error && <span className="ml-2 self-center text-[12px] text-red-600">{state.error}</span>}
    </form>
  );
}

function ModuleForm({ courseId, module, onDone }: { courseId: string; module?: ModuleValue; onDone?: () => void }) {
  const [state, action] = useActionState(saveModuleAction, idle);
  const fe = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.ok) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="courseId" value={courseId} />
      {module && <input type="hidden" name="id" value={module.id} />}
      <Field label="Module title" htmlFor={`m-title-${module?.id ?? "new"}`} error={fe.title}>
        <Input id={`m-title-${module?.id ?? "new"}`} name="title" defaultValue={module?.title ?? ""} placeholder="e.g. Module 1: The first ten seconds" invalid={!!fe.title} />
      </Field>
      <Field label="What this module covers (optional)" htmlFor={`m-desc-${module?.id ?? "new"}`} error={fe.description}>
        <Textarea id={`m-desc-${module?.id ?? "new"}`} name="description" rows={2} defaultValue={module?.description ?? ""} />
      </Field>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <div className="flex items-center gap-3">
        <SubmitButton pendingText="Saving…">{module ? "Save module" : "Add module"}</SubmitButton>
        {onDone && <button type="button" onClick={onDone} className="text-[13.5px] font-semibold text-ink-500 hover:text-ink-800">Cancel</button>}
      </div>
    </form>
  );
}

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

const ACCEPT: Record<"VIDEO" | "AUDIO" | "DOCUMENT", string> = {
  VIDEO: "video/mp4,video/webm,video/quicktime",
  AUDIO: "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/webm,audio/ogg",
  DOCUMENT: ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv",
};

function LessonForm({ courseId, modules, moduleId, lesson, onDone }: { courseId: string; modules: ModuleValue[]; moduleId: string; lesson?: LessonValue; onDone: () => void }) {
  const [state, action] = useActionState(saveLessonAction, idle);
  const [type, setType] = useState<LessonContentType>(lesson?.contentType ?? "VIDEO");
  const [file, setFile] = useState<FileState>(lesson?.hasFile ? { phase: "done", fileName: lesson.fileName ?? undefined, contentMime: lesson.contentMime ?? undefined, sizeBytes: lesson.sizeBytes ?? undefined, durationSec: lesson.durationSec ?? null } : { phase: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const fe = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);
  const needsFile = type === "AUDIO" || type === "DOCUMENT";
  const uploadKind = type === "VIDEO" || type === "AUDIO" || type === "DOCUMENT" ? type : null;
  const uid = lesson?.id ?? `new-${moduleId}`;

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
      {/* File fields: a newly uploaded key, or nothing when the existing file is kept (the server keeps the stored key on update). */}
      <input type="hidden" name="storageKey" value={file.key ?? (lesson?.hasFile && file.phase === "done" ? "__keep__" : "")} />
      <input type="hidden" name="fileName" value={file.fileName ?? ""} />
      <input type="hidden" name="contentMime" value={file.contentMime ?? ""} />
      <input type="hidden" name="sizeBytes" value={file.sizeBytes ?? ""} />
      <input type="hidden" name="durationSec" value={file.durationSec ?? ""} />

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

      <div>
        <p className="mb-2 text-[13px] font-semibold text-ink-700">Content type</p>
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

      {(type === "LINK" || type === "VIDEO") && (
        <Field label={type === "LINK" ? "Link" : "Video URL (YouTube, Vimeo, Loom, or any hosted video)"} htmlFor={`l-url-${uid}`} error={fe.url} hint={type === "VIDEO" ? "Leave empty if you upload a file below." : undefined}>
          <Input id={`l-url-${uid}`} name="url" type="url" defaultValue={lesson?.url ?? ""} placeholder="https://" invalid={!!fe.url} />
        </Field>
      )}

      {uploadKind && (
        <div>
          <p className="mb-2 text-[13px] font-semibold text-ink-700">{needsFile ? "File" : "Or upload a video file"}</p>
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

      <Field label={type === "TEXT" ? "Lesson content (Markdown)" : "Notes for students (optional)"} htmlFor={`l-body-${uid}`} error={fe.body}>
        <Textarea id={`l-body-${uid}`} name="body" rows={type === "TEXT" ? 12 : 3} defaultValue={lesson?.body ?? ""} placeholder={type === "TEXT" ? "## Heading\n\nParagraphs, **bold**, lists, and [links](https://...)" : "What to focus on, what to do afterwards…"} invalid={!!fe.body} />
      </Field>

      {state.error && <FormAlert>{state.error}</FormAlert>}
      <div className="flex items-center gap-3">
        <SubmitButton pendingText="Saving…" disabled={busy}>{lesson ? "Save lesson" : "Add lesson"}</SubmitButton>
        <button type="button" onClick={onDone} className="text-[13.5px] font-semibold text-ink-500 hover:text-ink-800">Cancel</button>
      </div>
    </form>
  );
}

function LessonRow({ courseId, modules, module, lesson, index, count }: { courseId: string; modules: ModuleValue[]; module: ModuleValue; lesson: LessonValue; index: number; count: number }) {
  const [editing, setEditing] = useState(false);
  const meta = LESSON_TYPE_META[lesson.contentType];
  const Icon = meta.icon;
  if (editing) return <li className="py-3"><LessonForm courseId={courseId} modules={modules} moduleId={module.id} lesson={lesson} onDone={() => setEditing(false)} /></li>;
  const detail = lesson.contentType === "TEXT" ? `${(lesson.body ?? "").split(/\s+/).filter(Boolean).length} words` : lesson.hasFile ? [lesson.fileName, fmtBytes(lesson.sizeBytes), fmtDuration(lesson.durationSec)].filter(Boolean).join(" · ") : lesson.url ? lesson.url.replace(/^https?:\/\//, "").slice(0, 60) : "";
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-ink-500 ring-1 ring-inset ring-ink-100"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold text-ink-800">{index + 1}. {lesson.title}</p>
        <p className="truncate text-[12.5px] text-ink-400">{meta.label}{detail ? ` · ${detail}` : ""}</p>
      </div>
      <div className="flex items-center gap-0.5">
        <IconAction action={moveLessonAction} fields={{ courseId, lessonId: lesson.id, direction: "up" }} label="Move up"><ArrowUp className={cn("h-4 w-4", index === 0 && "opacity-30")} /></IconAction>
        <IconAction action={moveLessonAction} fields={{ courseId, lessonId: lesson.id, direction: "down" }} label="Move down"><ArrowDown className={cn("h-4 w-4", index === count - 1 && "opacity-30")} /></IconAction>
        <button type="button" onClick={() => setEditing(true)} aria-label="Edit lesson" title="Edit lesson" className={iconBtn}><Pencil className="h-4 w-4" /></button>
        <IconAction action={deleteLessonAction} fields={{ courseId, lessonId: lesson.id }} label="Delete lesson" confirm={`Delete "${lesson.title}"? Students lose access to it immediately.`} danger><Trash2 className="h-4 w-4" /></IconAction>
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
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconAction action={moveModuleAction} fields={{ courseId, moduleId: module.id, direction: "up" }} label="Move module up"><ArrowUp className={cn("h-4 w-4", index === 0 && "opacity-30")} /></IconAction>
            <IconAction action={moveModuleAction} fields={{ courseId, moduleId: module.id, direction: "down" }} label="Move module down"><ArrowDown className={cn("h-4 w-4", index === modules.length - 1 && "opacity-30")} /></IconAction>
            <button type="button" onClick={() => setEditing(true)} aria-label="Edit module" title="Edit module" className={iconBtn}><Pencil className="h-4 w-4" /></button>
            <IconAction action={deleteModuleAction} fields={{ courseId, moduleId: module.id }} label="Delete module" confirm={`Delete "${module.title}" and its ${module.lessons.length} lesson${module.lessons.length === 1 ? "" : "s"}? Students lose access immediately.`} danger><Trash2 className="h-4 w-4" /></IconAction>
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
 * Coach and Admin curriculum editor. Every change saves immediately and applies at any course status,
 * including PUBLISHED, so a live course can grow without being archived and recreated.
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
