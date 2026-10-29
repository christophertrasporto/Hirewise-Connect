"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, CheckCircle2 } from "lucide-react";
import { requestUploadAction, confirmUploadAction, removePhotoAction } from "@/app/(app)/actions";
import { FormAlert } from "@/components/ui/Form";
import { Avatar } from "./Avatar";

const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Choose a photo, see it, then press Save. Nothing is stored until Save; Cancel throws the choice away. The saved photo
 * is shown above (through the access-checked photo route) so the owner can confirm the upload worked.
 */
export function PhotoUploader({ agentProfileId, name, version }: { agentProfileId: string; name: string; version: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "saving" | "removing">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(f: File | undefined) {
    setError(null);
    setNotice(null);
    if (!f) return;
    if (!TYPES.includes(f.type)) return setError("Choose a JPG, PNG, or WebP image.");
    if (f.size > MAX_BYTES) return setError("That photo is over 5 MB. Choose a smaller one.");
    setFile(f);
  }

  function cancel() {
    setFile(null);
    setError(null);
    if (input.current) input.current.value = "";
  }

  async function save() {
    if (!file) return;
    setError(null);
    setPhase("saving");
    setProgress(0);
    const req = await requestUploadAction({ kind: "PHOTO", contentType: file.type, sizeBytes: file.size });
    if (!req.ok || !req.data) {
      setPhase("idle");
      return setError(req.error ?? "The upload could not start.");
    }
    const up = req.data;
    const sent = await new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open(up.method, up.url);
      for (const [k, v] of Object.entries(up.headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => resolve(false);
      xhr.send(file);
    });
    if (!sent) {
      setPhase("idle");
      return setError("The upload failed. Check your connection and try again.");
    }
    const res = await confirmUploadAction({ kind: "PHOTO", key: up.key });
    setPhase("idle");
    if (!res.ok) return setError(res.error ?? "Could not save the photo.");
    cancel();
    setNotice("Photo saved.");
    router.refresh();
  }

  async function remove() {
    setError(null);
    setNotice(null);
    setPhase("removing");
    const res = await removePhotoAction();
    setPhase("idle");
    if (!res.ok) return setError(res.error ?? "Could not remove the photo.");
    setNotice("Photo removed.");
    router.refresh();
  }

  const busy = phase !== "idle";
  const btn = "rounded-full px-4 py-2 text-[13.5px] font-semibold disabled:opacity-60";
  return (
    <div>
      <div className="flex items-center gap-4">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="New photo preview" width={96} height={96} className="h-24 w-24 shrink-0 rounded-full object-cover ring-2 ring-brand-500" />
        ) : (
          <Avatar agentProfileId={agentProfileId} version={version} name={name} size={96} />
        )}
        <div className="min-w-0 text-[13.5px] text-ink-600">
          {preview ? (
            <p><span className="font-semibold text-ink-900">{file?.name}</span> is ready. It is not saved until you press Save photo.</p>
          ) : version ? (
            <p>This is your current photo. Choose another to replace it.</p>
          ) : (
            <p>You have no photo yet. JPG, PNG, or WebP up to 5 MB; a clear, professional headshot works best.</p>
          )}
        </div>
      </div>

      <input ref={input} type="file" accept={TYPES.join(",")} className="sr-only" id="photo-file" disabled={busy} onChange={(e) => choose(e.target.files?.[0])} />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {file ? (
          <>
            <button type="button" onClick={save} disabled={busy} className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}>
              {phase === "saving" ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Saving… {progress}%</span> : "Save photo"}
            </button>
            <button type="button" onClick={cancel} disabled={busy} className={`${btn} bg-ink-100 text-ink-700 hover:bg-ink-200`}>Cancel</button>
          </>
        ) : (
          <>
            <label htmlFor="photo-file" className={`${btn} inline-flex cursor-pointer items-center gap-2 bg-ink-900 text-white hover:bg-ink-800`}>
              <ImagePlus className="h-4 w-4" /> {version ? "Choose a different photo" : "Choose a photo"}
            </label>
            {version && (
              <button type="button" onClick={remove} disabled={busy} className={`${btn} bg-ink-100 text-ink-700 hover:bg-ink-200`}>
                {phase === "removing" ? "Removing…" : "Remove photo"}
              </button>
            )}
          </>
        )}
      </div>
      {notice && <p role="status" className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-brand-700"><CheckCircle2 className="h-4 w-4" /> {notice}</p>}
      {error && <div className="mt-3"><FormAlert>{error}</FormAlert></div>}
    </div>
  );
}
