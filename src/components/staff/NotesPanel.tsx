"use client";

import { useActionState } from "react";
import { Pin } from "lucide-react";
import { addNoteAction } from "@/app/(app)/actions";
import { idle } from "@/server/http/action-result";
import { Textarea, Select, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";

type Note = { id: string; body: string; visibility: string; pinned: boolean; createdAt: Date; author: string; authorRole: string | null };

export function NotesPanel({ subjectType, subjectId, notes, canWrite }: { subjectType: "AGENT" | "CLIENT"; subjectId: string; notes: Note[]; canWrite: boolean }) {
  const [state, action] = useActionState(addNoteAction, idle);
  return (
    <div>
      {notes.length === 0 ? <p className="text-[13.5px] text-ink-400">No notes yet.</p> : (
        <ul className="space-y-2.5">
          {notes.map((n) => (
            <li key={n.id} className={`rounded-xl px-3.5 py-2.5 text-[13.5px] ${n.visibility === "INTERNAL" ? "bg-ink-50" : "bg-gold-50"}`}>
              <div className="flex items-center justify-between gap-2 text-[11.5px] text-ink-400">
                <span>{n.author}{n.authorRole ? ` · ${n.authorRole.toLowerCase()}` : ""} · {new Date(n.createdAt).toLocaleDateString()}</span>
                <span className="inline-flex items-center gap-1">{n.pinned && <Pin className="h-3 w-3" />}{n.visibility === "INTERNAL" ? "internal" : `visible to ${n.visibility.toLowerCase()}`}</span>
              </div>
              <p className="mt-1 whitespace-pre-line text-ink-700">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form action={action} className="mt-4 space-y-2.5" noValidate>
          <input type="hidden" name="subjectType" value={subjectType} />
          <input type="hidden" name="subjectId" value={subjectId} />
          <Textarea name="body" rows={3} placeholder="Internal note…" required className="min-h-0 text-[13.5px]" />
          <div className="flex flex-wrap items-center gap-3">
            <Select name="visibility" defaultValue="INTERNAL" className="h-9 w-auto text-[13px]" aria-label="Visibility">
              <option value="INTERNAL">Internal only</option>
              <option value={subjectType}>Visible to the {subjectType.toLowerCase()}</option>
            </Select>
            <Checkbox name="pinned" label="Pin" />
            <SubmitButton variant="outline" pendingText="Saving…" className="h-9 text-[13px]">Add note</SubmitButton>
          </div>
          {state.error && <FormAlert>{state.error}</FormAlert>}
        </form>
      )}
    </div>
  );
}
