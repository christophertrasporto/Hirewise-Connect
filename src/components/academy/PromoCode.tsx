"use client";

import { useActionState, useState, useTransition } from "react";
import { enrolAction } from "@/app/(app)/academy-actions";
import { applyPromoAction, previewPromoAction, removePromoAction } from "@/app/(app)/promo-actions";
import { idle } from "@/server/http/action-result";
import type { PromoQuote } from "@/server/services/promo.service";
import { FormAlert, Input, SubmitButton } from "@/components/ui/Form";

/** Enrol button with an optional promo code: the code is checked as it is entered and applied together with enrolling. */
export function EnrolWithPromo({ courseId, priceLabel }: { courseId: string; priceLabel: string }) {
  const [state, action] = useActionState(enrolAction, idle);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [quote, setQuote] = useState<PromoQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();

  function check() {
    setError(null);
    setQuote(null);
    startCheck(async () => {
      const r = await previewPromoAction(courseId, code);
      if (r.ok && r.data) setQuote(r.data);
      else setError(r.error ?? "This code isn't valid for this course.");
    });
  }

  const price = quote ? quote.finalPrice : priceLabel;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="promoCode" value={quote ? quote.code : ""} />
      {open ? (
        <div className="space-y-2">
          <label htmlFor="promo-code" className="block text-[13px] font-semibold text-ink-700">Promo code</label>
          <div className="flex gap-2">
            <Input id="promo-code" value={code} onChange={(e) => { setCode(e.target.value); setQuote(null); setError(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (code.trim()) check(); } }} autoComplete="off" spellCheck={false} placeholder="Enter code" className="h-10 uppercase" />
            <button type="button" onClick={check} disabled={checking || !code.trim()} className="inline-flex h-10 shrink-0 items-center rounded-full border border-ink-200 bg-white px-4 text-[13.5px] font-semibold text-ink-800 hover:bg-ink-50 disabled:opacity-60">{checking ? "Checking…" : "Apply"}</button>
          </div>
          {quote && <FormAlert tone="success"><strong>{quote.code}</strong> applied: {quote.discountLabel}. <span className="text-ink-500 line-through">{quote.listPrice}</span> <strong>{quote.finalPrice}</strong></FormAlert>}
          {error && <FormAlert>{error}</FormAlert>}
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="text-[13.5px] font-semibold text-brand-700 hover:text-brand-800">Have a promo code?</button>
      )}
      <SubmitButton variant="primary" pendingText="Enrolling…">{price === "Free" ? "Enrol for free" : `Enrol · ${price}`}</SubmitButton>
      {state.error && <FormAlert>{state.error}</FormAlert>}
    </form>
  );
}

/** On an unpaid enrolment: the applied code with a Remove link, or a box to add one. */
export function PendingPromoBox({ enrollmentId, promo }: { enrollmentId: string; promo: { code: string; discountLabel: string; listPrice: string } | null }) {
  const [applyState, apply] = useActionState(applyPromoAction, idle);
  const [removeState, remove] = useActionState(removePromoAction, idle);
  if (promo) {
    return (
      <form action={remove} className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <input type="hidden" name="enrollmentId" value={enrollmentId} />
        <span className="rounded-full bg-brand-50 px-3 py-1 font-semibold text-brand-700">{promo.code} applied · {promo.discountLabel} off {promo.listPrice}</span>
        <SubmitButton variant="outline" pendingText="Removing…" className="h-8 px-3 text-[12.5px]">Remove code</SubmitButton>
        {removeState.error && <span className="text-red-600">{removeState.error}</span>}
      </form>
    );
  }
  return (
    <form action={apply} className="mt-3 max-w-sm space-y-2">
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <label htmlFor="pending-promo" className="block text-[13px] font-semibold text-ink-700">Have a promo code?</label>
      <div className="flex gap-2">
        <Input id="pending-promo" name="promoCode" autoComplete="off" spellCheck={false} placeholder="Enter code" className="h-10 uppercase" />
        <SubmitButton variant="outline" pendingText="Checking…" className="h-10 shrink-0 px-4 text-[13.5px]">Apply</SubmitButton>
      </div>
      {applyState.error && <FormAlert>{applyState.error}</FormAlert>}
    </form>
  );
}
