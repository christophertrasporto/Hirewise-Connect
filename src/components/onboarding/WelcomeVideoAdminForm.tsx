"use client";

import { useActionState, useRef, useState } from "react";
import { Loader2, UploadCloud, X } from "lucide-react";
import { requestWelcomeVideoUploadAction, saveWelcomeVideoConfigAction } from "@/app/(app)/onboarding-actions";
import { idle } from "@/server/http/action-result";
import { Checkbox, Field, FormAlert, Input, Select, SubmitButton, Textarea } from "@/components/ui/Form";
import { cn } from "@/lib/cn";

export type WelcomeVideoFormValues = { enabled: boolean; title: string; instructions: string; videoUrl: string | null; hasFile: boolean; fileName: string | null; durationSec: number | null; requiredPercent: number; lockCourses: boolean; appliesTo: "NEW" | "ALL"; effectiveFrom: string | null; videoKey: string };

type FileState = { phase: "idle" | "uploading" | "done" | "error"; progress?: number; message?: string; key?: string; fileName?: string; durationSec?: number | null };

function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(el.src);
      resolve(Number.isFinite(el.duration) ? Math.round(el.duration) : null);
    };
    el.onerror = () => resolve(null);
    el.src = URL.createObjectURL(file);
  });
}

export function WelcomeVideoAdminForm({ values }: { values: WelcomeVideoFormValues }) {
  const [state, action] = useActionState(saveWelcomeVideoConfigAction, idle);
  const [file, setFile] = useState<FileState>(values.hasFile ? { phase: "done", fileName: values.fileName ?? undefined, durationSec: values.durationSec } : { phase: "idle" });
  const [url, setUrl] = useState(values.videoUrl ?? "");
  const input = useRef<HTMLInputElement>(null);
  const fe = state.fieldErrors ?? {};

  async function upload(f: File) {
    setFile({ phase: "uploading", progress: 0 });
    const req = await requestWelcomeVideoUploadAction({ contentType: f.type || "video/mp4", sizeBytes: f.size });
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
    setFile({ phase: "done", key: req.data.key, fileName: f.name, durationSec: await readDuration(f) });
    if (input.current) input.current.value = "";
  }

  const busy = file.phase === "uploading";
  const keepingFile = file.phase === "done" && !file.key && values.hasFile;

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="storageKey" value={file.key ?? (keepingFile ? "__keep__" : "")} />
      <input type="hidden" name="fileName" value={file.fileName ?? ""} />
      <input type="hidden" name="durationSec" value={file.durationSec ?? ""} />

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Video title" htmlFor="wv-title" error={fe.title}><Input id="wv-title" name="title" defaultValue={values.title} invalid={!!fe.title} /></Field>
        <Field label="Required watch percentage" htmlFor="wv-pct" error={fe.requiredPercent} hint="Completion is recorded when actually watched time reaches this share of the video."><Input id="wv-pct" name="requiredPercent" type="number" min={1} max={100} defaultValue={values.requiredPercent} invalid={!!fe.requiredPercent} /></Field>
      </div>

      <Field label="Instructions shown next to the video (Markdown, optional)" htmlFor="wv-instr" error={fe.instructions}><Textarea id="wv-instr" name="instructions" rows={4} defaultValue={values.instructions} /></Field>

      <div>
        <p className="mb-2 text-[13px] font-semibold text-ink-700">Video file</p>
        <label className={cn("flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-4 transition", busy ? "border-ink-200 bg-ink-50" : "border-ink-200 bg-white hover:border-brand-300")}>
          <input ref={input} type="file" accept="video/mp4,video/webm,video/quicktime" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          {busy ? <Loader2 className="h-5 w-5 animate-spin text-brand-600" /> : <UploadCloud className="h-5 w-5 text-ink-400" />}
          <span className="min-w-0 flex-1 text-[13.5px]">
            {busy ? <span className="font-semibold text-ink-800">Uploading… {file.progress ?? 0}%</span> : file.phase === "done" ? <span className="font-semibold text-ink-800">{file.fileName ?? "Uploaded video"} {file.durationSec ? <span className="font-normal text-ink-400">· {Math.round(file.durationSec / 60)} min</span> : null} · <span className="text-brand-700">replace</span></span> : <span className="font-semibold text-ink-700">Upload MP4, WebM, or MOV (up to 1 GB)</span>}
          </span>
          {file.phase === "done" && !busy && <button type="button" onClick={(e) => { e.preventDefault(); setFile({ phase: "idle" }); }} aria-label="Remove file" className="rounded-full p-1.5 text-ink-400 hover:bg-ink-50 hover:text-ink-800"><X className="h-4 w-4" /></button>}
        </label>
        {file.phase === "error" && <p className="mt-2 text-[12.5px] font-medium text-red-600">{file.message}</p>}
        <p className="mt-2 text-[12.5px] text-ink-400">Replacing the video resets everyone&apos;s progress for it. Progress is tracked per video version.</p>
      </div>

      <Field label="Or a direct video URL (used only when no file is uploaded)" htmlFor="wv-url" error={fe.videoUrl} hint="Must point at a video file the browser can play (mp4 or webm). YouTube pages cannot be progress-tracked.">
        <Input id="wv-url" name="videoUrl" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/welcome.mp4" disabled={file.phase === "done"} invalid={!!fe.videoUrl} />
      </Field>

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Applies to" htmlFor="wv-applies" error={fe.appliesTo} hint={values.effectiveFrom ? `"New users" means accounts created after ${new Date(values.effectiveFrom).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}.` : '"New users" means accounts created after you first enable the requirement.'}>
          <Select id="wv-applies" name="appliesTo" defaultValue={values.appliesTo}>
            <option value="NEW">New users only</option>
            <option value="ALL">All talent accounts</option>
          </Select>
        </Field>
        <div className="space-y-3 pt-7">
          <Checkbox name="enabled" defaultChecked={values.enabled} label={<span><span className="font-semibold">Require the welcome video</span> <span className="text-ink-500">as an onboarding step</span></span>} />
          <Checkbox name="lockCourses" defaultChecked={values.lockCourses} label={<span><span className="font-semibold">Keep courses locked</span> <span className="text-ink-500">until it is completed</span></span>} />
        </div>
      </div>

      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Saved. Talent see the change on their next page load.</FormAlert>}
      <SubmitButton pendingText="Saving…" disabled={busy}>Save onboarding settings</SubmitButton>
    </form>
  );
}
