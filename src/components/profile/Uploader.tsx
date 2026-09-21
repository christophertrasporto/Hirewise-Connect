"use client";

import { useRef, useState } from "react";
import { UploadCloud, Loader2, CheckCircle2 } from "lucide-react";
import { requestUploadAction, confirmUploadAction } from "@/app/(app)/actions";
import { FormAlert } from "@/components/ui/Form";
import { cn } from "@/lib/cn";

type Props = {
  kind: "RESUME" | "PHOTO" | "VIDEO" | "RECORDING";
  accept: string;
  label: string;
  hint?: string;
  /** Extra fields sent with confirm (recording kind, title). */
  extra?: () => { recordingKind?: string; title?: string } | null;
  onDone?: () => void;
};

/**
 * Presigned upload flow: ask the server for a URL, PUT the file from the browser,
 * then confirm so the server records it. Media duration is read client-side when possible.
 */
export function Uploader({ kind, accept, label, hint, extra, onDone }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ phase: "idle" | "uploading" | "confirming" | "done" | "error"; message?: string; progress?: number }>({ phase: "idle" });

  async function readDuration(file: File): Promise<number | null> {
    if (!/^(video|audio)\//.test(file.type)) return null;
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

  async function handle(file: File) {
    const ex = extra ? extra() : {};
    if (ex === null) return;
    setState({ phase: "uploading", progress: 0 });
    const req = await requestUploadAction({ kind, contentType: file.type, sizeBytes: file.size });
    if (!req.ok || !req.data) return setState({ phase: "error", message: req.error ?? "Upload could not start." });

    const ok = await new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open(req.data!.method, req.data!.url);
      for (const [k, v] of Object.entries(req.data!.headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => e.lengthComputable && setState({ phase: "uploading", progress: Math.round((e.loaded / e.total) * 100) });
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => resolve(false);
      xhr.send(file);
    });
    if (!ok) return setState({ phase: "error", message: "The upload failed. Check your connection and try again." });

    setState({ phase: "confirming" });
    const durationSec = await readDuration(file);
    const res = await confirmUploadAction({ kind, key: req.data.key, durationSec, ...ex });
    if (!res.ok) return setState({ phase: "error", message: res.error ?? "Could not save the upload." });
    setState({ phase: "done" });
    if (input.current) input.current.value = "";
    onDone?.();
  }

  const busy = state.phase === "uploading" || state.phase === "confirming";
  return (
    <div>
      <label className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition", busy ? "border-ink-200 bg-ink-50" : "border-ink-200 hover:border-brand-400 hover:bg-brand-50/40")}>
        <input ref={input} type="file" accept={accept} className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />
        {busy ? <Loader2 className="h-6 w-6 animate-spin text-brand-600" /> : state.phase === "done" ? <CheckCircle2 className="h-6 w-6 text-brand-600" /> : <UploadCloud className="h-6 w-6 text-ink-400" />}
        <span className="text-[14.5px] font-semibold text-ink-800">{busy ? (state.phase === "uploading" ? `Uploading… ${state.progress ?? 0}%` : "Saving…") : state.phase === "done" ? "Uploaded" : label}</span>
        {hint && !busy && <span className="text-[12.5px] text-ink-400">{hint}</span>}
      </label>
      {state.phase === "error" && <div className="mt-3"><FormAlert>{state.message}</FormAlert></div>}
    </div>
  );
}
