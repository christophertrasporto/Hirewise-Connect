"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Uploader } from "./Uploader";
import { mediaUrlAction } from "@/app/(app)/actions";

export function ResumeUpload({ agentProfileId, hasResume }: { agentProfileId: string; hasResume: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);

  async function openResume() {
    const r = await mediaUrlAction({ type: "RESUME", id: agentProfileId });
    if (r.ok && r.data) window.open(r.data.url, "_blank", "noopener");
    else setErr(r.error ?? "Could not open the file.");
  }

  return (
    <div className="space-y-3">
      <Uploader kind="RESUME" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" label={hasResume ? "Replace résumé" : "Choose your résumé"} hint="PDF or Word, up to 10 MB" onDone={() => router.refresh()} />
      {hasResume && (
        <button type="button" onClick={openResume} className="text-[13.5px] font-semibold text-brand-600 hover:text-brand-700">
          Open current résumé
        </button>
      )}
      {err && <p className="text-[12.5px] text-red-600">{err}</p>}
    </div>
  );
}
