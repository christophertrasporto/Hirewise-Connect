"use client";

import { useActionState } from "react";
import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { toggleShortlistAction } from "@/app/(app)/actions";
import type { ActionResult } from "@/server/http/action-result";
import { cn } from "@/lib/cn";

export function ShortlistButton({ agentProfileId, shortlisted, compact = false }: { agentProfileId: string; shortlisted: boolean; compact?: boolean }) {
  const [state, action] = useActionState(toggleShortlistAction, { ok: false } as ActionResult<{ shortlisted: boolean }>);
  const current = state.ok && state.data ? state.data.shortlisted : shortlisted;
  return (
    <form action={action}>
      <input type="hidden" name="agentProfileId" value={agentProfileId} />
      <input type="hidden" name="shortlisted" value={String(current)} />
      <Inner current={current} compact={compact} />
      {state.error && <p className="mt-1 text-[12px] text-red-600">{state.error}</p>}
    </form>
  );
}

function Inner({ current, compact }: { current: boolean; compact: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-pressed={current}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition disabled:opacity-60",
        compact ? "h-9 px-3.5 text-[13px]" : "h-11 px-5 text-[14.5px]",
        current ? "bg-brand-500 text-white hover:bg-brand-600" : "bg-ink-900 text-white hover:bg-ink-800",
      )}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : current ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
      {current ? "Shortlisted" : "Shortlist"}
    </button>
  );
}
