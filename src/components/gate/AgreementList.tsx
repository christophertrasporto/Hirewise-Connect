"use client";

import { useActionState, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { acceptAgreementAction } from "@/app/(gate)/actions";
import { idle } from "@/server/http/action-result";
import { SubmitButton, FormAlert, Checkbox } from "@/components/ui/Form";
import { renderMarkdown } from "@/lib/markdown";
import { cn } from "@/lib/cn";

type Item = { id: string; type: string; version: number; title: string; bodyMarkdown: string; accepted: boolean };

export function AgreementList({ agreements }: { agreements: Item[] }) {
  const firstOpen = agreements.find((a) => !a.accepted)?.id ?? null;
  const [open, setOpen] = useState<string | null>(firstOpen);
  return (
    <ol className="mt-8 space-y-3">
      {agreements.map((a, i) => (
        <li key={a.id} className={cn("rounded-3xl border bg-white shadow-soft", a.accepted ? "border-brand-200" : "border-ink-100")}>
          <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} className="flex w-full items-center gap-4 px-6 py-4 text-left" aria-expanded={open === a.id}>
            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold", a.accepted ? "bg-brand-500 text-white" : "bg-ink-900 text-white")}>
              {a.accepted ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            <span className="flex-1">
              <span className="block text-[16px] font-bold text-ink-900">{a.title}</span>
              <span className="block text-[12.5px] text-ink-400">Version {a.version} · {a.accepted ? "Accepted" : "Not yet accepted"}</span>
            </span>
            <ChevronDown className={cn("h-5 w-5 text-ink-400 transition-transform", open === a.id && "rotate-180")} />
          </button>
          {open === a.id && (
            <div className="border-t border-ink-100 px-6 py-5">
              <div className="max-h-[360px] space-y-3 overflow-y-auto rounded-2xl bg-ink-50/70 p-5">{renderMarkdown(a.bodyMarkdown)}</div>
              {!a.accepted && <AcceptForm agreementId={a.id} title={a.title} />}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function AcceptForm({ agreementId, title }: { agreementId: string; title: string }) {
  const [state, action] = useActionState(acceptAgreementAction, idle);
  const [ticked, setTicked] = useState(false);
  return (
    <form action={action} className="mt-5 space-y-4">
      <input type="hidden" name="agreementId" value={agreementId} />
      <Checkbox checked={ticked} onChange={(e) => setTicked(e.target.checked)} label={<>I have read and agree to the <strong>{title}</strong>.</>} />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton disabled={!ticked} pendingText="Recording…">Accept this agreement</SubmitButton>
    </form>
  );
}
