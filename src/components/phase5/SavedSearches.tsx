"use client";

import { useActionState } from "react";
import { Bookmark, Trash2 } from "lucide-react";
import { saveSearchAction, deleteSavedSearchAction, runSavedSearchAction } from "@/app/(app)/phase5-actions";
import { idle } from "@/server/http/action-result";
import { Input, SubmitButton } from "@/components/ui/Form";

type Saved = { id: string; name: string; query: string; lastRunAt: Date | null };

export function SavedSearches({ saved, currentFilters }: { saved: Saved[]; currentFilters: Record<string, unknown> }) {
  const [state, action] = useActionState(saveSearchAction, idle);
  const hasFilters = Object.values(currentFilters).some((v) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0));
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {saved.map((s) => (
        <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white pl-3 text-[12.5px] font-semibold text-ink-700">
          <form action={runSavedSearchAction}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="query" value={s.query} /><button type="submit" className="inline-flex items-center gap-1 py-1.5 hover:text-brand-700"><Bookmark className="h-3.5 w-3.5" /> {s.name}</button></form>
          <form action={deleteSavedSearchAction}><input type="hidden" name="id" value={s.id} /><button type="submit" aria-label={`Delete saved search ${s.name}`} className="px-2 py-1.5 text-ink-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button></form>
        </span>
      ))}
      {hasFilters && (
        <form action={action} className="inline-flex items-center gap-2">
          <input type="hidden" name="filters" value={JSON.stringify(currentFilters)} />
          <Input name="name" placeholder="Save this search as…" className="h-9 w-[200px] text-[13px]" required maxLength={60} />
          <SubmitButton variant="outline" pendingText="…" className="h-9 px-3 text-[12.5px]">Save</SubmitButton>
          {state.error && <span className="text-[12px] text-red-600">{state.error}</span>}
          {state.ok && <span className="text-[12px] font-semibold text-brand-700">Saved</span>}
        </form>
      )}
      {!hasFilters && saved.length === 0 && <span className="text-[12.5px] text-ink-400">Apply filters to save a search.</span>}
    </div>
  );
}
