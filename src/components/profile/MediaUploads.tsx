"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Uploader } from "./Uploader";
import { Field, Input, Select } from "@/components/ui/Form";
import { RECORDING_KINDS } from "@/lib/options";
import { Recorder } from "@/components/phase5/Recorder";

export function MediaUploads({ kind }: { kind: "VIDEO" | "RECORDING" }) {
  const router = useRouter();
  const [recordingKind, setRecordingKind] = useState<string>("INTRODUCTION");
  const [title, setTitle] = useState("");

  if (kind === "VIDEO") {
    return (
      <div className="space-y-3">
        <Uploader kind="VIDEO" accept="video/mp4,video/webm,video/quicktime" label="Upload video introduction" hint="MP4, WebM, or MOV up to 200 MB. Replaces any unapproved video." onDone={() => router.refresh()} />
        <Recorder kind="VIDEO" onDone={() => router.refresh()} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Sample type" htmlFor="recordingKind">
          <Select id="recordingKind" value={recordingKind} onChange={(e) => setRecordingKind(e.target.value)}>
            {RECORDING_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </Select>
        </Field>
        <Field label="Title" htmlFor="recordingTitle" hint="e.g. “Solar cold call, 2 min”">
          <Input id="recordingTitle" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </Field>
      </div>
      <Uploader kind="RECORDING" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/webm,audio/ogg,.mp3,.wav,.m4a" label="Upload voice sample" hint="MP3, WAV, or M4A up to 25 MB" extra={() => ({ recordingKind, title })} onDone={() => router.refresh()} />
      <Recorder kind="RECORDING" extra={() => ({ recordingKind, title })} onDone={() => router.refresh()} />
    </div>
  );
}
