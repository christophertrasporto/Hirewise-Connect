"use client";

import { useActionState } from "react";
import { shortlistNoteAction } from "@/app/(app)/actions";
import { idle } from "@/server/http/action-result";
import { Textarea, SubmitButton } from "@/components/ui/Form";

export function ShortlistNote({ agentProfileId, note }: { agentProfileId: string; note: string }) {
  const [state, action] = useActionState(shortlistNoteAction, idle);
  return (
    <form action={action} className="flex gap-2">
      <input type="hidden" name="agentProfileId" value={agentProfileId} />
      <Textarea name="note" defaultValue={note} rows={2} placeholder="Private note (only you and Hirewise see this)" className="min-h-0 text-[13px]" />
      <SubmitButton variant="outline" pendingText="…" className="h-auto shrink-0 px-3 text-[13px]">{state.ok ? "Saved" : "Save"}</SubmitButton>
    </form>
  );
}
