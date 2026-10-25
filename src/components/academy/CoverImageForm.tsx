"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Trash2 } from "lucide-react";
import { requestCourseCoverUploadAction, setCourseCoverAction } from "@/app/(app)/academy-actions";
import { COVER_MAX_BYTES, COVER_MIMES } from "@/lib/course-cover";
import { FormAlert } from "@/components/ui/Form";
import { CourseCover } from "./CourseTile";

type Phase = { kind: "idle" } | { kind: "uploading"; progress: number } | { kind: "saved" } | { kind: "error"; message: string };

/** Settings tab: upload, replace, or remove the course cover. PNG, JPG, or WebP up to 2 MB, sent straight to storage. */
export function CoverImageForm({ courseId, title, category, difficulty, coverUrl }: { courseId: string; title: string; category: string; difficulty: string; coverUrl: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [preview, setPreview] = useState<string | null>(coverUrl);
  const busy = phase.kind === "uploading";

  async function upload(f: File) {
    if (!(f.type in COVER_MIMES)) return setPhase({ kind: "error", message: "Use a PNG, JPG, or WebP image." });
    if (f.size > COVER_MAX_BYTES) return setPhase({ kind: "error", message: `The image is too large. Maximum is ${Math.round(COVER_MAX_BYTES / 1024 / 1024)} MB.` });
    setPhase({ kind: "uploading", progress: 0 });
    const req = await requestCourseCoverUploadAction({ courseId, contentType: f.type, sizeBytes: f.size });
    if (!req.ok || !req.data) return setPhase({ kind: "error", message: req.error ?? "Upload could not start." });
    const sent = await new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open(req.data!.method, req.data!.url);
      for (const [k, v] of Object.entries(req.data!.headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => e.lengthComputable && setPhase({ kind: "uploading", progress: Math.round((e.loaded / e.total) * 100) });
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => resolve(false);
      xhr.send(f);
    });
    if (!sent) return setPhase({ kind: "error", message: "The upload failed. Check your connection and try again." });
    const saved = await setCourseCoverAction({ courseId, key: req.data.key });
    if (!saved.ok) return setPhase({ kind: "error", message: saved.error ?? "The cover could not be saved." });
    setPreview(saved.data?.coverUrl ?? URL.createObjectURL(f));
    setPhase({ kind: "saved" });
    if (input.current) input.current.value = "";
    router.refresh();
  }

  async function remove() {
    setPhase({ kind: "uploading", progress: 0 });
    const r = await setCourseCoverAction({ courseId, key: null });
    if (!r.ok) return setPhase({ kind: "error", message: r.error ?? "The cover could not be removed." });
    setPreview(null);
    setPhase({ kind: "saved" });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="max-w-md overflow-hidden rounded-card border border-ink-100 shadow-card">
        <CourseCover title={title} category={category} difficulty={difficulty} coverUrl={preview} eager />
      </div>
      <p className="text-[12.5px] text-ink-500">{preview ? "This image is shown on every course card and on the course page." : "No image yet. Learners see the generated Hirewise cover above until you upload one."} Best at 16:9 (for example 1280 by 720).</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white hover:bg-ink-800 ${busy ? "pointer-events-none opacity-60" : ""}`}>
          <ImagePlus className="h-4 w-4" /> {preview ? "Replace image" : "Upload image"}
          <input ref={input} type="file" accept={Object.keys(COVER_MIMES).join(",")} className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        </label>
        {preview && <button type="button" onClick={() => void remove()} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-full border border-ink-200 bg-white px-4 text-[13.5px] font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-60"><Trash2 className="h-4 w-4" /> Remove</button>}
        {phase.kind === "uploading" && <span className="text-[13px] text-ink-500" role="status">Uploading… {phase.progress}%</span>}
      </div>
      {phase.kind === "error" && <FormAlert>{phase.message}</FormAlert>}
      {phase.kind === "saved" && <FormAlert tone="success">Saved.</FormAlert>}
    </div>
  );
}
