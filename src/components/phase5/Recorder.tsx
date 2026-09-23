"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Video, Square, RotateCcw, UploadCloud, Loader2 } from "lucide-react";
import { requestUploadAction, confirmUploadAction } from "@/app/(app)/actions";
import { FormAlert } from "@/components/ui/Form";
import { cn } from "@/lib/cn";

/**
 * In-browser recording with MediaRecorder (Phase 5). Produces a WebM blob that goes
 * through the same presigned upload and confirm flow as a file upload.
 */
export function Recorder({ kind, extra, onDone, maxSeconds = kind === "VIDEO" ? 120 : 180 }: { kind: "VIDEO" | "RECORDING"; extra?: () => { recordingKind?: string; title?: string } | null; onDone?: () => void; maxSeconds?: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<"idle" | "ready" | "recording" | "review" | "uploading" | "done" | "error">("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const supported = typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => {
    if (phase === "recording" && seconds >= maxSeconds) stop();
  }, [seconds, phase, maxSeconds]);

  async function prepare() {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(kind === "VIDEO" ? { video: { width: 1280, height: 720 }, audio: true } : { audio: true });
      streamRef.current = stream;
      if (videoRef.current && kind === "VIDEO") {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        await videoRef.current.play().catch(() => {});
      }
      setPhase("ready");
    } catch {
      setErr("Camera or microphone access was refused. Allow it in the browser and try again, or upload a file instead.");
      setPhase("error");
    }
  }

  function start() {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = kind === "VIDEO" ? (MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm") : MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime });
    chunks.current = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
    rec.onstop = () => {
      const b = new Blob(chunks.current, { type: kind === "VIDEO" ? "video/webm" : "audio/webm" });
      setBlob(b);
      if (videoRef.current && kind === "VIDEO") {
        videoRef.current.srcObject = null;
        videoRef.current.muted = false;
        videoRef.current.src = URL.createObjectURL(b);
      }
      setPhase("review");
    };
    recRef.current = rec;
    rec.start(1000);
    setSeconds(0);
    setPhase("recording");
  }

  function stop() {
    recRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  async function upload() {
    if (!blob) return;
    const ex = extra ? extra() : {};
    if (ex === null) return;
    setPhase("uploading");
    const req = await requestUploadAction({ kind, contentType: blob.type, sizeBytes: blob.size });
    if (!req.ok || !req.data) { setErr(req.error ?? "Upload could not start."); return setPhase("error"); }
    const ok = await fetch(req.data.url, { method: req.data.method, headers: req.data.headers, body: blob }).then((r) => r.ok).catch(() => false);
    if (!ok) { setErr("The upload failed."); return setPhase("error"); }
    const res = await confirmUploadAction({ kind, key: req.data.key, durationSec: seconds, ...ex });
    if (!res.ok) { setErr(res.error ?? "Could not save the recording."); return setPhase("error"); }
    setPhase("done");
    onDone?.();
  }

  if (!supported) return <p className="text-[13px] text-ink-400">In-browser recording is not supported here. Upload a file instead.</p>;
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="rounded-2xl border border-ink-100 bg-ink-50/50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13.5px] font-semibold text-ink-800">{kind === "VIDEO" ? "Record in the browser" : "Record a voice sample"}</p>
        {(phase === "recording" || phase === "review") && <span className={cn("font-mono text-[13px] font-semibold", phase === "recording" ? "text-red-600" : "text-ink-500")}>{phase === "recording" ? "● " : ""}{mm}:{ss} / {String(Math.floor(maxSeconds / 60)).padStart(2, "0")}:{String(maxSeconds % 60).padStart(2, "0")}</span>}
      </div>
      {kind === "VIDEO" && <video ref={videoRef} playsInline controls={phase === "review"} className={cn("mt-3 w-full rounded-xl bg-black", phase === "idle" && "hidden")} />}
      {kind === "RECORDING" && blob && phase === "review" && <audio controls src={URL.createObjectURL(blob)} className="mt-3 w-full" />}
      <div className="mt-3 flex flex-wrap gap-2">
        {phase === "idle" && <button type="button" onClick={prepare} className="inline-flex h-10 items-center gap-2 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white">{kind === "VIDEO" ? <Video className="h-4 w-4" /> : <Mic className="h-4 w-4" />} Enable {kind === "VIDEO" ? "camera" : "microphone"}</button>}
        {phase === "ready" && <button type="button" onClick={start} className="inline-flex h-10 items-center gap-2 rounded-full bg-red-600 px-4 text-[13.5px] font-semibold text-white">● Start recording</button>}
        {phase === "recording" && <button type="button" onClick={stop} className="inline-flex h-10 items-center gap-2 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white"><Square className="h-4 w-4" /> Stop</button>}
        {phase === "review" && (
          <>
            <button type="button" onClick={upload} className="inline-flex h-10 items-center gap-2 rounded-full bg-brand-500 px-4 text-[13.5px] font-semibold text-white"><UploadCloud className="h-4 w-4" /> Use this recording</button>
            <button type="button" onClick={() => { setBlob(null); setSeconds(0); setPhase("idle"); }} className="inline-flex h-10 items-center gap-2 rounded-full border border-ink-200 bg-white px-4 text-[13.5px] font-semibold text-ink-800"><RotateCcw className="h-4 w-4" /> Record again</button>
          </>
        )}
        {phase === "uploading" && <span className="inline-flex items-center gap-2 text-[13.5px] text-ink-600"><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</span>}
        {phase === "done" && <span className="text-[13.5px] font-semibold text-brand-700">Uploaded. Hirewise will review it.</span>}
      </div>
      {err && <div className="mt-3"><FormAlert>{err}</FormAlert></div>}
    </div>
  );
}
