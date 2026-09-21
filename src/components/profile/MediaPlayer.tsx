"use client";

import { useState } from "react";
import { Play, Loader2 } from "lucide-react";
import { mediaUrlAction } from "@/app/(app)/actions";

/** Fetches a short-lived signed URL only when the user asks to play (INV-P6). */
export function MediaPlayer({ type, id }: { type: "VIDEO" | "RECORDING"; id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const r = await mediaUrlAction({ type, id });
    setLoading(false);
    if (r.ok && r.data) setUrl(r.data.url);
    else setError(r.error ?? "Could not load media.");
  }

  if (url) {
    return type === "VIDEO" ? <video src={url} controls className="mt-3 w-full rounded-xl bg-black" /> : <audio src={url} controls className="mt-3 w-full" />;
  }
  return (
    <div className="mt-3">
      <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3.5 py-1.5 text-[13px] font-semibold text-ink-800 hover:bg-ink-50 disabled:opacity-60">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {type === "VIDEO" ? "Play video" : "Play recording"}
      </button>
      {error && <p className="mt-1.5 text-[12.5px] text-red-600">{error}</p>}
    </div>
  );
}
