"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { mediaUrlAction } from "@/app/(app)/actions";

export function ResumeLink({ agentProfileId }: { agentProfileId: string }) {
  const [err, setErr] = useState<string | null>(null);
  async function open() {
    const r = await mediaUrlAction({ type: "RESUME", id: agentProfileId });
    if (r.ok && r.data) window.open(r.data.url, "_blank", "noopener");
    else setErr(r.error ?? "Could not open.");
  }
  return (
    <>
      <button type="button" onClick={open} className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-brand-600 hover:text-brand-700"><FileText className="h-4 w-4" /> Open résumé</button>
      {err && <p className="text-[12.5px] text-red-600">{err}</p>}
    </>
  );
}
