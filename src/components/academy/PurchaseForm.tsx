"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { startPurchaseAction } from "@/app/(app)/purchase-actions";
import { previewPromoAction } from "@/app/(app)/promo-actions";
import { idle } from "@/server/http/action-result";
import type { PromoQuote } from "@/server/services/promo.service";
import { FormAlert, Input } from "@/components/ui/Form";
import { cn } from "@/lib/cn";

/** A submit button that names its method. While the form is sending, only the button that was pressed shows the busy state. */
function MethodButton({ value, variant, pendingText, className, children }: { value: string; variant: "primary" | "outline"; pendingText: string; className?: string; children: ReactNode }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("method") === value;
  return (
    <button type="submit" name="method" value={value} disabled={pending} className={cn("inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-[14.5px] font-semibold transition disabled:opacity-60", variant === "primary" ? "bg-brand-500 text-white shadow-soft hover:bg-brand-600" : "border border-ink-200 bg-white text-ink-800 hover:bg-ink-50", className)}>
      {mine ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {pendingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/**
 * The checkout screen's form. One press enrols (with the promo code, when entered) and starts the chosen payment. A free
 * course, or a code that makes it free, shows "Enrol for free" instead of the payment buttons. For a learner who is
 * already enrolled and unpaid the price is fixed (their code, if any, is managed beside this form), so the code box is hidden.
 */
export function PurchaseForm({ courseId, priceLabel, free, methods, allowPromo }: { courseId: string; priceLabel: string; free: boolean; methods: { maya: boolean; paypal: boolean }; allowPromo: boolean }) {
  const [state, action] = useActionState(startPurchaseAction, idle);
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
  const isFree = free || price === "Free";
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="promoCode" value={quote ? quote.code : ""} />

      {allowPromo &&
        (open ? (
          <div className="space-y-2">
            <label htmlFor="buy-promo" className="block text-[13px] font-semibold text-ink-700">
              Promo code
            </label>
            <div className="flex gap-2">
              <Input
                id="buy-promo"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setQuote(null);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (code.trim()) check();
                  }
                }}
                autoComplete="off"
                spellCheck={false}
                className="h-10 uppercase"
              />
              <button type="button" onClick={check} disabled={checking || !code.trim()} className="inline-flex h-10 shrink-0 items-center rounded-full border border-ink-200 bg-white px-4 text-[13.5px] font-semibold text-ink-800 hover:bg-ink-50 disabled:opacity-60">
                {checking ? "Checking…" : "Apply"}
              </button>
            </div>
            {quote && (
              <FormAlert tone="success">
                <strong>{quote.code}</strong> applied: {quote.discountLabel}. <span className="text-ink-500 line-through">{quote.listPrice}</span> <strong>{quote.finalPrice}</strong>
              </FormAlert>
            )}
            {error && <FormAlert>{error}</FormAlert>}
          </div>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="text-[13.5px] font-semibold text-brand-700 hover:text-brand-800">
            Have a promo code?
          </button>
        ))}

      {isFree ? (
        <MethodButton value="OFFLINE" variant="primary" pendingText="Enrolling…">
          Enrol for free
        </MethodButton>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            {methods.maya && (
              <MethodButton value="MAYA" variant="primary" pendingText="Opening Maya…">
                Pay {price} with Maya
              </MethodButton>
            )}
            {methods.paypal && (
              <MethodButton value="PAYPAL" variant={methods.maya ? "outline" : "primary"} pendingText="Opening PayPal…">
                Pay {price} with PayPal
              </MethodButton>
            )}
          </div>
          <MethodButton value="OFFLINE" variant="outline" pendingText="Enrolling…" className="text-[13.5px]">
            {methods.maya || methods.paypal ? "Pay by bank transfer or GCash instead" : `Enrol · ${price}, then pay by bank transfer or GCash`}
          </MethodButton>
          <p className="text-[12.5px] text-ink-500">{methods.maya || methods.paypal ? "The course unlocks as soon as your online payment is confirmed. Bank transfer and GCash unlock once Hirewise records the payment." : "Hirewise records your payment and the lessons unlock."}</p>
        </div>
      )}
      {state.error && <FormAlert>{state.error}</FormAlert>}
    </form>
  );
}
