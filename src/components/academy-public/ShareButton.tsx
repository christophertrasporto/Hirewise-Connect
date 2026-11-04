"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * "Share" for a public Academy page. A member who can refer (talent, coaches, agency owners) gets their own link with
 * their referral code; everyone else, signed in or not, gets the clean address. The link goes to the share sheet when the
 * device has one, otherwise to the clipboard.
 */
export function ShareButton({ path, title, personal, className }: { path: string; title: string; /** Whether the viewer is a member with a referral code. */ personal: boolean; className?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "copied" | "failed">("idle");

  async function share() {
    setState("busy");
    let url = `${window.location.origin}${path}`;
    if (personal) {
      try {
        const res = await fetch("/api/academy/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
        if (res.ok) url = ((await res.json()) as { url: string }).url;
      } catch {
        // Fall back to the clean address.
      }
    }
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, url });
        setState("idle");
        return;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return setState("idle");
    }
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("failed");
    }
  }

  return (
    <div className={className}>
      <button type="button" onClick={share} disabled={state === "busy"} className={cn("inline-flex h-10 items-center gap-2 rounded-full border border-ink-200 bg-white px-4 text-[13.5px] font-semibold text-ink-800 transition hover:border-ink-300 disabled:opacity-60")}>
        {state === "copied" ? <Check className="h-4 w-4 text-brand-600" aria-hidden="true" /> : <Share2 className="h-4 w-4" aria-hidden="true" />}
        {state === "copied" ? "Link copied" : "Share"}
      </button>
      <span role="status" className="sr-only">{state === "copied" ? "Link copied to the clipboard" : ""}</span>
      {state === "failed" && <p className="mt-1 text-[12.5px] text-red-600">Could not copy the link. Copy it from the address bar.</p>}
    </div>
  );
}
