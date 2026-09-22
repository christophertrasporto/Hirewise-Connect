"use client";

import { useActionState, useEffect, useRef } from "react";
import { Send, ShieldAlert } from "lucide-react";
import { postMessageAction } from "@/app/(app)/actions";
import { idle, type ActionResult } from "@/server/http/action-result";
import { Textarea, Select, SubmitButton, FormAlert } from "@/components/ui/Form";
import { cn } from "@/lib/cn";

export type ThreadMessage = { id: string; body: string; authorRole: string; authorLabel: string; mine: boolean; visibleTo: string; heldForReview: boolean; blocked: boolean; createdAt: Date };

export function MessageThread({ requestId, messages, audience, closed }: { requestId: string; messages: ThreadMessage[]; audience: "CLIENT" | "AGENT" | "STAFF"; closed: boolean }) {
  const [state, action] = useActionState(postMessageAction, idle as ActionResult<{ held: boolean; reasons: string[] }>);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  return (
    <div>
      <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 && <p className="text-[13.5px] text-ink-400">No messages yet. {audience === "STAFF" ? "Propose times or relay questions here." : "Hirewise coordinates this conversation."}</p>}
        {messages.map((m) => (
          <div key={m.id} className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed", m.mine ? "ml-auto bg-ink-900 text-white" : m.authorRole === "CLIENT" || m.authorRole === "AGENT" ? "bg-ink-100 text-ink-800" : "bg-brand-50 text-ink-800 ring-1 ring-inset ring-brand-200")}>
            <div className={cn("mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider", m.mine ? "text-ink-300" : "text-ink-400")}>
              <span>{m.mine ? "You" : m.authorLabel}</span>
              <span>{new Date(m.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              {audience === "STAFF" && <span className="rounded-full bg-white/60 px-1.5 text-[10px] text-ink-500">{m.visibleTo.toLowerCase().replace(/_/g, " ")}</span>}
              {m.heldForReview && !m.blocked && <span className="inline-flex items-center gap-1 rounded-full bg-gold-100 px-1.5 text-[10px] text-gold-700"><ShieldAlert className="h-3 w-3" /> held for review</span>}
              {m.blocked && <span className="rounded-full bg-red-100 px-1.5 text-[10px] text-red-700">blocked</span>}
            </div>
            <p className="whitespace-pre-line">{m.body}</p>
          </div>
        ))}
      </div>

      {!closed && (
        <form ref={form} action={action} className="mt-4 space-y-2.5" noValidate>
          <input type="hidden" name="requestId" value={requestId} />
          <Textarea name="body" rows={3} required placeholder={audience === "STAFF" ? "Message…" : "Message to Hirewise (your account manager relays what is needed)"} className="min-h-0 text-[14px]" />
          <div className="flex flex-wrap items-center gap-3">
            {audience === "STAFF" && (
              <Select name="visibleTo" defaultValue="ALL" className="h-9 w-auto text-[13px]" aria-label="Visible to">
                <option value="ALL">Client and candidates</option>
                <option value="CLIENT_AND_HIREWISE">Client only</option>
                <option value="AGENT_AND_HIREWISE">Candidates only</option>
                <option value="HIREWISE_ONLY">Hirewise only (internal)</option>
              </Select>
            )}
            <SubmitButton variant="dark" pendingText="Sending…" className="h-9 text-[13px]"><Send className="h-3.5 w-3.5" /> Send</SubmitButton>
          </div>
          {state.ok && state.data?.held && <FormAlert tone="info">Your message is pending Hirewise review because it appears to include contact details ({state.data.reasons.join(", ")}). During hiring, all coordination goes through Hirewise.</FormAlert>}
          {state.error && <FormAlert>{state.error}</FormAlert>}
          {audience !== "STAFF" && <p className="text-[12px] text-ink-400">Please keep contact details and rate discussions out of this thread. Hirewise handles scheduling, pricing, and contracts.</p>}
        </form>
      )}
    </div>
  );
}
